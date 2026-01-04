const express = require('express');
const router = express.Router();
const debtorRecordController = require('../controllers/debtor_record_controller');
const { authMiddleware, requireRoles } = require('../middlewares/auth_middleware');

/**
 * @swagger
 * tags:
 *   name: Debtor Records
 *   description: Debtor records management
 */

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/v1/debtor-records/upload-csv:
 *   post:
 *     summary: Upload and process CSV file
 *     tags: [Debtor Records]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               csvFile:
 *                 type: string
 *                 format: binary
 *                 description: CSV file to upload
 *               source_period_label:
 *                 type: string
 *                 example: "JUNE 2023-NOVEMBER 2025"
 *                 description: Period label for the records
 *     responses:
 *       200:
 *         description: CSV processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request (invalid file format or missing file)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  '/upload-csv',
  authMiddleware,
  requireRoles('admin', 'manager'),
  debtorRecordController.uploadCSV
);

/**
 * @swagger
 * /api/v1/debtor-records:
 *   post:
 *     summary: Create a single debtor record
 *     tags: [Debtor Records]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - client_name
 *             properties:
 *               asset_no:
 *                 type: string
 *               client_name:
 *                 type: string
 *               principal:
 *                 type: number
 *               interest:
 *                 type: number
 *               period:
 *                 type: string
 *               amount_due:
 *                 type: number
 *               penalties:
 *                 type: number
 *               total_due:
 *                 type: number
 *               profit_loss_on_sale:
 *                 type: number
 *               date_of:
 *                 type: string
 *                 format: date
 *               due_date:
 *                 type: string
 *                 format: date
 *               asset:
 *                 type: string
 *               specs:
 *                 type: string
 *               asset_code:
 *                 type: string
 *               reg_or_serial_no:
 *                 type: string
 *               account_status:
 *                 type: string
 *               contact_details:
 *                 type: string
 *               branch:
 *                 type: string
 *     responses:
 *       201:
 *         description: Record created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request (validation error)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  '/',
  authMiddleware,
  requireRoles('admin', 'manager', 'user'),
  debtorRecordController.createRecord
);

/**
 * @swagger
 * /api/v1/debtor-records/bulk:
 *   post:
 *     summary: Create multiple debtor records
 *     tags: [Debtor Records]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               required:
 *                 - client_name
 *               properties:
 *                 asset_no:
 *                   type: string
 *                 client_name:
 *                   type: string
 *                 principal:
 *                   type: number
 *                 interest:
 *                   type: number
 *                 period:
 *                   type: string
 *                 amount_due:
 *                   type: number
 *                 penalties:
 *                   type: number
 *                 total_due:
 *                   type: number
 *                 profit_loss_on_sale:
 *                   type: number
 *                 date_of:
 *                   type: string
 *                   format: date
 *                 due_date:
 *                   type: string
 *                   format: date
 *                 asset:
 *                   type: string
 *                 specs:
 *                   type: string
 *                 asset_code:
 *                   type: string
 *                 reg_or_serial_no:
 *                   type: string
 *                 account_status:
 *                   type: string
 *                 contact_details:
 *                   type: string
 *                 branch:
 *                   type: string
 *     responses:
 *       201:
 *         description: All records created successfully
 *       207:
 *         description: Multi-status (some records failed)
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  '/bulk',
  authMiddleware,
  requireRoles('admin', 'manager'),
  debtorRecordController.createMultipleRecords
);

/**
 * @swagger
 * /api/v1/debtor-records:
 *   get:
 *     summary: Get all debtor records with pagination
 *     tags: [Debtor Records]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of records per page
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: created_at
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term (client name, asset no, etc.)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by account status
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *         description: Filter by branch
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter records created after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter records created before this date
 *     responses:
 *       200:
 *         description: Records retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     records:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *                     totals:
 *                       type: object
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/',
  authMiddleware,
  requireRoles('admin', 'manager', 'user'),
  debtorRecordController.getAllRecords
);

/**
 * @swagger
 * /api/v1/debtor-records/{id}:
 *   get:
 *     summary: Get a single debtor record by ID
 *     tags: [Debtor Records]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Debtor record ID
 *     responses:
 *       200:
 *         description: Record retrieved successfully
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Record not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/:id',
  authMiddleware,
  requireRoles('admin', 'manager', 'user'),
  debtorRecordController.getRecordById
);

/**
 * @swagger
 * /api/v1/debtor-records/{id}:
 *   put:
 *     summary: Update a debtor record
 *     tags: [Debtor Records]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Debtor record ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               asset_no:
 *                 type: string
 *               client_name:
 *                 type: string
 *               principal:
 *                 type: number
 *               interest:
 *                 type: number
 *               period:
 *                 type: string
 *               amount_due:
 *                 type: number
 *               penalties:
 *                 type: number
 *               total_due:
 *                 type: number
 *               profit_loss_on_sale:
 *                 type: number
 *               date_of:
 *                 type: string
 *                 format: date
 *               due_date:
 *                 type: string
 *                 format: date
 *               asset:
 *                 type: string
 *               specs:
 *                 type: string
 *               asset_code:
 *                 type: string
 *               reg_or_serial_no:
 *                 type: string
 *               account_status:
 *                 type: string
 *               contact_details:
 *                 type: string
 *               branch:
 *                 type: string
 *     responses:
 *       200:
 *         description: Record updated successfully
 *       400:
 *         description: Bad request
 *       404:
 *         description: Record not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put(
  '/:id',
  authMiddleware,
  requireRoles('admin', 'manager'),
  debtorRecordController.updateRecord
);

/**
 * @swagger
 * /api/v1/debtor-records/{id}:
 *   delete:
 *     summary: Delete a debtor record
 *     tags: [Debtor Records]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Debtor record ID
 *     responses:
 *       200:
 *         description: Record deleted successfully
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Record not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.delete(
  '/:id',
  authMiddleware,
  requireRoles('admin'),
  debtorRecordController.deleteRecord
);

/**
 * @swagger
 * /api/v1/debtor-records/stats:
 *   get:
 *     summary: Get statistics for debtor records
 *     tags: [Debtor Records]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     byStatus:
 *                       type: array
 *                     byBranch:
 *                       type: array
 *                     totals:
 *                       type: object
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/stats',
  authMiddleware,
  requireRoles('admin', 'manager'),
  debtorRecordController.getStatistics
);

/**
 * @swagger
 * /api/v1/debtor-records/export:
 *   get:
 *     summary: Export debtor records to CSV
 *     tags: [Debtor Records]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, excel]
 *           default: csv
 *         description: Export format
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by account status
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *         description: Filter by branch
 *     responses:
 *       200:
 *         description: Export file generated
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *               format: binary
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/export',
  authMiddleware,
  requireRoles('admin', 'manager'),
  async (req, res) => {
    try {
      // Export functionality would go here
      // This is a placeholder for export implementation
      res.status(200).json({
        success: true,
        message: 'Export endpoint - implement CSV/Excel generation here'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

module.exports = router;