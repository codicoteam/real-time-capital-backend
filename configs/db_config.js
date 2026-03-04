// db_config.js
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

let connectDB = async () => {
  try {
    // Allow opting out of the in-memory DB (useful for CI or real local DB)
    const useInMemory = process.env.USE_IN_MEMORY_DB === "true";
    const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/real-time-capital";

    if (!useInMemory) {
      await mongoose.connect(MONGODB_URI, {
        connectTimeoutMS: 30000,
        serverSelectionTimeoutMS: 30000,
      });
      console.log("✅ Connected to local MongoDB");
      return;
    }

    // Use in-memory MongoDB without requiring a system installation
    const { MongoMemoryServer } = require("mongodb-memory-server");

    // Download pre-built binaries on first run
    let mongod;
    try {
      // Use a 6.x binary which is more stable with mongodb-memory-server parsing
      mongod = await MongoMemoryServer.create({
        binary: {
          version: "6.0.6",
          downloadDir: './node_modules/.cache/mongodb-memory-server',
          cacheSkipCheck: true,
        },
        instance: {
          launchTimeout: 7200000, // 2 hours timeout for instance startup
          port: 27017,
        },
        spawn: {
          // Increase timeout to 2 hours to allow downloads on slow networks
          timeout: 7200000,
        },
      });
    } catch (err) {
      console.log("⚠️  Auto-download or spawn failed, falling back to local MongoDB...", err.message || err);
      // Fallback to local MongoDB
      await mongoose.connect(MONGODB_URI, {
        connectTimeoutMS: 30000,
        serverSelectionTimeoutMS: 30000,
      });
      console.log("✅ Connected to local MongoDB");
      return;
    }

    const uri = mongod.getUri();
    await mongoose.connect(uri, {
      connectTimeoutMS: 7200000,
      serverSelectionTimeoutMS: 7200000,
      bufferCommands: false,
      socketTimeoutMS: 7200000,
      maxPoolSize: 10,
      family: 4,
      heartbeatFrequencyMS: 300000,
      maxIdleTimeMS: 7200000,
      minPoolSize: 1
    });
    console.log("✅ Connected to in-memory MongoDB for testing");
  } catch (err) {
    console.error("❌ Error connecting to database:", err.message || err);
    console.error("\n📌 Fallback: Install MongoDB Community Edition from https://www.mongodb.com/try/download/community");
    process.exit(1);
  }
};

module.exports = connectDB;
