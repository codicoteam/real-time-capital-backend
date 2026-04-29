// app.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const admin = require("firebase-admin");

// DB + Socket config
const connectDB = require("./configs/db_config");
// const initChatSocket = require("./config/socket_config");

// Swagger setup
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

// Auction service (automatic loan expiry & notifications)
const auctionService = require("./services/assets_auction_service");

// Load env
dotenv.config();

// Initialize Firebase Admin SDK for push notifications
if (!admin.apps.length) {
  try {
    // Check if service account file exists (for production)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log("Firebase Admin SDK initialized using service account file");
    } else if (process.env.FIREBASE_PROJECT_ID && 
               process.env.FIREBASE_PRIVATE_KEY && 
               process.env.FIREBASE_CLIENT_EMAIL) {
      // Use environment variables (for production without file)
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
      console.log("Firebase Admin SDK initialized using environment variables");
    } else {
      // Try default credentials (for local development with GOOGLE_APPLICATION_CREDENTIALS)
      admin.initializeApp();
      console.log("Firebase Admin SDK initialized using default credentials");
    }
  } catch (error) {
    console.error("Firebase Admin SDK initialization failed:", error.message);
    console.warn("Push notifications will not work. Please check your Firebase configuration.");
  }
}

// Connect DB
connectDB();

const app = express();
// const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

// Swagger docs
setupSwagger(app);

// REST Routes
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

// Global error handler (REST)
app.use((err, req, res, next) => {
  console.error("Global error handler:", err.stack || err);
  res.status(500).json({ message: "Something went wrong!" });
});

// Init Socket.IO (chat + tracking now)
// initChatSocket(server);

// Start server
const PORT = process.env.PORT || 7070;
app.listen(PORT, () => {
  console.log(`🚗 Server running on port ${PORT}`);
  console.log(`📘 Swagger docs available at http://localhost:${PORT}/api-docs`);

  // Start auction scheduler (automatic processing of expired loans & warnings)
  auctionService.startAuctionScheduler();
});