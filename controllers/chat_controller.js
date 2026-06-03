const chatService = require("../services/chat_service");
const admin = require("firebase-admin");
const User  = require("../models/user.model");

class ChatController {

  async getOrCreateConversation(req, res) {
    try {
      const { otherUserId } = req.params;
      const { related_loan, related_application } = req.query;
      const result = await chatService.getOrCreateConversation(
        req.user._id,
        otherUserId,
        { related_loan, related_application },
      );
      res.status(200).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ success: false, message: e.message || "Server error" });
    }
  }

  async getUserConversations(req, res) {
    try {
      const result = await chatService.getUserConversations(req.user._id);
      res.status(200).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ success: false, message: e.message });
    }
  }

  async getConversation(req, res) {
    try {
      const result = await chatService.getConversation(req.params.id, req.user._id);
      res.status(200).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ success: false, message: e.message });
    }
  }

  async sendMessage(req, res) {
    const conversationId = String(req.params.id);
    const senderId       = String(req.user._id);
    console.log(`[REST] sendMessage — userId=${senderId}, convId=${conversationId}, content="${req.body.content || ""}", images=${(req.body.images_url||[]).length}`);
    try {
      const { content, images_url, image_names } = req.body;
      const result = await chatService.sendMessage(
        conversationId,
        req.user._id,
        { content, images_url, image_names },
      );
      console.log(`[REST] ✅ Message saved — msgId=${result.data._id}`);

      // ── Real-time broadcast ────────────────────────────────────────────────
      // Emit socket events so web and mobile clients receive this message
      // instantly, regardless of whether the sender used socket or REST.
      const io = req.app.get("io");

      if (io) {
        const room = `conv:${conversationId}`;
        const roomSockets = io.sockets.adapter.rooms.get(room);
        console.log(`[REST] Broadcasting message:new to ${room} — ${roomSockets?.size || 0} socket(s)`);
        io.to(room).emit("message:new", { conversationId, message: result.data });

        const senderName = `${req.user.first_name} ${req.user.last_name}`.trim();
        const hasImages  = Array.isArray(images_url) && images_url.length > 0;
        const preview    = hasImages && !content?.trim()
          ? `📷 ${images_url.length > 1 ? `${images_url.length} Images` : "Image"}`
          : (content?.trim() || "");

        for (const participant of result.conversation.participants) {
          const pid = String(participant._id || participant);
          if (pid === senderId) continue;

          const convRoom = io.sockets.adapter.rooms.get(`conv:${conversationId}`);
          const userRoom = io.sockets.adapter.rooms.get(`user:${pid}`);
          const isInRoom = userRoom
            ? [...userRoom].some((sid) => convRoom?.has(sid))
            : false;

          if (!isInRoom) {
            io.to(`user:${pid}`).emit("notification:message", {
              conversationId,
              from: { _id: req.user._id, first_name: req.user.first_name, last_name: req.user.last_name },
              preview,
              sent_at: result.data.sent_at,
            });
          }

          // FCM push — reach background / closed app
          try {
            const recipient = await User.findById(pid).select("fcm_tokens");
            console.log(`[REST] FCM lookup for userId=${pid} — tokens=${recipient?.fcm_tokens?.length || 0}`);
            if (recipient?.fcm_tokens?.length) {
              for (const token of recipient.fcm_tokens) {
                try {
                  await admin.messaging().send({
                    token,
                    notification: { title: senderName, body: preview || "New message" },
                    data: { type: "chat_message", conversationId, senderId, senderName },
                    android: { priority: "high", notification: { tag: `chat_${conversationId}` } },
                    apns: { payload: { aps: { sound: "default", badge: "1" } } },
                  });
                  console.log(`[REST] ✅ FCM push sent to userId=${pid}`);
                } catch (err) {
                  if (
                    err.code === "messaging/invalid-registration-token" ||
                    err.code === "messaging/registration-token-not-registered"
                  ) {
                    await User.updateOne({ _id: pid }, { $pull: { fcm_tokens: token } });
                    console.log(`[REST] 🗑 Removed stale FCM token for userId=${pid}`);
                  } else {
                    console.error(`[REST] ❌ FCM error for userId=${pid}: ${err.code} — ${err.message}`);
                  }
                }
              }
            } else {
              console.warn(`[REST] ⚠️ No FCM tokens for userId=${pid} — push skipped`);
            }
          } catch (err) {
            console.error(`[REST] ❌ FCM lookup failed for userId=${pid}: ${err.message}`);
          }
        }
      } else {
        console.warn(`[REST] ⚠️ io not available — socket broadcast skipped`);
      }

      res.status(201).json({ success: true, data: result.data, message: "Message sent" });
    } catch (e) {
      console.error(`[REST] ❌ sendMessage error: ${e.message}`);
      res.status(e.status || 500).json({ success: false, message: e.message });
    }
  }

  async markAsRead(req, res) {
    try {
      const result = await chatService.markAsRead(req.params.id, req.user._id);
      res.status(200).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ success: false, message: e.message });
    }
  }

  async deleteMessage(req, res) {
    try {
      const result = await chatService.deleteMessage(
        req.params.id,
        req.params.messageId,
        req.user._id,
      );
      res.status(200).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ success: false, message: e.message });
    }
  }

  async getChatableUsers(req, res) {
    try {
      const result = await chatService.getChatableUsers(req.user._id);
      res.status(200).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ success: false, message: e.message });
    }
  }
}

module.exports = new ChatController();
