const DebtorRecord = require('../models/debtorRecord.model');
const csv = require('csv-parser');
const fs = require('fs');
const mongoose = require('mongoose');

class DebtorRecordService {
  /**
   * Create a single debtor record
   * @param {Object} recordData - Debtor record data
   * @returns {Promise<Object>} Created record
   */
  async createRecord(recordData) {
    try {
      // Validate required fields
      if (!recordData.client_name) {
        throw new Error('Client name is required');
      }

      // Convert monetary fields to numbers
      const monetaryFields = ['principal', 'interest', 'amount_due', 'penalties', 'total_due', 'profit_loss_on_sale'];
      monetaryFields.forEach(field => {
        if (recordData[field]) {
          // Remove currency symbols and commas
          recordData[field] = this._parseCurrency(recordData[field]);
        }
      });

      // Parse dates
      if (recordData.date_of) {
        recordData.date_of = this._parseDate(recordData.date_of);
      }
      if (recordData.due_date) {
        recordData.due_date = this._parseDate(recordData.due_date);
      }

      // Set source information
      recordData.source = 'manual_entry';
      recordData.imported_at = new Date();

      const record = new DebtorRecord(recordData);
      await record.save();
      
      return {
        success: true,
        data: record,
        message: 'Debtor record created successfully'
      };
    } catch (error) {
      console.error('Error creating debtor record:', error);
      throw new Error(`Failed to create debtor record: ${error.message}`);
    }
  }

  /**
   * Create multiple debtor records
   * @param {Array} recordsData - Array of debtor record data
   * @returns {Promise<Object>} Result of bulk creation
   */
  async createMultipleRecords(recordsData) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const createdRecords = [];
      const errors = [];

      for (let i = 0; i < recordsData.length; i++) {
        try {
          const recordData = recordsData[i];
          
          // Validate required fields
          if (!recordData.client_name) {
            errors.push({
              index: i,
              error: 'Client name is required',
              data: recordData
            });
            continue;
          }

          // Process monetary fields
          const monetaryFields = ['principal', 'interest', 'amount_due', 'penalties', 'total_due', 'profit_loss_on_sale'];
          monetaryFields.forEach(field => {
            if (recordData[field]) {
              recordData[field] = this._parseCurrency(recordData[field]);
            }
          });

          // Process dates
          if (recordData.date_of) {
            recordData.date_of = this._parseDate(recordData.date_of);
          }
          if (recordData.due_date) {
            recordData.due_date = this._parseDate(recordData.due_date);
          }

          // Set source information
          recordData.source = 'bulk_entry';
          recordData.imported_at = new Date();

          const record = new DebtorRecord(recordData);
          await record.save({ session });
          createdRecords.push(record);
        } catch (error) {
          errors.push({
            index: i,
            error: error.message,
            data: recordsData[i]
          });
        }
      }

      await session.commitTransaction();
      session.endSession();

      return {
        success: true,
        data: {
          created: createdRecords.length,
          failed: errors.length,
          total: recordsData.length,
          errors: errors.length > 0 ? errors : undefined
        },
        message: `Created ${createdRecords.length} records, failed ${errors.length}`
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Error creating multiple records:', error);
      throw new Error(`Failed to create multiple records: ${error.message}`);
    }
  }

  /**
   * Process CSV file and create records
   * @param {string} filePath - Path to CSV file
   * @param {string} sourcePeriod - Source period label
   * @returns {Promise<Object>} Result of CSV processing
   */
  async processCSV(filePath, sourcePeriod) {
    const results = [];
    const errors = [];
    let headerRow = null;

    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv({ separator: ',' }))
        .on('headers', (headers) => {
          headerRow = headers;
          console.log('CSV Headers:', headers);
        })
        .on('data', (data) => {
          try {
            // Skip empty rows or rows without asset_no
            if (!data['ASSET NO'] || data['ASSET NO'].trim() === '') {
              return;
            }

            // Map CSV columns to model fields
            const recordData = {
              asset_no: data['ASSET NO']?.trim(),
              client_name: data['CLIENT NAME']?.trim(),
              principal: this._parseCurrency(data['PRINCIPAL']),
              interest: this._parseCurrency(data['INTEREST']),
              period: data['PERIOD']?.trim(),
              amount_due: this._parseCurrency(data['AMOUNT DUE']),
              penalties: this._parseCurrency(data['PENALTIES']),
              total_due: this._parseCurrency(data['TOTAL DUE']),
              profit_loss_on_sale: this._parseCurrency(data['P/L ON SALE']),
              date_of: this._parseDate(data['DATE OF DISBURSEMENT'] || data['DATE OF ']),
              due_date: this._parseDate(data['DUE DATE']),
              asset: data['ASSET ']?.trim(),
              specs: data['SPECS']?.trim(),
              asset_code: data['ASSET CODE']?.trim(),
              reg_or_serial_no: data['REG /SERIAL NO.']?.trim(),
              account_status: data['ACCOUNT STATUS']?.trim(),
              contact_details: data['CONTACT DETAILS']?.trim(),
              branch: data['BRANCH']?.trim() || 'HARARE',
              source: 'Debtors_list_final.csv',
              source_period_label: sourcePeriod,
              raw: data
            };

            results.push(recordData);
          } catch (error) {
            errors.push({
              row: results.length + 1,
              error: error.message,
              data: data
            });
          }
        })
        .on('end', async () => {
          try {
            // Save all records in a transaction
            const session = await mongoose.startSession();
            session.startTransaction();

            const savedRecords = [];
            const saveErrors = [];

            for (let i = 0; i < results.length; i++) {
              try {
                const record = new DebtorRecord(results[i]);
                await record.save({ session });
                savedRecords.push(record);
              } catch (error) {
                saveErrors.push({
                  index: i,
                  error: error.message,
                  data: results[i]
                });
              }
            }

            await session.commitTransaction();
            session.endSession();

            // Clean up the file
            fs.unlinkSync(filePath);

            resolve({
              success: true,
              data: {
                totalRows: results.length,
                saved: savedRecords.length,
                failed: saveErrors.length,
                errors: saveErrors.length > 0 ? saveErrors : undefined
              },
              message: `Processed ${results.length} rows, saved ${savedRecords.length} records`
            });
          } catch (error) {
            reject(new Error(`Failed to save records: ${error.message}`));
          }
        })
        .on('error', (error) => {
          reject(new Error(`CSV processing error: ${error.message}`));
        });
    });
  }

  /**
   * Get all debtor records with pagination and filtering
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Paginated records
   */
  async getAllRecords(options = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        sortBy = 'created_at',
        sortOrder = 'desc',
        search = '',
        status = '',
        branch = '',
        startDate = '',
        endDate = ''
      } = options;

      // Build query
      const query = {};

      // Search across multiple fields
      if (search) {
        query.$or = [
          { client_name: { $regex: search, $options: 'i' } },
          { asset_no: { $regex: search, $options: 'i' } },
          { reg_or_serial_no: { $regex: search, $options: 'i' } },
          { asset: { $regex: search, $options: 'i' } }
        ];
      }

      // Filter by account status
      if (status) {
        query.account_status = { $regex: status, $options: 'i' };
      }

      // Filter by branch
      if (branch) {
        query.branch = { $regex: branch, $options: 'i' };
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
      const [records, total] = await Promise.all([
        DebtorRecord.find(query)
          .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        DebtorRecord.countDocuments(query)
      ]);

      // Calculate totals
      const totals = await DebtorRecord.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalPrincipal: { $sum: { $ifNull: ['$principal', 0] } },
            totalInterest: { $sum: { $ifNull: ['$interest', 0] } },
            totalAmountDue: { $sum: { $ifNull: ['$amount_due', 0] } },
            totalPenalties: { $sum: { $ifNull: ['$penalties', 0] } },
            totalDue: { $sum: { $ifNull: ['$total_due', 0] } },
            count: { $sum: 1 }
          }
        }
      ]);

      return {
        success: true,
        data: {
          records,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          },
          totals: totals[0] || {
            totalPrincipal: 0,
            totalInterest: 0,
            totalAmountDue: 0,
            totalPenalties: 0,
            totalDue: 0,
            count: 0
          }
        },
        message: 'Records retrieved successfully'
      };
    } catch (error) {
      console.error('Error fetching records:', error);
      throw new Error(`Failed to fetch records: ${error.message}`);
    }
  }

  /**
   * Get a single debtor record by ID
   * @param {string} id - Record ID
   * @returns {Promise<Object>} Debtor record
   */
  async getRecordById(id) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error('Invalid record ID');
      }

      const record = await DebtorRecord.findById(id).lean();
      
      if (!record) {
        throw new Error('Record not found');
      }

      return {
        success: true,
        data: record,
        message: 'Record retrieved successfully'
      };
    } catch (error) {
      console.error('Error fetching record:', error);
      throw new Error(`Failed to fetch record: ${error.message}`);
    }
  }

  /**
   * Update a debtor record
   * @param {string} id - Record ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated record
   */
  async updateRecord(id, updateData) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error('Invalid record ID');
      }

      // Process monetary fields if present
      const monetaryFields = ['principal', 'interest', 'amount_due', 'penalties', 'total_due', 'profit_loss_on_sale'];
      monetaryFields.forEach(field => {
        if (updateData[field]) {
          updateData[field] = this._parseCurrency(updateData[field]);
        }
      });

      // Process dates if present
      if (updateData.date_of) {
        updateData.date_of = this._parseDate(updateData.date_of);
      }
      if (updateData.due_date) {
        updateData.due_date = this._parseDate(updateData.due_date);
      }

      const record = await DebtorRecord.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      ).lean();

      if (!record) {
        throw new Error('Record not found');
      }

      return {
        success: true,
        data: record,
        message: 'Record updated successfully'
      };
    } catch (error) {
      console.error('Error updating record:', error);
      throw new Error(`Failed to update record: ${error.message}`);
    }
  }

  /**
   * Delete a debtor record
   * @param {string} id - Record ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteRecord(id) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error('Invalid record ID');
      }

      const record = await DebtorRecord.findByIdAndDelete(id);

      if (!record) {
        throw new Error('Record not found');
      }

      return {
        success: true,
        data: { id },
        message: 'Record deleted successfully'
      };
    } catch (error) {
      console.error('Error deleting record:', error);
      throw new Error(`Failed to delete record: ${error.message}`);
    }
  }

  /**
   * Get statistics for debtor records
   * @returns {Promise<Object>} Statistics data
   */
  async getStatistics() {
    try {
      const stats = await DebtorRecord.aggregate([
        {
          $group: {
            _id: '$account_status',
            count: { $sum: 1 },
            totalPrincipal: { $sum: { $ifNull: ['$principal', 0] } },
            totalDue: { $sum: { $ifNull: ['$total_due', 0] } }
          }
        },
        {
          $project: {
            status: '$_id',
            count: 1,
            totalPrincipal: 1,
            totalDue: 1,
            _id: 0
          }
        }
      ]);

      const branchStats = await DebtorRecord.aggregate([
        {
          $group: {
            _id: '$branch',
            count: { $sum: 1 },
            totalDue: { $sum: { $ifNull: ['$total_due', 0] } }
          }
        }
      ]);

      const totalStats = await DebtorRecord.aggregate([
        {
          $group: {
            _id: null,
            totalRecords: { $sum: 1 },
            totalPrincipal: { $sum: { $ifNull: ['$principal', 0] } },
            totalInterest: { $sum: { $ifNull: ['$interest', 0] } },
            totalDue: { $sum: { $ifNull: ['$total_due', 0] } }
          }
        }
      ]);

      return {
        success: true,
        data: {
          byStatus: stats,
          byBranch: branchStats,
          totals: totalStats[0] || {}
        },
        message: 'Statistics retrieved successfully'
      };
    } catch (error) {
      console.error('Error fetching statistics:', error);
      throw new Error(`Failed to fetch statistics: ${error.message}`);
    }
  }

  // Helper method to parse currency values
  _parseCurrency(value) {
    if (!value || value === '') return 0;
    
    // Remove currency symbols, commas, and spaces
    const cleaned = String(value)
      .replace(/[$,]/g, '')
      .replace(/\s+/g, '')
      .trim();
    
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  // Helper method to parse dates
  _parseDate(dateString) {
    if (!dateString || dateString === '') return null;
    
    try {
      // Handle various date formats from CSV
      const cleaned = dateString
        .replace(/"/g, '')
        .replace(/\s+/g, '')
        .trim();
      
      // Check if it's already a valid date
      const date = new Date(cleaned);
      if (!isNaN(date.getTime())) {
        return date;
      }
      
      // Try to parse from dd.mm.yy format
      const parts = cleaned.split('.');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        let year = parseInt(parts[2], 10);
        
        // Convert two-digit year to four-digit
        if (year < 100) {
          year += 2000;
        }
        
        const parsedDate = new Date(year, month, day);
        if (!isNaN(parsedDate.getTime())) {
          return parsedDate;
        }
      }
      
      return null;
    } catch (error) {
      console.warn(`Failed to parse date: ${dateString}`, error);
      return null;
    }
  }
}

module.exports = new DebtorRecordService();