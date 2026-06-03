const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const admin = require("firebase-admin");
const User = require("../models/user.model");
const chatService = require("../services/chat_service");

/**
 * Initialise Socket.io on the HTTP server.
 * Returns the io instance (attached to app for route access).
 */
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 5 * 1024 * 1024, // 5 MB — for base64 image data
  });

  // ── JWT Authentication middleware ─────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        console.error("[Socket] ❌ Auth rejected — no token provided");
        return next(new Error("Authentication token required"));
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtErr) {
        console.error(`[Socket] ❌ JWT verify failed: ${jwtErr.message}`);
        return next(new Error("Invalid or expired token"));
      }

      const userId  = decoded.userId || decoded.sub || decoded.id;
      if (!userId) {
        console.error("[Socket] ❌ JWT decoded but no userId field — check token shape:", JSON.stringify(decoded));
        return next(new Error("Token missing userId"));
      }

      const user = await User.findById(userId).select("first_name last_name email roles status");

      if (!user) {
        console.error(`[Socket] ❌ User ${userId} not found in DB`);
        return next(new Error("User not found"));
      }
      if (user.status === "inactive") {
        console.error(`[Socket] ❌ User ${user.email} is inactive`);
        return next(new Error("User account is inactive"));
      }

      socket.user = user;
      console.log(`[Socket] ✅ Auth OK — ${user.first_name} ${user.last_name} (${userId})`);
      next();
    } catch (err) {
      console.error("[Socket] ❌ Auth middleware error:", err.message);
      next(new Error("Invalid or expired token"));
    }
  });

  // ── In-memory: userId → Set of socket IDs ────────────────────────────────
  const onlineUsers = new Map(); // userId → Set<socketId>

  const addOnline = (userId, socketId) => {
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socketId);
  };

  const removeOnline = (userId, socketId) => {
    const sids = onlineUsers.get(userId);
    if (!sids) return;
    sids.delete(socketId);
    if (sids.size === 0) onlineUsers.delete(userId);
  };

  const isOnline = (userId) => onlineUsers.has(String(userId));

  // Emit to every socket of a user
  const emitToUser = (userId, event, data) => {
    const sids = onlineUsers.get(String(userId));
    if (!sids) return;
    sids.forEach((sid) => io.to(sid).emit(event, data));
  };

  // ── Connection ────────────────────────────────────────────────────────────
  io.on("connection", (socket) => {
    const userId = String(socket.user._id);
    addOnline(userId, socket.id);

    // Join a personal room so we can target this user directly
    socket.join(`user:${userId}`);

    // Broadcast presence update
    io.emit("user:online", { userId, online: true });

    console.log(`✅ [Socket] Connected: ${socket.user.first_name} ${socket.user.last_name} | userId=${userId} | socketId=${socket.id} | transport=${socket.conn.transport.name}`);

    // ── Join a conversation room ──────────────────────────────────────────
    socket.on("conversation:join", async ({ conversationId }) => {
      console.log(`[Socket] conversation:join — userId=${userId}, convId=${conversationId}`);
      try {
        // Verify membership before joining
        const result = await chatService.getConversation(conversationId, userId);
        socket.join(`conv:${conversationId}`);
        socket.emit("conversation:joined", { conversationId });
        console.log(`[Socket] ✅ Joined room conv:${conversationId}`);

        // Mark as read when joining
        await chatService.markAsRead(conversationId, userId);
        io.to(`conv:${conversationId}`).emit("messages:read", { conversationId, userId });
      } catch (err) {
        console.error(`[Socket] ❌ conversation:join failed: ${err.message}`);
        socket.emit("error", { message: err.message || "Cannot join conversation" });
      }
    });

    // ── Leave a conversation room ─────────────────────────────────────────
    socket.on("conversation:leave", ({ conversationId }) => {
      socket.leave(`conv:${conversationId}`);
    });

    // ── Send a text/image message ─────────────────────────────────────────
    // Payload: { conversationId, content?, images_url?: string[], image_names?: string[] }
    socket.on("message:send", async (payload) => {
      const { conversationId, content, images_url, image_names } = payload;
      console.log(`[Socket] message:send — userId=${userId}, convId=${conversationId}, content="${content || ""}", images=${(images_url||[]).length}`);
      try {
        const result = await chatService.sendMessage(
          conversationId,
          userId,
          { content, images_url, image_names },
        );
        console.log(`[Socket] ✅ Message saved — msgId=${result.data._id}`);

        // Broadcast the new message to everyone in the conversation room
        const room = `conv:${conversationId}`;
        const roomSockets = io.sockets.adapter.rooms.get(room);
        console.log(`[Socket] Broadcasting message:new to room ${room} — ${roomSockets?.size || 0} socket(s) in room`);
        io.to(room).emit("message:new", {
          conversationId,
          message: result.data,
        });

        // Push a notification to the OTHER participant(s) if they are not in the room
        const conv = result.conversation;
        const hasImages = Array.isArray(images_url) && images_url.length > 0;
        const senderName = `${socket.user.first_name} ${socket.user.last_name}`.trim();
        const preview = hasImages && !content?.trim()
          ? `📷 ${images_url.length > 1 ? `${images_url.length} Images` : "Image"}`
          : (content?.trim() || "");

        for (const participant of conv.participants) {
          const pid = String(participant._id || participant);
          if (pid === userId) continue;

          const socketsInRoom = io.sockets.adapter.rooms.get(`conv:${conversationId}`);
          const participantSids = onlineUsers.get(pid);
          const isInRoom = participantSids &&
            [...participantSids].some((sid) => socketsInRoom?.has(sid));

          // Socket notification — only when user is online but on a different screen
          if (!isInRoom) {
            emitToUser(pid, "notification:message", {
              conversationId,
              from: {
                _id:        socket.user._id,
                first_name: socket.user.first_name,
                last_name:  socket.user.last_name,
              },
              preview,
              sent_at: result.data.sent_at,
            });
          }

          // FCM push — ALWAYS send so background/closed app users are notified.
          // (Duplicate with the socket snackbar is acceptable; FCM deduplicates by tag.)
          try {
            const recipient = await User.findById(pid).select("fcm_tokens");
            console.log(`[Socket] FCM lookup for userId=${pid} — tokens=${recipient?.fcm_tokens?.length || 0}`);
            if (recipient?.fcm_tokens?.length) {
              for (const token of recipient.fcm_tokens) {
                try {
                  await admin.messaging().send({
                    token,
                    notification: { title: senderName, body: preview || "New message" },
                    data: {
                      type:           "chat_message",
                      conversationId: String(conversationId),
                      senderId:       String(socket.user._id),
                      senderName,
                    },
                    android: {
                      priority: "high",
                      notification: { tag: `chat_${conversationId}` },
                    },
                    apns: { payload: { aps: { sound: "default", badge: 1 } } },
                  });
                  console.log(`[Socket] ✅ FCM push sent to userId=${pid}`);
                } catch (err) {
                  if (
                    err.code === "messaging/invalid-registration-token" ||
                    err.code === "messaging/registration-token-not-registered"
                  ) {
                    await User.updateOne({ _id: pid }, { $pull: { fcm_tokens: token } });
                    console.log(`[Socket] 🗑 Removed stale FCM token for userId=${pid}`);
                  } else {
                    console.error(`[Socket] ❌ FCM send error for userId=${pid}: ${err.code} — ${err.message}`);
                  }
                }
              }
            } else {
              console.warn(`[Socket] ⚠️  No FCM tokens for userId=${pid} — push notification skipped (user may not have logged in on mobile)`);
            }
          } catch (err) {
            console.error(`[Socket] ❌ FCM lookup failed for userId=${pid}: ${err.message}`);
          }
        }
      } catch (err) {
        console.error(`[Socket] ❌ message:send handler error: ${err.message}`);
        socket.emit("error", { message: err.message || "Failed to send message" });
      }
    });

    // ── Typing indicators ─────────────────────────────────────────────────
    socket.on("typing:start", ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit("typing:start", {
        conversationId,
        userId,
        name: `${socket.user.first_name} ${socket.user.last_name}`,
      });
    });

    socket.on("typing:stop", ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit("typing:stop", { conversationId, userId });
    });

    // ── Mark messages as read ─────────────────────────────────────────────
    socket.on("messages:read", async ({ conversationId }) => {
      try {
        await chatService.markAsRead(conversationId, userId);
        io.to(`conv:${conversationId}`).emit("messages:read", { conversationId, userId });
      } catch {
        /* silent */
      }
    });

    // ── Delete a message ──────────────────────────────────────────────────
    socket.on("message:delete", async ({ conversationId, messageId }) => {
      try {
        await chatService.deleteMessage(conversationId, messageId, userId);
        io.to(`conv:${conversationId}`).emit("message:deleted", { conversationId, messageId });
      } catch (err) {
        socket.emit("error", { message: err.message || "Failed to delete message" });
      }
    });

    // ── Request online status ─────────────────────────────────────────────
    socket.on("users:online_status", ({ userIds }) => {
      const statuses = {};
      (userIds || []).forEach((uid) => { statuses[uid] = isOnline(uid); });
      socket.emit("users:online_status", statuses);
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on("disconnect", (reason) => {
      removeOnline(userId, socket.id);
      if (!isOnline(userId)) {
        io.emit("user:online", { userId, online: false });
      }
      console.log(`❌ [Socket] Disconnected: ${socket.user.first_name} | userId=${userId} | socketId=${socket.id} | reason=${reason}`);
    });
  });

  return io;
}

module.exports = initSocket;
