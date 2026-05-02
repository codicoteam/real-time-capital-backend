// // scripts/importDebtorsFromCSVAdvanced.js

// const fs = require("fs");
// const path = require("path");
// const csv = require("csv-parser");
// const mongoose = require("mongoose");
// const dotenv = require("dotenv");

// dotenv.config();

// const DebtorRecord = require("../models/debtorRecord.model");

// // ---------------- HELPERS ----------------

// const normalizeKey = (key) =>
//   key?.toString().trim().toUpperCase().replace(/\s+/g, " ");

// const parseCurrency = (value) => {
//   if (!value) return 0;
//   const cleaned = String(value).replace(/[$,"]/g, "").trim();
//   const num = parseFloat(cleaned);
//   return isNaN(num) ? 0 : num;
// };

// const parseDate = (value) => {
//   if (!value) return null;

//   let cleaned = String(value).trim();

//   if (cleaned.includes(".")) {
//     const [d, m, y] = cleaned.split(".");
//     let year = parseInt(y, 10);
//     if (year < 100) year += 2000;
//     return new Date(year, m - 1, d);
//   }

//   if (cleaned.includes("/")) {
//     const [d, m, y] = cleaned.split("/");
//     let year = parseInt(y, 10);
//     if (year < 100) year += 2000;
//     return new Date(year, m - 1, d);
//   }

//   const date = new Date(cleaned);
//   return isNaN(date.getTime()) ? null : date;
// };

// const clean = (val) => (val ? String(val).trim() : null);

// // ---------------- PROCESS CSV ----------------

// const processCSVFile = async (filePath, options = {}) => {
//   const results = [];
//   let headers = null;
//   let isHeaderFound = false;

//   return new Promise((resolve, reject) => {
//     fs.createReadStream(filePath)
//       .pipe(csv({ headers: false })) // IMPORTANT
//       .on("data", (row) => {
//         const values = Object.values(row).map((v) => String(v).trim());

//         // 🔍 Detect header row
//         if (!isHeaderFound) {
//           if (values.includes("ASSET NO") && values.includes("CLIENT NAME")) {
//             headers = values.map(normalizeKey);
//             isHeaderFound = true;
//             console.log("✅ Header detected:", headers);
//           }
//           return;
//         }

//         // Build row object using detected headers
//         const obj = {};
//         headers.forEach((h, i) => {
//           obj[h] = values[i];
//         });

//         const clientName = clean(obj["CLIENT NAME"]);
//         const assetNo = clean(obj["ASSET NO"]);

//         if (!clientName && !assetNo) return;
//         if (clientName?.toUpperCase().includes("TOTAL")) return;

//         const record = {
//           source: options.source || path.basename(filePath),
//           source_period_label: options.periodLabel || null,

//           asset_no: assetNo,
//           client_name: clientName,

//           principal: parseCurrency(obj["PRINCIPAL"]),
//           interest: parseCurrency(obj["INTEREST"]),
//           period: clean(obj["PERIOD"]),

//           amount_due: parseCurrency(obj["AMOUNT DUE"]),
//           penalties: parseCurrency(obj["PENALTIES"]),
//           total_due: parseCurrency(obj["TOTAL DUE"]),
//           profit_loss_on_sale: parseCurrency(obj["P/L ON SALE"]),

//           date_of: parseDate(obj["DATE OF"]),
//           due_date: parseDate(obj["DUE DATE"]),

//           asset: clean(obj["ASSET"]),
//           specs: clean(obj["SPECS"]),
//           asset_code: clean(obj["ASSET CODE"]),
//           reg_or_serial_no: clean(obj["REG /SERIAL NO."]),

//           account_status: clean(obj["ACCOUNT STATUS"]),
//           contact_details: clean(obj["CONTACT DETAILS"]),
//           branch: clean(obj["BRANCH"]),

//           raw: obj,
//           imported_at: new Date(),
//         };

//         results.push(record);
//       })
//       .on("end", () => resolve(results))
//       .on("error", reject);
//   });
// };

// // ---------------- IMPORT ----------------

// const importDebtorsToMongoDB = async (filePath, options = {}) => {
//   try {
//     await mongoose.connect(process.env.MONGODB_URI);
//     console.log("✅ Connected to MongoDB\n");

//     const data = await processCSVFile(filePath, options);

//     if (!data.length) {
//       console.log("❌ No valid data found");
//       return;
//     }

//     console.log(`📊 Processing ${data.length} records...\n`);

//     const bulkOps = data.map((record) => ({
//       updateOne: {
//         filter: {
//           asset_no: record.asset_no,
//           client_name: record.client_name,
//         },
//         update: { $set: record },
//         upsert: true,
//       },
//     }));

//     const result = await DebtorRecord.bulkWrite(bulkOps);

//     console.log("=".repeat(50));
//     console.log("📊 IMPORT SUMMARY");
//     console.log("=".repeat(50));
//     console.log(`📝 Inserted: ${result.upsertedCount}`);
//     console.log(`🔄 Modified: ${result.modifiedCount}`);
//     console.log(`📦 Total: ${data.length}`);
//     console.log("=".repeat(50));
//   } catch (err) {
//     console.error("❌ Error:", err.message);
//   } finally {
//     await mongoose.disconnect();
//     console.log("\n🔌 Disconnected from MongoDB");
//   }
// };

// // ---------------- RUN ----------------

// const args = process.argv.slice(2);

// const filePath = args[0];

// const options = {
//   source: args.find((a) => a.startsWith("--source="))?.split("=")[1],
//   periodLabel: args.find((a) => a.startsWith("--period="))?.split("=")[1],
// };

// if (!filePath) {
//   console.log("❗ Please provide CSV file path");
//   process.exit(1);
// }

// importDebtorsToMongoDB(filePath, options);
