const DebtorRecord = require("../models/debtorRecord.model");
const csv = require("csv-parser");
const fs = require("fs");
const mongoose = require("mongoose");

// ─── Column key mapping ───────────────────────────────────────────────────────
// The JSON exported from Excel uses positional keys ("19.12.25", "", "__1" …)
// instead of the real column names.  We map them here so processJSON can
// normalise each row to the same shape that processCSV produces.
const JSON_COL_MAP = {
  // key in JSON file  →  canonical column name
  "19.12.25": "ASSET NO",
  "DESIGNIT MEDIA PVT LTD": "CLIENT NAME",
  "": "PRINCIPAL",
  __1: "INTEREST",
  __2: "PERIOD",
  __3: "AMOUNT DUE",
  __4: "PENALTIES",
  __5: "TOTAL DUE",
  __6: "P/L ON SALE",
  __7: "DATE OF",
  __8: "DUE DATE",
  __9: "ASSET",
  __10: "SPECS",
  __11: "ASSET CODE",
  __12: "REG /SERIAL NO.",
  __13: "ACCOUNT STATUS",
  __14: "CONTACT DETAILS",
  __15: "BRANCH",
  __16: "PASSWORD",
  __17: "_extra1",
  __18: "_extra2",
};

// Rows before this index in the JSON are header/meta rows and must be skipped.
// Row 6 (0-based) is the real column-header row; data starts at row 8.
const JSON_DATA_START_INDEX = 8;

class DebtorRecordService {
  // ─── Single record ─────────────────────────────────────────────────────────

  async createRecord(recordData) {
    try {
      if (!recordData.client_name) throw new Error("Client name is required");
      this._processFields(recordData);
      recordData.source = "manual_entry";
      recordData.imported_at = new Date();

      const record = new DebtorRecord(recordData);
      await record.save();
      return {
        success: true,
        data: record,
        message: "Debtor record created successfully",
      };
    } catch (error) {
      throw new Error(`Failed to create debtor record: ${error.message}`);
    }
  }

  // ─── Bulk records (JSON array body) ────────────────────────────────────────

  async createMultipleRecords(recordsData) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const createdRecords = [];
      const errors = [];

      for (let i = 0; i < recordsData.length; i++) {
        try {
          const rd = { ...recordsData[i] };
          if (!rd.client_name) {
            errors.push({
              index: i,
              error: "Client name is required",
              data: rd,
            });
            continue;
          }
          this._processFields(rd);
          rd.source = "bulk_entry";
          rd.imported_at = new Date();

          const record = new DebtorRecord(rd);
          await record.save({ session });
          createdRecords.push(record);
        } catch (err) {
          errors.push({ index: i, error: err.message, data: recordsData[i] });
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
          errors: errors.length > 0 ? errors : undefined,
        },
        message: `Created ${createdRecords.length} records, failed ${errors.length}`,
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw new Error(`Failed to create multiple records: ${error.message}`);
    }
  }

  // ─── CSV upload ─────────────────────────────────────────────────────────────

  async processCSV(filePath, sourcePeriod) {
    const results = [];
    const errors = [];

    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv({ separator: "," }))
        .on("data", (data) => {
          try {
            const assetNo = data["ASSET NO"]?.trim();
            if (!assetNo || assetNo === "") return;

            results.push(
              this._mapCSVRow(data, sourcePeriod, "Debtors_list_final.csv"),
            );
          } catch (err) {
            errors.push({ row: results.length + 1, error: err.message, data });
          }
        })
        .on("end", async () => {
          try {
            const { savedRecords, saveErrors } = await this._bulkSave(results);
            try {
              if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } catch (_) {}

            resolve({
              success: true,
              data: {
                totalRows: results.length,
                saved: savedRecords.length,
                failed: saveErrors.length,
                parseErrors: errors.length > 0 ? errors : undefined,
                saveErrors: saveErrors.length > 0 ? saveErrors : undefined,
              },
              message: `Processed ${results.length} rows, saved ${savedRecords.length} records`,
            });
          } catch (err) {
            reject(new Error(`Failed to save records: ${err.message}`));
          }
        })
        .on("error", (err) =>
          reject(new Error(`CSV processing error: ${err.message}`)),
        );
    });
  }

  // ─── JSON upload ────────────────────────────────────────────────────────────
  // Accepts either:
  //   (a) An array of already-normalised objects  { client_name, asset_no, … }
  //   (b) The raw JSON produced by the Excel→JSON converter whose keys are
  //       positional ("19.12.25", "__1", …) — detected automatically.

  async processJSON(filePath, sourcePeriod) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));

      if (!Array.isArray(raw)) {
        throw new Error("JSON file must contain an array of records");
      }

      // Detect whether this looks like the positional-key Excel export
      const isPositionalFormat =
        raw.length > 0 && Object.keys(raw[0]).includes("19.12.25");

      let rows;
      if (isPositionalFormat) {
        // Skip meta/header rows; data starts at JSON_DATA_START_INDEX
        rows = raw.slice(JSON_DATA_START_INDEX);
        rows = rows.map((r) => this._normaliseJSONRow(r));
      } else {
        // Assume already-normalised shape
        rows = raw;
      }

      // Filter out completely empty rows
      const validRows = rows.filter(
        (r) => r["ASSET NO"] || r["CLIENT NAME"] || r.asset_no || r.client_name,
      );

      const results = [];
      const errors = [];

      for (let i = 0; i < validRows.length; i++) {
        try {
          const row = validRows[i];
          // Support both raw-column-name shape and already-mapped shape
          const rd = row.client_name
            ? row
            : this._mapCSVRow(row, sourcePeriod, "uploaded.json");

          if (!rd.client_name) {
            errors.push({
              index: i,
              error: "Client name is required",
              data: row,
            });
            continue;
          }

          // Override source for JSON uploads
          rd.source = "json_upload";
          rd.source_period_label =
            sourcePeriod || rd.source_period_label || "JSON UPLOAD";
          results.push(rd);
        } catch (err) {
          errors.push({ index: i, error: err.message, data: validRows[i] });
        }
      }

      const { savedRecords, saveErrors } = await this._bulkSave(results);
      try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}

      return {
        success: true,
        data: {
          totalRows: validRows.length,
          saved: savedRecords.length,
          failed: saveErrors.length + errors.length,
          parseErrors: errors.length > 0 ? errors : undefined,
          saveErrors: saveErrors.length > 0 ? saveErrors : undefined,
        },
        message: `Processed ${validRows.length} rows, saved ${savedRecords.length} records`,
      };
    } catch (error) {
      throw new Error(`Failed to process JSON file: ${error.message}`);
    }
  }

  // ─── CRUD helpers ───────────────────────────────────────────────────────────

  async getAllRecords(options = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        sortBy = "created_at",
        sortOrder = "desc",
        search = "",
        status = "",
        branch = "",
        startDate = "",
        endDate = "",
      } = options;

      const query = {};

      if (search) {
        query.$or = [
          { client_name: { $regex: search, $options: "i" } },
          { asset_no: { $regex: search, $options: "i" } },
          { reg_or_serial_no: { $regex: search, $options: "i" } },
          { asset: { $regex: search, $options: "i" } },
        ];
      }
      if (status) query.account_status = { $regex: status, $options: "i" };
      if (branch) query.branch = { $regex: branch, $options: "i" };
      if (startDate || endDate) {
        query.created_at = {};
        if (startDate) query.created_at.$gte = new Date(startDate);
        if (endDate) query.created_at.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const [records, total] = await Promise.all([
        DebtorRecord.find(query)
          .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        DebtorRecord.countDocuments(query),
      ]);

      const totals = await DebtorRecord.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalPrincipal: { $sum: { $ifNull: ["$principal", 0] } },
            totalInterest: { $sum: { $ifNull: ["$interest", 0] } },
            totalAmountDue: { $sum: { $ifNull: ["$amount_due", 0] } },
            totalPenalties: { $sum: { $ifNull: ["$penalties", 0] } },
            totalDue: { $sum: { $ifNull: ["$total_due", 0] } },
            count: { $sum: 1 },
          },
        },
      ]);

      return {
        success: true,
        data: {
          records,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
          totals: totals[0] || {
            totalPrincipal: 0,
            totalInterest: 0,
            totalAmountDue: 0,
            totalPenalties: 0,
            totalDue: 0,
            count: 0,
          },
        },
        message: "Records retrieved successfully",
      };
    } catch (error) {
      throw new Error(`Failed to fetch records: ${error.message}`);
    }
  }

  async getRecordById(id) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id))
        throw new Error("Invalid record ID");
      const record = await DebtorRecord.findById(id).lean();
      if (!record) throw new Error("Record not found");
      return {
        success: true,
        data: record,
        message: "Record retrieved successfully",
      };
    } catch (error) {
      throw new Error(`Failed to fetch record: ${error.message}`);
    }
  }

  async updateRecord(id, updateData) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id))
        throw new Error("Invalid record ID");
      this._processFields(updateData);
      const record = await DebtorRecord.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      }).lean();
      if (!record) throw new Error("Record not found");
      return {
        success: true,
        data: record,
        message: "Record updated successfully",
      };
    } catch (error) {
      throw new Error(`Failed to update record: ${error.message}`);
    }
  }

  async deleteRecord(id) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id))
        throw new Error("Invalid record ID");
      const record = await DebtorRecord.findByIdAndDelete(id);
      if (!record) throw new Error("Record not found");
      return {
        success: true,
        data: { id },
        message: "Record deleted successfully",
      };
    } catch (error) {
      throw new Error(`Failed to delete record: ${error.message}`);
    }
  }

  async getStatistics() {
    try {
      const [stats, branchStats, totalStats] = await Promise.all([
        DebtorRecord.aggregate([
          {
            $group: {
              _id: "$account_status",
              count: { $sum: 1 },
              totalPrincipal: { $sum: { $ifNull: ["$principal", 0] } },
              totalDue: { $sum: { $ifNull: ["$total_due", 0] } },
            },
          },
          {
            $project: {
              status: "$_id",
              count: 1,
              totalPrincipal: 1,
              totalDue: 1,
              _id: 0,
            },
          },
        ]),
        DebtorRecord.aggregate([
          {
            $group: {
              _id: "$branch",
              count: { $sum: 1 },
              totalDue: { $sum: { $ifNull: ["$total_due", 0] } },
            },
          },
        ]),
        DebtorRecord.aggregate([
          {
            $group: {
              _id: null,
              totalRecords: { $sum: 1 },
              totalPrincipal: { $sum: { $ifNull: ["$principal", 0] } },
              totalInterest: { $sum: { $ifNull: ["$interest", 0] } },
              totalDue: { $sum: { $ifNull: ["$total_due", 0] } },
            },
          },
        ]),
      ]);

      return {
        success: true,
        data: {
          byStatus: stats,
          byBranch: branchStats,
          totals: totalStats[0] || {},
        },
        message: "Statistics retrieved successfully",
      };
    } catch (error) {
      throw new Error(`Failed to fetch statistics: ${error.message}`);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Mutates recordData in-place: parses monetary fields and dates. */
  _processFields(rd) {
    const monetaryFields = [
      "principal",
      "interest",
      "amount_due",
      "penalties",
      "total_due",
      "profit_loss_on_sale",
    ];
    monetaryFields.forEach((f) => {
      if (rd[f] != null) rd[f] = this._parseCurrency(rd[f]);
    });
    if (rd.date_of) rd.date_of = this._parseDate(rd.date_of);
    if (rd.due_date) rd.due_date = this._parseDate(rd.due_date);
  }

  /**
   * Maps a raw CSV row (or a JSON row already in canonical-column-name shape)
   * to the DebtorRecord field shape.
   */
  _mapCSVRow(data, sourcePeriod, sourceFile) {
    return {
      asset_no: String(data["ASSET NO"] ?? "").trim() || undefined,
      client_name: String(data["CLIENT NAME"] ?? "").trim() || undefined,
      principal: this._parseCurrency(data["PRINCIPAL"]),
      interest: this._parseCurrency(data["INTEREST"]),
      period: String(data["PERIOD"] ?? "").trim() || undefined,
      amount_due: this._parseCurrency(data["AMOUNT DUE"]),
      penalties: this._parseCurrency(data["PENALTIES"]),
      total_due: this._parseCurrency(data["TOTAL DUE"]),
      profit_loss_on_sale: this._parseCurrency(data["P/L ON SALE"]),
      date_of: this._parseDate(data["DATE OF DISBURSEMENT"] || data["DATE OF"]),
      due_date: this._parseDate(data["DUE DATE"]),
      asset: String(data["ASSET"] ?? data["ASSET "] ?? "").trim() || undefined,
      specs: String(data["SPECS"] ?? "").trim() || undefined,
      asset_code: String(data["ASSET CODE"] ?? "").trim() || undefined,
      reg_or_serial_no:
        String(data["REG /SERIAL NO."] ?? "").trim() || undefined,
      account_status: String(data["ACCOUNT STATUS"] ?? "").trim() || undefined,
      contact_details:
        String(data["CONTACT DETAILS"] ?? "").trim() || undefined,
      branch: String(data["BRANCH"] ?? "").trim() || "HARARE",
      source: sourceFile || "upload",
      source_period_label: sourcePeriod || "DEBTORS LIST",
      imported_at: new Date(),
      raw: data,
    };
  }

  /**
   * Re-keys a positional JSON row using JSON_COL_MAP, producing the same
   * canonical column names that CSV rows have.
   */
  _normaliseJSONRow(row) {
    const out = {};
    for (const [jsonKey, canonicalKey] of Object.entries(JSON_COL_MAP)) {
      out[canonicalKey] = row[jsonKey] ?? "";
    }
    return out;
  }

  /** Saves an array of already-mapped record objects inside a transaction. */
  async _bulkSave(records) {
    const session = await mongoose.startSession();
    session.startTransaction();
    const savedRecords = [];
    const saveErrors = [];

    try {
      for (let i = 0; i < records.length; i++) {
        try {
          const doc = new DebtorRecord(records[i]);
          await doc.save({ session });
          savedRecords.push(doc);
        } catch (err) {
          saveErrors.push({ index: i, error: err.message, data: records[i] });
        }
      }
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    return { savedRecords, saveErrors };
  }

  _parseCurrency(value) {
    if (value == null || value === "") return 0;
    const cleaned = String(value)
      .replace(/[$,\s]/g, "")
      .trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  _parseDate(dateString) {
    if (!dateString || dateString === "") return null;
    try {
      const cleaned = String(dateString).replace(/["\s]/g, "").trim();
      if (!cleaned) return null;

      // dd.mm.yy or dd.mm.yyyy
      const dotParts = cleaned.split(".");
      if (dotParts.length === 3) {
        const day = parseInt(dotParts[0], 10);
        const month = parseInt(dotParts[1], 10) - 1;
        let year = parseInt(dotParts[2], 10);
        if (year < 100) year += 2000;
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }

      // dd/mm/yyyy or mm/dd/yyyy — try ISO first
      const d = new Date(cleaned);
      if (!isNaN(d.getTime())) return d;

      return null;
    } catch {
      return null;
    }
  }
}

module.exports = new DebtorRecordService();
