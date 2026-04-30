const debtorRecordService = require("../services/debtor_record_service");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ─── Multer storage ──────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `debtor-upload-${suffix}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = file.originalname.toLowerCase();
  const mime = file.mimetype;
  const ok =
    mime === "text/csv" ||
    ext.endsWith(".csv") ||
    mime === "application/json" ||
    ext.endsWith(".json");
  ok
    ? cb(null, true)
    : cb(new Error("Only CSV and JSON files are allowed"), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function handleRecordError(res, error) {
  const msg = error.message || "";
  if (msg.includes("Record not found"))
    return res.status(404).json({ success: false, error: msg });
  if (msg.includes("Invalid record ID"))
    return res.status(400).json({ success: false, error: msg });
  return res.status(500).json({ success: false, error: msg });
}

// ─── Controller ───────────────────────────────────────────────────────────────

class DebtorRecordController {
  // ── POST /upload-csv ────────────────────────────────────────────────────────
  /**
   * @swagger
   * /api/v1/debtor-records/upload-csv:
   *   post:
   *     summary: Upload and process a CSV file of debtor records
   *     tags: [Debtor Records]
   *     security:
   *       - bearerAuth: []
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
   *               source_period_label:
   *                 type: string
   *                 example: "JUNE 2023-NOVEMBER 2025"
   *     responses:
   *       200:
   *         description: CSV processed successfully
   *       400:
   *         description: Missing or invalid file
   *       500:
   *         description: Server error
   */
  async uploadCSV(req, res) {
    upload.single("csvFile")(req, res, async (err) => {
      if (err)
        return res.status(400).json({ success: false, error: err.message });
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, error: "No CSV file provided" });

      try {
        const result = await debtorRecordService.processCSV(
          req.file.path,
          req.body.source_period_label || "DEBTORS LIST",
        );
        res
          .status(200)
          .json({ success: true, data: result.data, message: result.message });
      } catch (error) {
        safeUnlink(req.file?.path);
        res
          .status(500)
          .json({
            success: false,
            error: `Failed to process CSV: ${error.message}`,
          });
      }
    });
  }

  // ── POST /upload-json ───────────────────────────────────────────────────────
  /**
   * @swagger
   * /api/v1/debtor-records/upload-json:
   *   post:
   *     summary: Upload and process a JSON file of debtor records
   *     description: >
   *       Accepts either a normalised JSON array  `[{ client_name, asset_no, … }]`
   *       **or** the raw positional-key JSON produced by Excel-to-JSON converters
   *       (keys like "19.12.25", "__1", etc.).  The service auto-detects the format.
   *     tags: [Debtor Records]
   *     security:
   *       - bearerAuth: []
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
   *               source_period_label:
   *                 type: string
   *                 example: "JUNE 2023-NOVEMBER 2025"
   *     responses:
   *       200:
   *         description: JSON processed successfully
   *       400:
   *         description: Missing or invalid file
   *       500:
   *         description: Server error
   */
  async uploadJSON(req, res) {
    upload.single("jsonFile")(req, res, async (err) => {
      if (err)
        return res.status(400).json({ success: false, error: err.message });
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, error: "No JSON file provided" });

      try {
        const result = await debtorRecordService.processJSON(
          req.file.path,
          req.body.source_period_label || "DEBTORS LIST",
        );
        res
          .status(200)
          .json({ success: true, data: result.data, message: result.message });
      } catch (error) {
        safeUnlink(req.file?.path);
        res
          .status(500)
          .json({
            success: false,
            error: `Failed to process JSON: ${error.message}`,
          });
      }
    });
  }

  // ── POST /upload  (accepts either CSV or JSON in one endpoint) ──────────────
  /**
   * @swagger
   * /api/v1/debtor-records/upload:
   *   post:
   *     summary: Upload a CSV **or** JSON file (auto-detected by extension)
   *     tags: [Debtor Records]
   *     security:
   *       - bearerAuth: []
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
   *       200:
   *         description: File processed successfully
   *       400:
   *         description: Missing or unsupported file
   *       500:
   *         description: Server error
   */
  async uploadFile(req, res) {
    upload.single("file")(req, res, async (err) => {
      if (err)
        return res.status(400).json({ success: false, error: err.message });
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, error: "No file provided" });

      const label = req.body.source_period_label || "DEBTORS LIST";
      const ext = req.file.originalname.toLowerCase();

      try {
        let result;
        if (ext.endsWith(".csv")) {
          result = await debtorRecordService.processCSV(req.file.path, label);
        } else if (ext.endsWith(".json")) {
          result = await debtorRecordService.processJSON(req.file.path, label);
        } else {
          safeUnlink(req.file.path);
          return res
            .status(400)
            .json({
              success: false,
              error: "Unsupported file type. Use .csv or .json",
            });
        }
        res
          .status(200)
          .json({ success: true, data: result.data, message: result.message });
      } catch (error) {
        safeUnlink(req.file?.path);
        res
          .status(500)
          .json({
            success: false,
            error: `Failed to process file: ${error.message}`,
          });
      }
    });
  }

  // ── POST / (single record) ──────────────────────────────────────────────────
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
   *             $ref: '#/components/schemas/DebtorRecordInput'
   *     responses:
   *       201:
   *         description: Record created
   *       400:
   *         description: Validation error
   */
  async createRecord(req, res) {
    try {
      const result = await debtorRecordService.createRecord(req.body);
      res
        .status(201)
        .json({ success: true, data: result.data, message: result.message });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  // ── POST /bulk (JSON body array) ────────────────────────────────────────────
  /**
   * @swagger
   * /api/v1/debtor-records/bulk:
   *   post:
   *     summary: Create multiple debtor records from a JSON array body
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
   *               $ref: '#/components/schemas/DebtorRecordInput'
   *     responses:
   *       201:
   *         description: All records created
   *       207:
   *         description: Multi-status — some records failed
   *       400:
   *         description: Bad request
   */
  async createMultipleRecords(req, res) {
    try {
      const recordsData = req.body;
      if (!Array.isArray(recordsData) || recordsData.length === 0) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Request body must be a non-empty array",
          });
      }
      const result =
        await debtorRecordService.createMultipleRecords(recordsData);
      const status = result.data.failed > 0 ? 207 : 201;
      res
        .status(status)
        .json({ success: true, data: result.data, message: result.message });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  // ── GET / ───────────────────────────────────────────────────────────────────
  async getAllRecords(req, res) {
    try {
      const result = await debtorRecordService.getAllRecords(req.query);
      res
        .status(200)
        .json({ success: true, data: result.data, message: result.message });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ── GET /stats ──────────────────────────────────────────────────────────────
  async getStatistics(req, res) {
    try {
      const result = await debtorRecordService.getStatistics();
      res
        .status(200)
        .json({ success: true, data: result.data, message: result.message });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ── GET /:id ────────────────────────────────────────────────────────────────
  async getRecordById(req, res) {
    try {
      const result = await debtorRecordService.getRecordById(req.params.id);
      res
        .status(200)
        .json({ success: true, data: result.data, message: result.message });
    } catch (error) {
      handleRecordError(res, error);
    }
  }

  // ── PUT /:id ────────────────────────────────────────────────────────────────
  async updateRecord(req, res) {
    try {
      const result = await debtorRecordService.updateRecord(
        req.params.id,
        req.body,
      );
      res
        .status(200)
        .json({ success: true, data: result.data, message: result.message });
    } catch (error) {
      handleRecordError(res, error);
    }
  }

  // ── DELETE /:id ─────────────────────────────────────────────────────────────
  async deleteRecord(req, res) {
    try {
      const result = await debtorRecordService.deleteRecord(req.params.id);
      res
        .status(200)
        .json({ success: true, data: result.data, message: result.message });
    } catch (error) {
      handleRecordError(res, error);
    }
  }
}

module.exports = new DebtorRecordController();
