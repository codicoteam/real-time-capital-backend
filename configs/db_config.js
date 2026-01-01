// db_config.js
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not defined in .env");
  process.exit(1);
}

const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Database connected successfully");
  } catch (err) {
    console.error("❌ Error connecting to the database:", err.message || err);
    // Optionally, you can exit the process if DB is critical
    process.exit(1);
  }
};

module.exports = connectDB;