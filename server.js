// app.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
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

// Load env
dotenv.config();

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

// Global error handler (REST)
app.use((err, req, res, next) => {
  console.error("Global error handler:", err.stack || err);
  res.status(500).json({ message: "Something went wrong!" });
});

// Init Socket.IO (chat + tracking now)
// initChatSocket(server);

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚗 Server running on port ${PORT}`);
  console.log(`📘 Swagger docs available at http://localhost:${PORT}/api-docs`);
});