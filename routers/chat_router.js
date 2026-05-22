const express = require("express");
const router  = express.Router();
const chatController = require("../controllers/chat_controller");
const { authMiddleware } = require("../middlewares/auth_middleware");

// All chat routes require authentication
router.use(authMiddleware);

// Get all users this user is allowed to chat with
router.get("/chatable-users", chatController.getChatableUsers);

// List all conversations for the current user
router.get("/", chatController.getUserConversations);

// Get or create a direct conversation with another user
router.get("/with/:otherUserId", chatController.getOrCreateConversation);

// Get a single conversation (with all messages)
router.get("/:id", chatController.getConversation);

// Send a message into a conversation
router.post("/:id/messages", chatController.sendMessage);

// Mark all messages in a conversation as read
router.put("/:id/read", chatController.markAsRead);

// Soft-delete a message
router.delete("/:id/messages/:messageId", chatController.deleteMessage);

module.exports = router;
