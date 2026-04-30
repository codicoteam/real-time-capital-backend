const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/debtor_record_controller");
const { authMiddleware } = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: Debtor Records
 *   description: Debtor records management
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *
 *   schemas:
 *     DebtorRecordInput:
 *       type: object
 *       required: [client_name]
 *       properties:
 *         asset_no:            { type: string }
 *         client_name:         { type: string }
 *         principal:           { type: number }
 *         interest:            { type: number }
 *         period:              { type: string }
 *         amount_due:          { type: number }
 *         penalties:           { type: number }
 *         total_due:           { type: number }
 *         profit_loss_on_sale: { type: number }
 *         date_of:             { type: string, format: date }
 *         due_date:            { type: string, format: date }
 *         asset:               { type: string }
 *         specs:               { type: string }
 *         asset_code:          { type: string }
 *         reg_or_serial_no:    { type: string }
 *         account_status:      { type: string }
 *         contact_details:     { type: string }
 *         branch:              { type: string }
 */

// ═══════════════════════════════════════════════════════════════════════════════
// FILE UPLOAD ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/debtor-records/upload-csv:
 *   post:
 *     summary: Upload a CSV file of debtor records
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [csvFile]
 *             properties:
 *               csvFile:
 *                 type: string
 *                 format: binary
 *                 description: CSV file (max 20 MB)
 *               source_period_label:
 *                 type: string
 *                 example: "JUNE 2023-NOVEMBER 2025"
 *     responses:
 *       200: { description: CSV processed successfully }
 *       400: { description: Missing or invalid file }
 *       401: { description: Unauthorized }
 *       500: { description: Server error }
 */
router.post("/upload-csv", authMiddleware, ctrl.uploadCSV);

/**
 * @swagger
 * /api/v1/debtor-records/upload-json:
 *   post:
 *     summary: Upload a JSON file of debtor records
 *     description: >
 *       Accepts either a normalised JSON array `[{ client_name, asset_no, … }]`
 *       **or** the raw positional-key JSON produced by Excel-to-JSON converters
 *       (keys like `"19.12.25"`, `"__1"`, etc.).  The service auto-detects the format
 *       and skips metadata rows automatically.
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [jsonFile]
 *             properties:
 *               jsonFile:
 *                 type: string
 *                 format: binary
 *                 description: JSON file (max 20 MB)
 *               source_period_label:
 *                 type: string
 *                 example: "JUNE 2023-NOVEMBER 2025"
 *     responses:
 *       200: { description: JSON processed successfully }
 *       400: { description: Missing or invalid file }
 *       401: { description: Unauthorized }
 *       500: { description: Server error }
 */
router.post("/upload-json", authMiddleware, ctrl.uploadJSON);

/**
 * @swagger
 * /api/v1/debtor-records/upload:
 *   post:
 *     summary: Upload a CSV **or** JSON file (auto-detected by file extension)
 *     description: Single endpoint that accepts `.csv` or `.json` files.
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               source_period_label:
 *                 type: string
 *     responses:
 *       200: { description: File processed successfully }
 *       400: { description: Missing or unsupported file }
 *       401: { description: Unauthorized }
 *       500: { description: Server error }
 */
router.post("/upload", authMiddleware, ctrl.uploadFile);

// ═══════════════════════════════════════════════════════════════════════════════
// STATS & EXPORT  (must come before /:id to avoid route collision)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/debtor-records/stats:
 *   get:
 *     summary: Get aggregate statistics (by status, by branch, totals)
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Statistics retrieved successfully }
 *       401: { description: Unauthorized }
 *       500: { description: Server error }
 */
router.get("/stats", authMiddleware, ctrl.getStatistics);

/**
 * @swagger
 * /api/v1/debtor-records/export:
 *   get:
 *     summary: Export debtor records (CSV / Excel) — placeholder
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, excel], default: csv }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: branch
 *         schema: { type: string }
 *     responses:
 *       200: { description: Export file generated }
 *       401: { description: Unauthorized }
 *       500: { description: Server error }
 */
router.get("/export", authMiddleware, async (req, res) => {
  // TODO: implement CSV / Excel export
  res
    .status(200)
    .json({
      success: true,
      message: "Export endpoint — implement CSV/Excel generation here",
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/debtor-records:
 *   get:
 *     summary: List debtor records with pagination, search and filters
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, default: created_at }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Searches client_name, asset_no, reg_or_serial_no, asset
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: branch
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Records retrieved successfully }
 *       401: { description: Unauthorized }
 *       500: { description: Server error }
 */
router.get("/", authMiddleware, ctrl.getAllRecords);

/**
 * @swagger
 * /api/v1/debtor-records:
 *   post:
 *     summary: Create a single debtor record
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/DebtorRecordInput' }
 *     responses:
 *       201: { description: Record created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post("/", authMiddleware, ctrl.createRecord);

/**
 * @swagger
 * /api/v1/debtor-records/bulk:
 *   post:
 *     summary: Create multiple debtor records from a JSON array in the request body
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items: { $ref: '#/components/schemas/DebtorRecordInput' }
 *     responses:
 *       201: { description: All records created }
 *       207: { description: Multi-status — some records failed }
 *       400: { description: Bad request }
 *       401: { description: Unauthorized }
 */
router.post("/bulk", authMiddleware, ctrl.createMultipleRecords);

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE-RECORD ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/debtor-records/{id}:
 *   get:
 *     summary: Get a single debtor record by ID
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Record retrieved }
 *       400: { description: Invalid ID }
 *       404: { description: Record not found }
 *       401: { description: Unauthorized }
 */
router.get("/:id", authMiddleware, ctrl.getRecordById);

/**
 * @swagger
 * /api/v1/debtor-records/{id}:
 *   put:
 *     summary: Update a debtor record
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/DebtorRecordInput' }
 *     responses:
 *       200: { description: Record updated }
 *       400: { description: Bad request }
 *       404: { description: Record not found }
 *       401: { description: Unauthorized }
 */
router.put("/:id", authMiddleware, ctrl.updateRecord);

/**
 * @swagger
 * /api/v1/debtor-records/{id}:
 *   delete:
 *     summary: Delete a debtor record
 *     tags: [Debtor Records]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Record deleted }
 *       400: { description: Invalid ID }
 *       404: { description: Record not found }
 *       401: { description: Unauthorized }
 */
router.delete("/:id", authMiddleware, ctrl.deleteRecord);

module.exports = router;
