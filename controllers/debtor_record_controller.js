const debtorRecordService = require('../services/debtor_record_service');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'debtor-csv-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept CSV files only
  if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
    cb(null, true);
  } else {
    cb(new Error('Only CSV files are allowed'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

class DebtorRecordController {
  /**
   * Upload and process CSV file
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async uploadCSV(req, res) {
    try {
      // Use multer middleware to handle file upload
      upload.single('csvFile')(req, res, async (err) => {
        try {
          if (err) {
            return res.status(400).json({
              success: false,
              error: `File upload error: ${err.message}`
            });
          }

          if (!req.file) {
            return res.status(400).json({
              success: false,
              error: 'No CSV file provided'
            });
          }

          const { source_period_label } = req.body;
          
          const result = await debtorRecordService.processCSV(
            req.file.path,
            source_period_label || 'DEBTORS LIST'
          );

          res.status(200).json({
            success: true,
            data: result.data,
            message: result.message
          });
        } catch (error) {
          // Clean up uploaded file if there's an error
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          
          res.status(500).json({
            success: false,
            error: `Failed to process CSV: ${error.message}`
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
   * Create a single debtor record
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createRecord(req, res) {
    try {
      const recordData = req.body;
      
      const result = await debtorRecordService.createRecord(recordData);
      
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
  }

  /**
   * Create multiple debtor records
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createMultipleRecords(req, res) {
    try {
      const recordsData = req.body;
      
      if (!Array.isArray(recordsData)) {
        return res.status(400).json({
          success: false,
          error: 'Request body must be an array of records'
        });
      }

      if (recordsData.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No records provided'
        });
      }

      const result = await debtorRecordService.createMultipleRecords(recordsData);
      
      if (result.data.failed > 0) {
        res.status(207).json({
          success: true,
          data: result.data,
          message: result.message
        });
      } else {
        res.status(201).json({
          success: true,
          data: result.data,
          message: result.message
        });
      }
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get all debtor records with pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAllRecords(req, res) {
    try {
      const {
        page = 1,
        limit = 50,
        sortBy = 'created_at',
        sortOrder = 'desc',
        search,
        status,
        branch,
        startDate,
        endDate
      } = req.query;

      const result = await debtorRecordService.getAllRecords({
        page,
        limit,
        sortBy,
        sortOrder,
        search,
        status,
        branch,
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
   * Get a single debtor record by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getRecordById(req, res) {
    try {
      const { id } = req.params;
      
      const result = await debtorRecordService.getRecordById(id);
      
      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      if (error.message === 'Record not found') {
        res.status(404).json({
          success: false,
          error: error.message
        });
      } else if (error.message === 'Invalid record ID') {
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
   * Update a debtor record
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateRecord(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const result = await debtorRecordService.updateRecord(id, updateData);
      
      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      if (error.message === 'Record not found') {
        res.status(404).json({
          success: false,
          error: error.message
        });
      } else if (error.message === 'Invalid record ID') {
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
   * Delete a debtor record
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteRecord(req, res) {
    try {
      const { id } = req.params;
      
      const result = await debtorRecordService.deleteRecord(id);
      
      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message
      });
    } catch (error) {
      if (error.message === 'Record not found') {
        res.status(404).json({
          success: false,
          error: error.message
        });
      } else if (error.message === 'Invalid record ID') {
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
   * Get statistics for debtor records
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getStatistics(req, res) {
    try {
      const result = await debtorRecordService.getStatistics();
      
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
}

module.exports = new DebtorRecordController();