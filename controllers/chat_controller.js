const chatService = require("../services/chat_service");

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
    try {
      const { content, images_url, image_names } = req.body;
      const result = await chatService.sendMessage(
        req.params.id,
        req.user._id,
        { content, images_url, image_names },
      );
      res.status(201).json({ success: true, data: result.data, message: "Message sent" });
    } catch (e) {
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
