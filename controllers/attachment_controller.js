const attachmentService = require('../services/attachment_service');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store in memory for processing

const fileFilter = (req, file, cb) => {
  // Accept all file types, but you can restrict if needed
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: ${allowedMimeTypes.join(', ')}`), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1 // Only one file at a time
  }
});

class AttachmentController {
  /**
   * Upload and create an attachment
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async uploadAttachment(req, res) {
    try {
      // Use multer middleware to handle file upload
      upload.single('file')(req, res, async (err) => {
        try {
          if (err) {
            return res.status(400).json({
              success: false,
              error: `File upload error: ${err.message}`
            });
          }

          const attachmentData = {
            ...req.body,
            owner_user: req.user._id // Set owner to current user
          };

          // If entity_type and entity_id are not provided, use defaults
          if (!attachmentData.entity_type) {
            attachmentData.entity_type = 'Other';
          }

          const result = await attachmentService.createAttachment(
            attachmentData,
            req.file
          );

          res.status(201).json({
            success: true,
            data: result.data,
            message: result.message
          });
        } catch (error) {
          res.status(400).json({
            success: false,
            error: error.message
          });
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: `Server error: ${error.message}`
      });
    }
  }

  /**
   * Get all attachments with pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAllAttachments(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = 'created_at',
        sortOrder = 'desc',
        entity_type,
        entity_id,
        category,
        owner_user,
        search,
        signed,
        startDate,
        endDate
      } = req.query;

      const result = await attachmentService.getAllAttachments({
        page,
        limit,
        sortBy,
        sortOrder,
        entity_type,
        entity_id,
        category,
        owner_user,
        search,
        signed,
        startDate,
        endDate
      });

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get attachments without pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAttachmentsWithoutPagination(req, res) {
    try {
      const {
        entity_type,
        entity_id,
        category,
        owner_user,
        signed
      } = req.query;

      const filters = {};
      if (entity_type) filters.entity_type = entity_type;
      if (entity_id) filters.entity_id = entity_id;
      if (category) filters.category = category;
      if (owner_user) filters.owner_user = owner_user;
      if (signed !== undefined) filters.signed = signed === 'true';

      const result = await attachmentService.getAttachmentsWithoutPagination(filters);

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get a single attachment by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAttachmentById(req, res) {
    try {
      const { id } = req.params;

      const result = await attachmentService.getAttachmentById(id);

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      if (error.message === 'Attachment not found') {
        res.status(404).json({
          success: false,
          error: error.message
        });
      } else if (error.message === 'Invalid attachment ID') {
        res.status(400).json({
          success: false,
          error: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  }

  /**
   * Update an attachment
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateAttachment(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const result = await attachmentService.updateAttachment(id, updateData, req.user);

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      if (error.message === 'Attachment not found') {
        res.status(404).json({
          success: false,
          error: error.message
        });
      } else if (error.message === 'Invalid attachment ID') {
        res.status(400).json({
          success: false,
          error: error.message
        });
      } else {
        res.status(400).json({
          success: false,
          error: error.message
        });
      }
    }
  }

  /**
   * Delete an attachment
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteAttachment(req, res) {
    try {
      const { id } = req.params;

      const result = await attachmentService.deleteAttachment(id);

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      if (error.message === 'Attachment not found') {
        res.status(404).json({
          success: false,
          error: error.message
        });
      } else if (error.message === 'Invalid attachment ID') {
        res.status(400).json({
          success: false,
          error: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  }

  /**
   * Get attachments by entity
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAttachmentsByEntity(req, res) {
    try {
      const { entityType, entityId } = req.params;

      const result = await attachmentService.getAttachmentsByEntity(entityType, entityId);

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get attachments by user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAttachmentsByUser(req, res) {
    try {
      const { userId } = req.params;

      const result = await attachmentService.getAttachmentsByUser(userId);

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      if (error.message === 'Invalid user ID') {
        res.status(400).json({
          success: false,
          error: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  }

  /**
   * Sign an attachment
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async signAttachment(req, res) {
    try {
      const { id } = req.params;

      const result = await attachmentService.signAttachment(id, req.user);

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      if (error.message === 'Attachment not found') {
        res.status(404).json({
          success: false,
          error: error.message
        });
      } else if (error.message === 'Invalid attachment ID') {
        res.status(400).json({
          success: false,
          error: error.message
        });
      } else {
        res.status(400).json({
          success: false,
          error: error.message
        });
      }
    }
  }

  /**
   * Get attachment statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getStatistics(req, res) {
    try {
      const result = await attachmentService.getStatistics();

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Download an attachment
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async downloadAttachment(req, res) {
    try {
      const { id } = req.params;

      const result = await attachmentService.getAttachmentById(id);
      const attachment = result.data;

      // Handle different storage types
      if (attachment.storage === 'local' && attachment.url) {
        const filePath = path.join(__dirname, '..', attachment.url);
        
        if (fs.existsSync(filePath)) {
          res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
          res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`);
          
          const fileStream = fs.createReadStream(filePath);
          fileStream.pipe(res);
        } else {
          res.status(404).json({
            success: false,
            error: 'File not found on server'
          });
        }
      } else if (attachment.storage === 'url' && attachment.url) {
        // Redirect to the URL
        res.redirect(attachment.url);
      } else if (attachment.storage === 'gridfs') {
        // Implement GridFS download logic
        res.status(501).json({
          success: false,
          error: 'GridFS download not implemented yet'
        });
      } else if (attachment.storage === 's3') {
        // Implement S3 download logic
        res.status(501).json({
          success: false,
          error: 'S3 download not implemented yet'
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Attachment file not available for download'
        });
      }
    } catch (error) {
      if (error.message === 'Attachment not found') {
        res.status(404).json({
          success: false,
          error: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  }
}

module.exports = new AttachmentController();