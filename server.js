// server.js
"use strict";

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

const http    = require("http");
const express = require("express");
const cors = require("cors");
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
const loanReportRouter = require("./routers/loan_dashboard_routers");
const auctionReportRouter = require("./routers/auction_report_routers");
const chatRouter          = require("./routers/chat_router");
const investorRouter      = require("./routers/investor/investor_router");

// Services
const auctionService = require("./services/assets_auction_service");

// Socket.io
const initSocket = require("./configs/socket");

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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

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
app.use("/api/v1/loan-report", loanReportRouter);
app.use("/api/v1/auction-report", auctionReportRouter);
app.use("/api/v1/chat",          chatRouter);
app.use("/api/v1/investors",     investorRouter);

// Global error handler
app.use((err, req, res, next) => {
  console.error("❌ Global error:", err.stack || err);
  res.status(500).json({ message: "Something went wrong!" });
});

// Start server — use http.createServer so Socket.io can share the same port
const PORT = process.env.PORT || 7070;

const httpServer = http.createServer(app);

// Attach Socket.io
const io = initSocket(httpServer);
app.set("io", io); // make io available in routes via req.app.get("io")

httpServer.listen(PORT, () => {
  console.log(`🚗 Server running on port ${PORT}`);
  console.log(`📘 Swagger docs: http://localhost:${PORT}/api-docs`);
  console.log(`💬 Socket.io chat ready on ws://localhost:${PORT}`);

  // Start background jobs
  auctionService.startAuctionScheduler();
});
