const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
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

      if (!token) return next(new Error("Authentication token required"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId  = decoded.userId || decoded.sub || decoded.id;
      const user    = await User.findById(userId).select("first_name last_name email roles status");

      if (!user || user.status === "inactive")
        return next(new Error("User not found or inactive"));

      socket.user = user;
      next();
    } catch {
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

    console.log(`✅ [Chat] ${socket.user.first_name} connected (${socket.id})`);

    // ── Join a conversation room ──────────────────────────────────────────
    socket.on("conversation:join", async ({ conversationId }) => {
      try {
        // Verify membership before joining
        const result = await chatService.getConversation(conversationId, userId);
        socket.join(`conv:${conversationId}`);
        socket.emit("conversation:joined", { conversationId });

        // Mark as read when joining
        await chatService.markAsRead(conversationId, userId);
        io.to(`conv:${conversationId}`).emit("messages:read", { conversationId, userId });
      } catch (err) {
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
      try {
        const { conversationId, content, images_url, image_names } = payload;

        const result = await chatService.sendMessage(
          conversationId,
          userId,
          { content, images_url, image_names },
        );

        // Broadcast the new message to everyone in the conversation room
        io.to(`conv:${conversationId}`).emit("message:new", {
          conversationId,
          message: result.data,
        });

        // Push a notification to the OTHER participant(s) if they are not in the room
        const conv = result.conversation;
        const hasImages = Array.isArray(images_url) && images_url.length > 0;
        conv.participants.forEach((participant) => {
          const pid = String(participant._id || participant);
          if (pid !== userId) {
            const socketsInRoom = io.sockets.adapter.rooms.get(`conv:${conversationId}`);
            const participantSids = onlineUsers.get(pid);
            const isInRoom = participantSids &&
              [...participantSids].some((sid) => socketsInRoom?.has(sid));

            if (!isInRoom) {
              emitToUser(pid, "notification:message", {
                conversationId,
                from: {
                  _id:        socket.user._id,
                  first_name: socket.user.first_name,
                  last_name:  socket.user.last_name,
                },
                preview: hasImages && !content?.trim()
                  ? `📷 ${images_url.length > 1 ? `${images_url.length} Images` : "Image"}`
                  : (content?.trim() || ""),
                sent_at: result.data.sent_at,
              });
            }
          }
        });
      } catch (err) {
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
    socket.on("disconnect", () => {
      removeOnline(userId, socket.id);
      if (!isOnline(userId)) {
        io.emit("user:online", { userId, online: false });
      }
      console.log(`❌ [Chat] ${socket.user.first_name} disconnected (${socket.id})`);
    });
  });

  return io;
}

module.exports = initSocket;
