const Conversation = require("../models/chat.model");
const User = require("../models/user.model");

// ── Role-pair whitelist ───────────────────────────────────────────────────────
// Each entry = set of two roles that are allowed to open a conversation.
const ALLOWED_ROLE_PAIRS = [
  new Set(["customer",              "loan_officer_processor"]),
  new Set(["customer",              "agent"]),
  new Set(["agent",                 "loan_officer_processor"]),
  new Set(["agent",                 "loan_officer_approval"]),
  new Set(["loan_officer_processor","admin_pawn_limited"]),
  new Set(["loan_officer_processor","loan_officer_approval"]),
  new Set(["loan_officer_processor","super_admin_vendor"]),
  new Set(["agent",                 "admin_pawn_limited"]),
  new Set(["agent",                 "super_admin_vendor"]),
  new Set(["admin_pawn_limited",    "super_admin_vendor"]),
  new Set(["loan_officer_approval", "admin_pawn_limited"]),
  new Set(["loan_officer_approval", "super_admin_vendor"]),
];

function rolesAllowed(rolesA, rolesB) {
  for (const pair of ALLOWED_ROLE_PAIRS) {
    const hasA = rolesA.some((r) => pair.has(r));
    const hasB = rolesB.some((r) => pair.has(r));
    if (hasA && hasB) return true;
  }
  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const populateConversation = (query) =>
  query
    .populate("participants", "first_name last_name email roles profile_pic_url")
    .populate("messages.sender", "first_name last_name roles profile_pic_url")
    .populate("last_sender", "first_name last_name")
    .populate("related_loan", "loan_no status")
    .populate("related_application", "application_no status");

class ChatService {

  /* ── Get or create a 1-to-1 conversation ─────────────────────────────────── */
  async getOrCreateConversation(userAId, userBId, options = {}) {
    const [userA, userB] = await Promise.all([
      User.findById(userAId).select("roles first_name last_name"),
      User.findById(userBId).select("roles first_name last_name"),
    ]);

    if (!userA) throw { status: 404, message: "Your account was not found" };
    if (!userB) throw { status: 404, message: "The other user was not found" };

    if (!rolesAllowed(userA.roles, userB.roles)) {
      throw {
        status: 403,
        message: `A chat between a ${userA.roles[0]} and a ${userB.roles[0]} is not permitted`,
      };
    }

    // Find existing conversation (participants order-independent)
    let conv = await populateConversation(
      Conversation.findOne({
        participants: { $all: [userAId, userBId], $size: 2 },
      }),
    );

    if (!conv) {
      conv = new Conversation({
        participants:      [userAId, userBId],
        participant_roles: [...userA.roles, ...userB.roles],
        related_loan:        options.related_loan || undefined,
        related_application: options.related_application || undefined,
      });
      await conv.save();
      conv = await populateConversation(Conversation.findById(conv._id));
    }

    return { success: true, data: conv, message: "Conversation ready" };
  }

  /* ── List conversations for a user ───────────────────────────────────────── */
  async getUserConversations(userId) {
    const convs = await populateConversation(
      Conversation.find({
        participants: userId,
        is_active: true,
      }).sort({ last_message_at: -1 }),
    );

    // Attach unread count per conversation
    const result = convs.map((c) => {
      const unread = c.messages.filter(
        (m) => !m.read_by.some((id) => String(id) === String(userId)),
      ).length;
      return { ...c.toObject(), unread_count: unread };
    });

    return { success: true, data: result, message: "Conversations loaded" };
  }

  /* ── Get a single conversation with messages ─────────────────────────────── */
  async getConversation(conversationId, userId) {
    const conv = await populateConversation(
      Conversation.findOne({ _id: conversationId, participants: userId }),
    );
    if (!conv) throw { status: 404, message: "Conversation not found" };
    return { success: true, data: conv, message: "Conversation loaded" };
  }

  /* ── Send a message ──────────────────────────────────────────────────────── */
  async sendMessage(conversationId, senderId, { content, images_url, image_names }) {
    const hasImages = Array.isArray(images_url) && images_url.length > 0;
    if (!content?.trim() && !hasImages) {
      throw { status: 400, message: "Message must have text or at least one image" };
    }

    const conv = await Conversation.findOne({
      _id: conversationId,
      participants: senderId,
    });
    if (!conv) throw { status: 404, message: "Conversation not found" };

    const message_type = content?.trim() && hasImages
      ? "text_image"
      : hasImages ? "image" : "text";

    const msg = {
      sender:      senderId,
      content:     content?.trim() || "",
      images_url:  hasImages ? images_url : [],
      image_names: Array.isArray(image_names) ? image_names : [],
      message_type,
      read_by:     [senderId],
    };

    conv.messages.push(msg);
    conv.last_message    = hasImages && !content?.trim()
      ? `📷 ${images_url.length > 1 ? `${images_url.length} Images` : "Image"}`
      : (content?.trim() || "");
    conv.last_message_at = new Date();
    conv.last_sender     = senderId;
    await conv.save();

    // Return the populated message
    const updated = await populateConversation(Conversation.findById(conv._id));
    const savedMsg = updated.messages[updated.messages.length - 1];

    return { success: true, data: savedMsg, conversation: updated };
  }

  /* ── Mark messages as read ───────────────────────────────────────────────── */
  async markAsRead(conversationId, userId) {
    await Conversation.updateOne(
      { _id: conversationId, participants: userId },
      {
        $addToSet: { "messages.$[msg].read_by": userId },
      },
      {
        arrayFilters: [{ "msg.read_by": { $ne: userId } }],
        multi: true,
      },
    );
    return { success: true, message: "Messages marked as read" };
  }

  /* ── Delete a message (soft) ─────────────────────────────────────────────── */
  async deleteMessage(conversationId, messageId, userId) {
    const conv = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });
    if (!conv) throw { status: 404, message: "Conversation not found" };

    const msg = conv.messages.id(messageId);
    if (!msg) throw { status: 404, message: "Message not found" };
    if (String(msg.sender) !== String(userId)) {
      throw { status: 403, message: "You can only delete your own messages" };
    }

    msg.is_deleted = true;
    msg.content    = "";
    msg.image_url  = undefined;
    await conv.save();

    return { success: true, message: "Message deleted" };
  }

  /* ── Get users this user can chat with (by role) ─────────────────────────── */
  async getChatableUsers(userId) {
    const me = await User.findById(userId).select("roles");
    if (!me) throw { status: 404, message: "User not found" };

    // Collect all roles that can talk with me
    const talkableRoles = new Set();
    for (const pair of ALLOWED_ROLE_PAIRS) {
      const myRoles = me.roles;
      const pairArr = [...pair];
      if (myRoles.some((r) => pair.has(r))) {
        pairArr.forEach((r) => {
          if (!myRoles.includes(r)) talkableRoles.add(r);
        });
      }
    }

    const users = await User.find({
      _id:    { $ne: userId },
      roles:  { $in: [...talkableRoles] },
      status: "active",
    }).select("first_name last_name email roles profile_pic_url");

    return { success: true, data: users, message: "Chatable users loaded" };
  }
}

module.exports = new ChatService();
