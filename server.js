// server.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const path = require("path");

// Load env FIRST
dotenv.config();

// DB
const connectDB = require("./configs/db_config");

// Swagger
const setupSwagger = require("./middlewares/swagger");

// Routers
const debtorRecordRouter = require("./routers/debtor_record_router");
const userRouter = require("./routers/user_router");
const attachmentRouter = require("./routers/attachment_router");
const loanApplicationRouter = require("./routers/loan_application_router");
const assetRouter = require("./routers/asset_router");
const loanRouter = require("./routers/loan_router");
const loanTermRouter = require("./routers/loan_term_router");
const paymentRouter = require("./routers/payment_router");
const supportTicketRouter = require("./routers/support_ticket_router");
const auctionRouter = require("./routers/auction_router");
const bidRouter = require("./routers/bid_router");
const bidPaymentRouter = require("./routers/bid_payment_router");
const auditLogRouter = require("./routers/audit_log_router");
const inventoryRouter = require("./routers/inventory_transaction_router");
const ledgerEntryRouter = require("./routers/ledger_entry_router");
const assetValuationRouter = require("./routers/asset_valuation_router");
const homeRouter = require("./routers/home_router");
const customerDashboardRouter = require("./routers/customer_dashboard_router");
const reportRouter = require("./routers/report_router");
const expenseRouter = require("./routers/expense_router");
const smsRouter = require("./routers/sms_routes");
const emailRouter = require("./routers/email_routes");
const notificationsRouter = require("./routers/notifications_router");

// Services
const auctionService = require("./services/assets_auction_service");

// ================= FIREBASE INIT (FIXED) =================
if (!admin.apps.length) {
  try {
    // OPTION 1: Use service account file (recommended if file exists)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const serviceAccountPath = path.join(
        __dirname,
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
      );

      const serviceAccount = require(serviceAccountPath);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });

      console.log("✅ Firebase initialized using service account file");
    }

    // OPTION 2: Use ENV variables (best for production)
    else if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL
    ) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });

      console.log("✅ Firebase initialized using ENV variables");
    }

    // OPTION 3: Fallback (not recommended for production)
    else {
      admin.initializeApp();
      console.log("⚠️ Firebase initialized using default credentials");
    }
  } catch (error) {
    console.error("❌ Firebase initialization failed:", error);
    console.warn("⚠️ Push notifications will NOT work");
  }
}
// ========================================================

// Connect DB
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

// Swagger
setupSwagger(app);

// Routes
app.use("/api/v1/users", userRouter);
app.use("/api/v1/debtor-records", debtorRecordRouter);
app.use("/api/v1/attachments", attachmentRouter);
app.use("/api/v1/loan-applications", loanApplicationRouter);
app.use("/api/v1/assets", assetRouter);
app.use("/api/v1/loans", loanRouter);
app.use("/api/v1/loan-terms", loanTermRouter);
app.use("/api/v1/payments", paymentRouter);
app.use("/api/v1/support-tickets", supportTicketRouter);
app.use("/api/v1/auctions", auctionRouter);
app.use("/api/v1/bids", bidRouter);
app.use("/api/v1/bid-payments", bidPaymentRouter);
app.use("/api/v1/audit-logs", auditLogRouter);
app.use("/api/v1/transactions", inventoryRouter);
app.use("/api/v1/ledger-entries", ledgerEntryRouter);
app.use("/api/v1/asset-valuations", assetValuationRouter);
app.use("/api/v1/home", homeRouter);
app.use("/api/v1/customer/dashboard", customerDashboardRouter);
app.use("/api/v1/report", reportRouter);
app.use("/api/v1/expenses", expenseRouter);
app.use("/api/v1/sms", smsRouter);
app.use("/api/v1/email", emailRouter);
app.use("/api/v1/notifications", notificationsRouter);

// Global error handler
app.use((err, req, res, next) => {
  console.error("❌ Global error:", err.stack || err);
  res.status(500).json({ message: "Something went wrong!" });
});

// Start server
const PORT = process.env.PORT || 7070;

app.listen(PORT, () => {
  console.log(`🚗 Server running on port ${PORT}`);
  console.log(`📘 Swagger docs: http://localhost:${PORT}/api-docs`);

  // Start background jobs
  auctionService.startAuctionScheduler();
});
