"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");
const User     = require("../models/user.model");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const email = "zpmakaza@gmail.com";
  const password_hash = await bcrypt.hash("clinpride", 10);

  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        first_name:     "Prince",
        last_name:      "Makaza",
        full_name:      "Prince Makaza",
        roles:          ["super_admin_vendor"],
        status:         "active",
        email_verified: true,
        password_hash,
      },
    },
    { new: true, upsert: true },
  );

  console.log(`✅ Super admin ready!`);
  console.log(`   Name  : Prince Makaza`);
  console.log(`   Email : ${email}`);
  console.log(`   Role  : super_admin_vendor`);
  console.log(`   Status: active`);
  console.log(`   ID    : ${user._id}`);

  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
