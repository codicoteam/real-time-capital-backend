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
const loanReportRouter = require("./routers/loan_dashboard_routers");
const auctionReportRouter = require("./routers/auction_report_routers");

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

// ================= TEST ROUTES =================
// Test Firebase initialization
app.get("/test-firebase", (req, res) => {
  try {
    const isInitialized = admin.apps.length > 0;
    const projectId = isInitialized ? admin.apps[0].options.projectId : null;

    res.json({
      success: true,
      firebaseInitialized: isInitialized,
      projectId: projectId,
      message: isInitialized
        ? "Firebase is working!"
        : "Firebase not initialized",
      credentialType: isInitialized
        ? process.env.FIREBASE_SERVICE_ACCOUNT_PATH
          ? "Service Account File"
          : process.env.FIREBASE_PROJECT_ID
            ? "Environment Variables"
            : "Default Credentials"
        : null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test direct push notification
app.post("/test-push-direct", async (req, res) => {
  try {
    const { email, title, message } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Find user
    const User = require("./models/user.model");
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.fcm_tokens || user.fcm_tokens.length === 0) {
      return res.status(400).json({
        error: "No FCM tokens for this user",
        userEmail: user.email,
        hasTokens: false,
      });
    }

    // Send direct push
    const results = [];
    for (const token of user.fcm_tokens) {
      try {
        const response = await admin.messaging().send({
          token: token,
          notification: {
            title: title || "Direct Test",
            body: message || "This is a direct test from server",
          },
          data: {
            type: "test",
            timestamp: new Date().toISOString(),
          },
          android: {
            priority: "high",
          },
          apns: {
            payload: {
              aps: {
                sound: "default",
                badge: 1,
              },
            },
          },
        });
        results.push({
          token: token.substring(0, 20) + "...",
          success: true,
          response,
        });
        console.log(`✅ Push sent to ${token.substring(0, 20)}...`);
      } catch (error) {
        results.push({
          token: token.substring(0, 20) + "...",
          success: false,
          error: error.message,
        });
        console.error(
          `❌ Failed to send to ${token.substring(0, 20)}...:`,
          error.message,
        );

        // If token is invalid, remove it
        if (
          error.code === "messaging/invalid-registration-token" ||
          error.code === "messaging/registration-token-not-registered"
        ) {
          await User.updateOne(
            { _id: user._id },
            { $pull: { fcm_tokens: token } },
          );
          console.log(`🗑️ Removed invalid token for user ${user.email}`);
        }
      }
    }

    const successful = results.filter((r) => r.success).length;

    res.json({
      success: successful > 0,
      message: `Sent ${successful}/${user.fcm_tokens.length} notifications`,
      results,
      user: {
        email: user.email,
        tokenCount: user.fcm_tokens.length,
      },
    });
  } catch (error) {
    console.error("Test push error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Check user FCM tokens
app.get("/check-fcm-tokens/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const User = require("./models/user.model");
    const user = await User.findOne(
      { email },
      { fcm_tokens: 1, email: 1, full_name: 1 },
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      user: {
        email: user.email,
        full_name: user.full_name,
        fcm_tokens: user.fcm_tokens || [],
        tokenCount: (user.fcm_tokens || []).length,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ========================================================

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
  console.log(`🧪 Test endpoints:`);
  console.log(`   - GET  /test-firebase`);
  console.log(`   - GET  /check-fcm-tokens/:email`);
  console.log(`   - POST /test-push-direct`);

  // Start background jobs
  auctionService.startAuctionScheduler();
});
