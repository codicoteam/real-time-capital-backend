"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Investor = require("../models/investor/investor.model");

const UPDATES = [
  { name: "ROI",       newEmail: "roikanner.rk@gmail.com", newPassword: "Roi@rtcinvestor" },
  { name: "Mucheke",   newEmail: "emucheke@gmail.com",      newPassword: "Mucheke@rtcinvestor" },
  { name: "Cranbrook", newEmail: "cranbrook@gmail.com",     newPassword: "Cranbrook@rtcinvestor" },
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  for (const u of UPDATES) {
    const investor = await Investor.findOne({
      name: new RegExp(`^${u.name}$`, "i"),
      status: { $ne: "deleted" },
    }).select("+password_hash");

    if (!investor) {
      console.log(`[NOT FOUND] No investor named "${u.name}"`);
      continue;
    }

    const emailConflict = await Investor.findOne({
      email: u.newEmail.toLowerCase(),
      _id: { $ne: investor._id },
    });
    if (emailConflict) {
      console.log(`[CONFLICT] ${u.newEmail} already used by ${emailConflict.name}`);
      continue;
    }

    investor.email = u.newEmail.toLowerCase().trim();
    investor.password_hash = await bcrypt.hash(u.newPassword, 10);
    await investor.save();
    console.log(`[UPDATED] ${u.name} (${investor._id}): email → ${u.newEmail} | password set`);
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

run().catch((err) => {
  console.error("Error:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
