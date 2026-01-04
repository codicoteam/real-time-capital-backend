const Attachment = require("../models/attachment.model");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
let uuidv4;
(async () => {
  ({ v4: uuidv4 } = await import("uuid"));
})();

class AttachmentService {
  /**
   * Upload and create an attachment
   * @param {Object} attachmentData - Attachment data
   * @param {Object} file - Uploaded file (if any)
   * @returns {Promise<Object>} Created attachment
   */
  async createAttachment(attachmentData, file) {
    try {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Validate required fields
        if (!attachmentData.owner_user) {
          throw new Error("Owner user ID is required");
        }

        if (!attachmentData.entity_type || !attachmentData.entity_id) {
          throw new Error("Entity type and entity ID are required");
        }

        if (!attachmentData.filename) {
          throw new Error("Filename is required");
        }

        // Validate entity_type
        const validEntityTypes = [
          "LoanApplication",
          "Loan",
          "Asset",
          "User",
          "Ticket",
          "DebtorRecord",
          "Other",
        ];
        if (!validEntityTypes.includes(attachmentData.entity_type)) {
          throw new Error(
            `Invalid entity type. Must be one of: ${validEntityTypes.join(
              ", "
            )}`
          );
        }

        // Handle file upload if storage is local
        if (attachmentData.storage === "local" && file) {
          // Create uploads directory if it doesn't exist
          const uploadDir = path.join(__dirname, "../uploads/attachments");
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }

          // Generate unique filename
          const fileExt = path.extname(file.originalname);
          const uniqueFilename = `${uuidv4()}${fileExt}`;
          const filePath = path.join(uploadDir, uniqueFilename);

          // Save file
          await fs.promises.writeFile(filePath, file.buffer);

          // Update attachment data
          attachmentData.url = `/uploads/attachments/${uniqueFilename}`;
          attachmentData.filename = file.originalname;
          attachmentData.mime_type = file.mimetype;
        } else if (attachmentData.storage === "url" && !attachmentData.url) {
          throw new Error("URL is required for URL storage type");
        }

        // For gridfs or s3, you would handle those here
        // This is a placeholder for those implementations
        if (attachmentData.storage === "gridfs") {
          // Implement GridFS storage logic
          attachmentData.gridfs_id = new mongoose.Types.ObjectId();
        } else if (attachmentData.storage === "s3") {
          // Implement S3 storage logic
          // This would require AWS SDK configuration
        }

        // Create the attachment
        const attachment = new Attachment(attachmentData);
        await attachment.save({ session });

        await session.commitTransaction();
        session.endSession();

        // Populate user references
        await attachment.populate([
          { path: "owner_user", select: "first_name last_name email roles" },
          { path: "signed_by", select: "first_name last_name email" },
        ]);

        return {
          success: true,
          data: attachment,
          message: "Attachment created successfully",
        };
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
      }
    } catch (error) {
      console.error("Error creating attachment:", error);
      throw new Error(`Failed to create attachment: ${error.message}`);
    }
  }

  /**
   * Get all attachments with pagination and filtering
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Paginated attachments
   */
  async getAllAttachments(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = "created_at",
        sortOrder = "desc",
        entity_type = "",
        entity_id = "",
        category = "",
        owner_user = "",
        search = "",
        signed = "",
        startDate = "",
        endDate = "",
      } = options;

      // Build query
      const query = {};

      // Filter by entity
      if (entity_type) {
        query.entity_type = entity_type;
      }
      if (entity_id) {
        query.entity_id = entity_id;
      }

      // Filter by category
      if (category) {
        query.category = category;
      }

      // Filter by owner
      if (owner_user) {
        query.owner_user = owner_user;
      }

      // Filter by signed status
      if (signed !== "") {
        query.signed = signed === "true";
      }

      // Search by filename or mime_type
      if (search) {
        query.$or = [
          { filename: { $regex: search, $options: "i" } },
          { mime_type: { $regex: search, $options: "i" } },
        ];
      }

      // Date range filter
      if (startDate || endDate) {
        query.created_at = {};
        if (startDate) {
          query.created_at.$gte = new Date(startDate);
        }
        if (endDate) {
          query.created_at.$lte = new Date(endDate);
        }
      }

      // Calculate skip value for pagination
      const skip = (page - 1) * limit;

      // Execute query with pagination
      const [attachments, total] = await Promise.all([
        Attachment.find(query)
          .populate([
            { path: "owner_user", select: "first_name last_name email roles" },
            { path: "signed_by", select: "first_name last_name email" },
          ])
          .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Attachment.countDocuments(query),
      ]);

      return {
        success: true,
        data: {
          attachments,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
        message: "Attachments retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching attachments:", error);
      throw new Error(`Failed to fetch attachments: ${error.message}`);
    }
  }

  /**
   * Get attachments without pagination (for dropdowns, etc.)
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} Array of attachments
   */
  async getAttachmentsWithoutPagination(filters = {}) {
    try {
      const query = {};

      // Apply filters
      if (filters.entity_type) {
        query.entity_type = filters.entity_type;
      }
      if (filters.entity_id) {
        query.entity_id = filters.entity_id;
      }
      if (filters.category) {
        query.category = filters.category;
      }
      if (filters.owner_user) {
        query.owner_user = filters.owner_user;
      }
      if (filters.signed !== undefined) {
        query.signed = filters.signed;
      }

      const attachments = await Attachment.find(query)
        .populate([
          { path: "owner_user", select: "first_name last_name email" },
          { path: "signed_by", select: "first_name last_name email" },
        ])
        .sort({ created_at: -1 })
        .lean();

      return {
        success: true,
        data: attachments,
        message: "Attachments retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching attachments without pagination:", error);
      throw new Error(`Failed to fetch attachments: ${error.message}`);
    }
  }

  /**
   * Get a single attachment by ID
   * @param {string} id - Attachment ID
   * @returns {Promise<Object>} Attachment
   */
  async getAttachmentById(id) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid attachment ID");
      }

      const attachment = await Attachment.findById(id)
        .populate([
          { path: "owner_user", select: "first_name last_name email roles" },
          { path: "signed_by", select: "first_name last_name email" },
        ])
        .lean();

      if (!attachment) {
        throw new Error("Attachment not found");
      }

      return {
        success: true,
        data: attachment,
        message: "Attachment retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching attachment:", error);
      throw new Error(`Failed to fetch attachment: ${error.message}`);
    }
  }

  /**
   * Update an attachment
   * @param {string} id - Attachment ID
   * @param {Object} updateData - Data to update
   * @param {Object} user - Current user performing the update
   * @returns {Promise<Object>} Updated attachment
   */
  async updateAttachment(id, updateData, user) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid attachment ID");
      }

      // Handle signing
      if (updateData.signed === true && !updateData.signed_by) {
        updateData.signed_by = user._id;
        updateData.signed_at = new Date();
      } else if (updateData.signed === false) {
        updateData.signed_by = null;
        updateData.signed_at = null;
      }

      const attachment = await Attachment.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      })
        .populate([
          { path: "owner_user", select: "first_name last_name email roles" },
          { path: "signed_by", select: "first_name last_name email" },
        ])
        .lean();

      if (!attachment) {
        throw new Error("Attachment not found");
      }

      return {
        success: true,
        data: attachment,
        message: "Attachment updated successfully",
      };
    } catch (error) {
      console.error("Error updating attachment:", error);
      throw new Error(`Failed to update attachment: ${error.message}`);
    }
  }

  /**
   * Delete an attachment
   * @param {string} id - Attachment ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteAttachment(id) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid attachment ID");
      }

      // Get attachment first to handle file deletion if stored locally
      const attachment = await Attachment.findById(id);
      if (!attachment) {
        throw new Error("Attachment not found");
      }

      // If storage is local, delete the file
      if (attachment.storage === "local" && attachment.url) {
        const filePath = path.join(__dirname, "..", attachment.url);
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      }

      // If storage is gridfs, you would delete from GridFS here
      if (attachment.storage === "gridfs" && attachment.gridfs_id) {
        // Implement GridFS deletion logic
      }

      // If storage is s3, you would delete from S3 here
      if (attachment.storage === "s3" && attachment.url) {
        // Implement S3 deletion logic
      }

      // Delete the attachment record
      await Attachment.findByIdAndDelete(id);

      return {
        success: true,
        data: { id },
        message: "Attachment deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting attachment:", error);
      throw new Error(`Failed to delete attachment: ${error.message}`);
    }
  }

  /**
   * Get attachments by entity
   * @param {string} entityType - Entity type
   * @param {string} entityId - Entity ID
   * @returns {Promise<Object>} Array of attachments
   */
  async getAttachmentsByEntity(entityType, entityId) {
    try {
      if (!entityType || !entityId) {
        throw new Error("Entity type and entity ID are required");
      }

      const attachments = await Attachment.find({
        entity_type: entityType,
        entity_id: entityId,
      })
        .populate([
          { path: "owner_user", select: "first_name last_name email" },
          { path: "signed_by", select: "first_name last_name email" },
        ])
        .sort({ created_at: -1 })
        .lean();

      return {
        success: true,
        data: attachments,
        message: "Attachments retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching attachments by entity:", error);
      throw new Error(`Failed to fetch attachments: ${error.message}`);
    }
  }

  /**
   * Get attachments by user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Array of attachments
   */
  async getAttachmentsByUser(userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error("Invalid user ID");
      }

      const attachments = await Attachment.find({
        $or: [{ owner_user: userId }, { signed_by: userId }],
      })
        .populate([
          { path: "owner_user", select: "first_name last_name email" },
          { path: "signed_by", select: "first_name last_name email" },
        ])
        .sort({ created_at: -1 })
        .lean();

      return {
        success: true,
        data: attachments,
        message: "Attachments retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching attachments by user:", error);
      throw new Error(`Failed to fetch attachments: ${error.message}`);
    }
  }

  /**
   * Sign an attachment
   * @param {string} id - Attachment ID
   * @param {Object} user - User signing the attachment
   * @returns {Promise<Object>} Updated attachment
   */
  async signAttachment(id, user) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid attachment ID");
      }

      const updateData = {
        signed: true,
        signed_by: user._id,
        signed_at: new Date(),
      };

      const attachment = await Attachment.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      })
        .populate([
          { path: "owner_user", select: "first_name last_name email" },
          { path: "signed_by", select: "first_name last_name email" },
        ])
        .lean();

      if (!attachment) {
        throw new Error("Attachment not found");
      }

      return {
        success: true,
        data: attachment,
        message: "Attachment signed successfully",
      };
    } catch (error) {
      console.error("Error signing attachment:", error);
      throw new Error(`Failed to sign attachment: ${error.message}`);
    }
  }

  /**
   * Get attachment statistics
   * @returns {Promise<Object>} Statistics data
   */
  async getStatistics() {
    try {
      const stats = await Attachment.aggregate([
        {
          $group: {
            _id: "$entity_type",
            count: { $sum: 1 },
            signedCount: {
              $sum: { $cond: [{ $eq: ["$signed", true] }, 1, 0] },
            },
          },
        },
        {
          $project: {
            entityType: "$_id",
            count: 1,
            signedCount: 1,
            _id: 0,
          },
        },
        { $sort: { count: -1 } },
      ]);

      const categoryStats = await Attachment.aggregate([
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            category: "$_id",
            count: 1,
            _id: 0,
          },
        },
        { $sort: { count: -1 } },
      ]);

      const totalStats = await Attachment.aggregate([
        {
          $group: {
            _id: null,
            totalCount: { $sum: 1 },
            signedCount: {
              $sum: { $cond: [{ $eq: ["$signed", true] }, 1, 0] },
            },
            uniqueUsers: { $addToSet: "$owner_user" },
          },
        },
        {
          $project: {
            totalCount: 1,
            signedCount: 1,
            uniqueUserCount: { $size: "$uniqueUsers" },
            _id: 0,
          },
        },
      ]);

      return {
        success: true,
        data: {
          byEntityType: stats,
          byCategory: categoryStats,
          totals: totalStats[0] || {
            totalCount: 0,
            signedCount: 0,
            uniqueUserCount: 0,
          },
        },
        message: "Statistics retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching statistics:", error);
      throw new Error(`Failed to fetch statistics: ${error.message}`);
    }
  }
}

module.exports = new AttachmentService();
