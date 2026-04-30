const DebtorRecord = require("../models/debtorRecord.model");
const csv = require("csv-parser");
const fs = require("fs");
const mongoose = require("mongoose");

// ─── JSON column-key mapping ──────────────────────────────────────────────────
// The JSON produced by pandas/Excel export uses "02.01.26" as the first key
// (the report date that ended up as the spreadsheet's effective header) and
// "Unnamed: N" for every subsequent column.  Map them to canonical names.
const JSON_COL_MAP = {
  "02.01.26": "ASSET NO",
  "DESIGNIT MEDIA PVT LTD": "CLIENT NAME",
  "Unnamed: 2": "PRINCIPAL",
  "Unnamed: 3": "INTEREST",
  "Unnamed: 4": "PERIOD",
  "Unnamed: 5": "AMOUNT DUE",
  "Unnamed: 6": "PENALTIES",
  "Unnamed: 7": "TOTAL DUE",
  "Unnamed: 8": "P/L ON SALE",
  "Unnamed: 9": "DATE OF", // "DATE OF DISBURSEMENT" split across two rows
  "Unnamed: 10": "DUE DATE",
  "Unnamed: 11": "ASSET",
  "Unnamed: 12": "SPECS",
  "Unnamed: 13": "ASSET CODE",
  "Unnamed: 14": "REG /SERIAL NO.",
  "Unnamed: 15": "ACCOUNT STATUS",
  "Unnamed: 16": "CONTACT DETAILS",
  "Unnamed: 17": "BRANCH",
  "Unnamed: 18": "PASSWORD",
  "Unnamed: 19": "_extra1",
  "Unnamed: 20": "_extra2",
};

// How many leading rows in the JSON array are header / meta rows to skip.
// Layout:
//   0 – "t/a REAL TIME CAPITAL"
//   1 – blank
//   2 – "DEBTORS LIST JANUARY 2026"
//   3 – blank
//   4 – "A] PAID UP DEBTORS"
//   5 – blank
//   6 – real column-header row  (ASSET NO, CLIENT NAME …)
//   7 – "DISBURSEMENT" continuation row
//   8+ – actual data rows
const JSON_DATA_START_INDEX = 8;

// ─── CSV: the file has 8 leading non-data rows before the real header.
// csv-parser reads the FIRST row as the header automatically, so those 8 rows
// will be emitted as data objects keyed by the values from row 1
// ("02.01.26", "DESIGNIT MEDIA PVT LTD", …).  We detect and skip them in the
// .on("data") handler, then re-map using the same JSON_COL_MAP logic once we
// hit the real header row (which appears as a data row with key "02.01.26" === "ASSET NO").
//
// Simpler alternative used here: use csv-parser with `headers: false` and
// detect the real header row ourselves, then process subsequent rows.

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
  // The CSV file structure:
  //   Row 0  : "02.01.26,DESIGNIT MEDIA PVT LTD,..."   ← company date / name (becomes csv-parser header)
  //   Row 1  : ",t/a REAL TIME CAPITAL,..."
  //   Row 2  : empty
  //   Row 3  : ",DEBTORS LIST JANUARY 2026,..."
  //   Row 4  : empty
  //   Row 5  : "A],PAID UP DEBTORS,..."
  //   Row 6  : empty
  //   Row 7  : "ASSET NO,CLIENT NAME,PRINCIPAL,..."     ← real column headers (emitted as a data row)
  //   Row 8  : ",,,,,,,,,DISBURSEMENT,..."              ← header continuation  (skip)
  //   Row 9+ : actual debtor data
  //
  // Strategy: use `headers: false` so every row (including row 0) is an array.
  // Find the row whose first cell is "ASSET NO" → that is the real header row.
  // All subsequent rows are data.

  async processCSV(filePath, sourcePeriod) {
    return new Promise((resolve, reject) => {
      const allRows = [];

      fs.createReadStream(filePath)
        .pipe(csv({ headers: false, skipLines: 0 }))
        .on("data", (row) => {
          // csv-parser with headers:false gives objects like { "0": val, "1": val, … }
          allRows.push(Object.values(row));
        })
        .on("end", async () => {
          try {
            // Find the index of the real header row
            const headerIdx = allRows.findIndex(
              (r) =>
                String(r[0] ?? "")
                  .trim()
                  .toUpperCase() === "ASSET NO",
            );

            if (headerIdx === -1) {
              throw new Error(
                'Could not find the "ASSET NO" header row in the CSV file.',
              );
            }

            const headers = allRows[headerIdx].map((h) =>
              String(h ?? "").trim(),
            );
            // Data starts two rows after the header row
            // (row headerIdx+1 is the "DISBURSEMENT" continuation – skip it)
            const dataRows = allRows.slice(headerIdx + 2);

            const results = [];
            const errors = [];

            for (let i = 0; i < dataRows.length; i++) {
              try {
                const cells = dataRows[i];

                // Build a named object from positional cells
                const rowObj = {};
                headers.forEach((h, idx) => {
                  rowObj[h] = cells[idx] ?? "";
                });

                // Fix split header: "DATE OF" column value may be paired with
                // the "DISBURSEMENT" text that sat in the row below the header.
                // The column is already mapped correctly as "DATE OF".

                const assetNo = String(rowObj["ASSET NO"] ?? "").trim();
                // Skip blank rows and the occasional section-label rows
                if (!assetNo || assetNo.toUpperCase() === "ASSET NO") continue;

                const mapped = this._mapRow(rowObj, sourcePeriod, "csv_upload");
                if (!mapped.client_name) {
                  errors.push({
                    row: i + 1,
                    error: "No client name",
                    data: rowObj,
                  });
                  continue;
                }
                results.push(mapped);
              } catch (err) {
                errors.push({
                  row: i + 1,
                  error: err.message,
                  data: dataRows[i],
                });
              }
            }

            const { savedRecords, saveErrors } = await this._bulkSave(results);
            this._safeUnlink(filePath);

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
            this._safeUnlink(filePath);
            reject(new Error(`Failed to process CSV: ${err.message}`));
          }
        })
        .on("error", (err) => {
          this._safeUnlink(filePath);
          reject(new Error(`CSV read error: ${err.message}`));
        });
    });
  }

  // ─── JSON upload ────────────────────────────────────────────────────────────
  // The JSON file is a pandas-style export where:
  //   • The first key is "02.01.26"  (the report date that became the implicit header)
  //   • Remaining keys are "Unnamed: 2" … "Unnamed: 20"
  //   • The first JSON_DATA_START_INDEX (8) objects are header/meta rows
  //   • From index 8 onward are actual debtor rows
  //
  // Also accepts the already-normalised shape { client_name, asset_no, … }.

  async processJSON(filePath, sourcePeriod) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));

      if (!Array.isArray(raw)) {
        throw new Error("JSON file must contain an array of records");
      }

      // Detect format by checking whether the first element has the pandas key
      const isPandasFormat =
        raw.length > 0 &&
        (Object.keys(raw[0]).includes("02.01.26") ||
          Object.keys(raw[0]).includes("DESIGNIT MEDIA PVT LTD"));

      let rows;
      if (isPandasFormat) {
        rows = raw
          .slice(JSON_DATA_START_INDEX)
          .map((r) => this._normalisePandasRow(r));
      } else {
        rows = raw;
      }

      // Filter completely empty rows
      const validRows = rows.filter(
        (r) => r["ASSET NO"] || r["CLIENT NAME"] || r.asset_no || r.client_name,
      );

      const results = [];
      const errors = [];

      for (let i = 0; i < validRows.length; i++) {
        try {
          const row = validRows[i];

          // Support already-normalised shape (client_name key present)
          const rd = row.client_name
            ? { ...row }
            : this._mapRow(row, sourcePeriod, "json_upload");

          if (!rd.client_name) {
            errors.push({
              index: i,
              error: "Client name is required",
              data: row,
            });
            continue;
          }

          rd.source = "json_upload";
          rd.source_period_label =
            sourcePeriod || rd.source_period_label || "JSON UPLOAD";
          results.push(rd);
        } catch (err) {
          errors.push({ index: i, error: err.message, data: validRows[i] });
        }
      }

      const { savedRecords, saveErrors } = await this._bulkSave(results);
      this._safeUnlink(filePath);

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
      this._safeUnlink(filePath);
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

  /**
   * Re-keys a pandas-style JSON row using JSON_COL_MAP, producing the same
   * canonical column names that the CSV rows have after header detection.
   */
  _normalisePandasRow(row) {
    const out = {};
    for (const [jsonKey, canonicalKey] of Object.entries(JSON_COL_MAP)) {
      out[canonicalKey] = row[jsonKey] ?? "";
    }
    return out;
  }

  /**
   * Maps a canonically-keyed row object (keys = column names like "ASSET NO",
   * "CLIENT NAME", etc.) to a DebtorRecord field shape.
   * Works for both CSV rows (after header detection) and normalised JSON rows.
   */
  _mapRow(data, sourcePeriod, sourceLabel) {
    const rd = {
      asset_no: this._str(data["ASSET NO"]),
      client_name: this._str(data["CLIENT NAME"]),
      principal: this._parseCurrency(data["PRINCIPAL"]),
      interest: this._parseCurrency(data["INTEREST"]),
      period: this._str(data["PERIOD"]),
      amount_due: this._parseCurrency(data["AMOUNT DUE"]),
      penalties: this._parseCurrency(data["PENALTIES"]),
      total_due: this._parseCurrency(data["TOTAL DUE"]),
      profit_loss_on_sale: this._parseCurrency(data["P/L ON SALE"]),
      // Accept either "DATE OF" (after normalisation) or the full name
      date_of: this._parseDate(data["DATE OF DISBURSEMENT"] || data["DATE OF"]),
      due_date: this._parseDate(data["DUE DATE"]),
      asset: this._str(data["ASSET"] ?? data["ASSET "]),
      specs: this._str(data["SPECS"]),
      asset_code: this._str(data["ASSET CODE"]),
      reg_or_serial_no: this._str(data["REG /SERIAL NO."]),
      account_status: this._str(data["ACCOUNT STATUS"]),
      contact_details: this._str(data["CONTACT DETAILS"]),
      branch: this._str(data["BRANCH"]) || "HARARE",
      source: sourceLabel || "upload",
      source_period_label: sourcePeriod || "DEBTORS LIST",
      imported_at: new Date(),
      raw: data,
    };
    return rd;
  }

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

  _str(value) {
    if (value == null) return undefined;
    const s = String(value).trim();
    return s === "" ? undefined : s;
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

      // dd.mm.yy or dd.mm.yyyy  (most common format in the file)
      const dotParts = cleaned.split(".");
      if (dotParts.length === 3) {
        const day = parseInt(dotParts[0], 10);
        const month = parseInt(dotParts[1], 10) - 1;
        let year = parseInt(dotParts[2], 10);
        if (year < 100) year += 2000;
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }

      // Fallback: try native Date parse (handles ISO and some locale formats)
      const d = new Date(cleaned);
      if (!isNaN(d.getTime())) return d;

      return null;
    } catch {
      return null;
    }
  }

  _safeUnlink(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
  }
}

module.exports = new DebtorRecordService();
