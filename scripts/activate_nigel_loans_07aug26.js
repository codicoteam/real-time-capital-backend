"use strict";

// One-off: reactivate two cancelled loans for Nigel Zvikomborero Mawire (07 Aug 2026)
//   LON26086065  $100  small loans  due 2026-08-14
//   LON26087393  $105  small loans  due 2026-08-14

require("dotenv").config();
const mongoose = require("mongoose");
const Loan = require("../models/loan.model");
const User = require("../models/user.model");

const LOAN_NOS = ["LON26086065", "LON26087393"];
const OPERATOR_EMAIL = "zpmakaza@gmail.com";

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.\n");

  const operator = await User.findOne({ email: OPERATOR_EMAIL }).select("_id email");
  if (operator) {
    console.log(`Operator: ${operator.email} (${operator._id})`);
  } else {
    console.warn(`⚠ Operator ${OPERATOR_EMAIL} not found — proceeding without processed_by`);
  }

  for (const loanNo of LOAN_NOS) {
    console.log(`\n━━━ ${loanNo} ━━━`);
    const loan = await Loan.findOne({ loan_no: loanNo });
    if (!loan) {
      console.error(`  ✗ Loan ${loanNo} not found — skipping`);
      continue;
    }

    console.log(`  Before: status=${loan.status}  due=${loan.due_date?.toDateString()}  balance=$${loan.current_balance}`);

    if (loan.status === "active") {
      console.log("  ✔ Already active — no change needed");
      continue;
    }

    loan.status = "active";
    if (operator) loan.processed_by = operator._id;

    await loan.save({ validateModifiedOnly: true });
    console.log(`  ✅ Status → active  (due date unchanged: ${loan.due_date?.toDateString()})`);
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("\nFatal:", err);
  process.exit(1);
});
