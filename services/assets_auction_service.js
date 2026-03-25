// services/auction.service.js
const mongoose = require("mongoose");
const Asset = require("../models/asset.model");
const Loan = require("../models/loan.model");
const Auction = require("../models/auction.model");
const User = require("../models/user.model");
const { sendSmsWithMessage } = require("../utils/sms_utils"); // your twilio file
const { sendEmail, generateDocumentTemplate } = require("../utils/emails_util");

// ─────────────────────────────────────────────
// Helper – generate sequential auction_no
// ─────────────────────────────────────────────
async function generateAuctionNo() {
  const last = await Auction.findOne({}, { auction_no: 1 })
    .sort({ created_at: -1 })
    .lean();

  if (!last?.auction_no) return "AUC-0001";
  const num = parseInt(last.auction_no.replace("AUC-", ""), 10) + 1;
  return `AUC-${String(num).padStart(4, "0")}`;
}

// ─────────────────────────────────────────────
// Email – asset moved to auction
// ─────────────────────────────────────────────
async function sendAuctionNotificationEmail({
  to,
  fullName,
  asset,
  loan,
  auction,
}) {
  const subject = `URGENT: Your Asset Has Been Listed for Auction – Loan #${loan.loan_no}`;
  const title = "Asset Listed for Auction";

  const message = `
    <p style="margin: 0 0 15px 0;">Dear ${fullName},</p>
    <p style="margin: 0 0 15px 0;">
      This is to inform you that due to the expiry of your loan period without redemption,
      the asset held as collateral against <strong>Loan #${loan.loan_no}</strong> has been
      listed for auction by Real Time Capital.
    </p>
    <p style="margin: 0 0 15px 0;">
      To prevent the auction from proceeding, you must settle the outstanding balance in full
      <strong>before the auction start date</strong>.
    </p>
    <p style="margin: 0;">
      Please contact our offices immediately if you wish to redeem your item.
    </p>
  `;

  const detailsHtml = `
    <table width="100%" cellpadding="0" cellspacing="0"
           style="margin:25px 0;background-color:#fff3f3;border:1px solid #e53e3e;border-radius:8px;">
      <tr>
        <td style="padding:15px;">
          <p style="color:#c53030;font-size:12px;margin:0 0 12px 0;font-weight:bold;
                     border-bottom:2px solid #e53e3e;padding-bottom:5px;">
            AUCTION DETAILS
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;width:170px;">Asset:</td>
              <td style="padding:4px 0;color:#1a1a1a;font-size:12px;font-weight:bold;">${asset.title}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Asset No:</td>
              <td style="padding:4px 0;color:#333;font-size:12px;">${asset.asset_no}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Loan No:</td>
              <td style="padding:4px 0;color:#333;font-size:12px;">${loan.loan_no}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Outstanding Balance:</td>
              <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;">
                $${loan.current_balance.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Auction No:</td>
              <td style="padding:4px 0;color:#333;font-size:12px;">${auction.auction_no}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Auction Starts:</td>
              <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;">
                ${new Date(auction.starts_at).toLocaleString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Starting Bid:</td>
              <td style="padding:4px 0;color:#333;font-size:12px;">
                $${auction.starting_bid_amount.toLocaleString()}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  const html = generateDocumentTemplate({
    title,
    message,
    details: detailsHtml,
  });
  await sendEmail({ to, subject, html });
}

// ─────────────────────────────────────────────
// Email – 2-day warning before auction
// ─────────────────────────────────────────────
async function sendAuctionWarningEmail({ to, fullName, asset, loan, auction }) {
  const subject = `REMINDER: Your Asset Goes to Auction in 2 Days – Loan #${loan.loan_no}`;
  const title = "Auction in 2 Days – Immediate Action Required";

  const message = `
    <p style="margin: 0 0 15px 0;">Dear ${fullName},</p>
    <p style="margin: 0 0 15px 0;">
      This is an urgent reminder that the asset held against <strong>Loan #${loan.loan_no}</strong>
      is scheduled for auction in <strong>2 days</strong>.
    </p>
    <p style="margin: 0 0 15px 0;">
      To redeem your item and stop the auction, you must settle your outstanding balance of
      <strong>$${loan.current_balance.toLocaleString()}</strong> before
      <strong>${new Date(auction.starts_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}</strong>.
    </p>
    <p style="margin: 0;">
      Please visit our offices or contact us immediately to arrange payment.
    </p>
  `;

  const detailsHtml = `
    <table width="100%" cellpadding="0" cellspacing="0"
           style="margin:25px 0;background-color:#fff9e6;border:1px solid #ffa500;border-radius:8px;">
      <tr>
        <td style="padding:15px;">
          <p style="color:#8b5a00;font-size:12px;margin:0 0 10px 0;font-weight:bold;">
            ⚠ URGENT – AUCTION REMINDER
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;width:170px;">Asset:</td>
              <td style="padding:4px 0;color:#1a1a1a;font-size:12px;font-weight:bold;">${asset.title}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Asset No:</td>
              <td style="padding:4px 0;color:#333;font-size:12px;">${asset.asset_no}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Outstanding Balance:</td>
              <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;">
                $${loan.current_balance.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Auction Date:</td>
              <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;">
                ${new Date(auction.starts_at).toLocaleString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  const html = generateDocumentTemplate({
    title,
    message,
    details: detailsHtml,
  });
  await sendEmail({ to, subject, html });
}

// ─────────────────────────────────────────────
// Core: move a single overdue loan to auction
// ─────────────────────────────────────────────
async function moveLoanToAuction(loan) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const asset = await Asset.findById(loan.asset).session(session);
    if (!asset) throw new Error(`Asset not found for loan ${loan._id}`);

    // Auction starts immediately (or you can offset by grace_days if you prefer)
    const now = new Date();
    const auctionEnd = new Date(now);
    auctionEnd.setDate(auctionEnd.getDate() + 7); // auction runs for 7 days

    const auctionNo = await generateAuctionNo();
    const startingBid = asset.evaluated_value ?? loan.current_balance;

    const [auction] = await Auction.create(
      [
        {
          auction_no: auctionNo,
          asset: asset._id,
          starting_bid_amount: startingBid,
          reserve_price: loan.current_balance, // at minimum recover the outstanding balance
          auction_type: "online",
          starts_at: now,
          ends_at: auctionEnd,
          status: "live",
          created_by: loan.created_by,
        },
      ],
      { session },
    );

    // Update loan status
    await Loan.findByIdAndUpdate(loan._id, { status: "auction" }, { session });

    // Update asset status
    await Asset.findByIdAndUpdate(
      asset._id,
      { status: "auction" },
      { session },
    );

    await session.commitTransaction();

    // ── Notifications (outside the transaction – non-critical) ──
    try {
      const customer = await User.findById(loan.customer_user).lean();
      if (customer) {
        const fullName = `${customer.first_name} ${customer.last_name}`;

        // Email
        if (customer.email) {
          await sendAuctionNotificationEmail({
            to: customer.email,
            fullName,
            asset,
            loan,
            auction,
          }).catch((err) =>
            console.error(
              `Auction email failed for loan ${loan.loan_no}:`,
              err.message,
            ),
          );
        }

        // SMS
        if (customer.phone) {
          const smsBody =
            `REAL TIME CAPITAL: Your asset "${asset.title}" (${asset.asset_no}) ` +
            `has been listed for auction (Ref: ${auctionNo}) due to non-payment of ` +
            `Loan #${loan.loan_no}. Outstanding: $${loan.current_balance.toLocaleString()}. ` +
            `Auction starts: ${new Date(auction.starts_at).toLocaleDateString()}. ` +
            `Contact us immediately to redeem.`;

          await sendSmsWithMessage(customer.phone, smsBody).catch((err) =>
            console.error(
              `Auction SMS failed for loan ${loan.loan_no}:`,
              err.message,
            ),
          );
        }
      }
    } catch (notifyErr) {
      console.error("Notification error (non-fatal):", notifyErr.message);
    }

    console.log(`[AuctionService] Loan ${loan.loan_no} → auction ${auctionNo}`);
    return auction;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// ─────────────────────────────────────────────
// Scheduled Job 1: Move expired loans to auction
// Runs every hour (or however often you schedule it)
// ─────────────────────────────────────────────
async function processExpiredLoans() {
  console.log("[AuctionService] Running processExpiredLoans...");

  const now = new Date();

  // Find all active/overdue/in_grace loans whose due_date has passed
  // and whose linked asset is not already in auction/sold
  const expiredLoans = await Loan.find({
    status: { $in: ["active", "overdue", "in_grace"] },
    due_date: { $lte: now },
  })
    .populate("asset")
    .lean();

  let moved = 0;

  for (const loan of expiredLoans) {
    // Skip if asset already auctioned / sold
    if (!loan.asset || ["auction", "sold"].includes(loan.asset.status)) {
      continue;
    }

    // Double-check no live auction already exists for this asset
    const existingAuction = await Auction.findOne({
      asset: loan.asset._id,
      status: { $in: ["draft", "live"] },
    }).lean();

    if (existingAuction) continue;

    try {
      await moveLoanToAuction(loan);
      moved++;
    } catch (err) {
      console.error(
        `[AuctionService] Failed to move loan ${loan.loan_no} to auction:`,
        err.message,
      );
    }
  }

  console.log(
    `[AuctionService] processExpiredLoans complete – ${moved} loan(s) moved to auction.`,
  );
}

// ─────────────────────────────────────────────
// Scheduled Job 2: Send 2-day warnings
// Run once a day
// ─────────────────────────────────────────────
async function sendUpcomingAuctionWarnings() {
  console.log("[AuctionService] Running sendUpcomingAuctionWarnings...");

  const now = new Date();
  const warningStart = new Date(now);
  warningStart.setDate(warningStart.getDate() + 2);
  warningStart.setHours(0, 0, 0, 0);

  const warningEnd = new Date(warningStart);
  warningEnd.setHours(23, 59, 59, 999);

  // Find loans whose due_date falls within the 2-day warning window
  const warningLoans = await Loan.find({
    status: { $in: ["active", "overdue", "in_grace"] },
    due_date: { $gte: warningStart, $lte: warningEnd },
  })
    .populate("asset")
    .lean();

  let warned = 0;

  for (const loan of warningLoans) {
    if (!loan.asset || ["auction", "sold"].includes(loan.asset.status))
      continue;

    try {
      const customer = await User.findById(loan.customer_user).lean();
      if (!customer) continue;

      const fullName = `${customer.first_name} ${customer.last_name}`;

      // Build a placeholder auction object for the template
      // (real auction doesn't exist yet, but we can show the upcoming date)
      const upcomingAuction = {
        auction_no: "PENDING",
        starts_at: loan.due_date,
        starting_bid_amount: loan.asset.evaluated_value ?? loan.current_balance,
      };

      if (customer.email) {
        await sendAuctionWarningEmail({
          to: customer.email,
          fullName,
          asset: loan.asset,
          loan,
          auction: upcomingAuction,
        }).catch((err) =>
          console.error(
            `Warning email failed for loan ${loan.loan_no}:`,
            err.message,
          ),
        );
      }

      if (customer.phone) {
        const dueStr = new Date(loan.due_date).toLocaleDateString("en-US", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        const smsBody =
          `REAL TIME CAPITAL REMINDER: Your asset "${loan.asset.title}" ` +
          `(Loan #${loan.loan_no}) is due on ${dueStr}. ` +
          `Outstanding: $${loan.current_balance.toLocaleString()}. ` +
          `Failure to pay will result in auction. Contact us now.`;

        await sendSmsWithMessage(customer.phone, smsBody).catch((err) =>
          console.error(
            `Warning SMS failed for loan ${loan.loan_no}:`,
            err.message,
          ),
        );
      }

      warned++;
    } catch (err) {
      console.error(
        `[AuctionService] Warning failed for loan ${loan.loan_no}:`,
        err.message,
      );
    }
  }

  console.log(
    `[AuctionService] sendUpcomingAuctionWarnings complete – ${warned} warning(s) sent.`,
  );
}

// ─────────────────────────────────────────────
// Start the scheduler (call this once on server boot)
// ─────────────────────────────────────────────
function startAuctionScheduler() {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const ONE_DAY_MS = 24 * ONE_HOUR_MS;

  // Run immediately on startup, then every hour
  processExpiredLoans().catch(console.error);
  setInterval(() => processExpiredLoans().catch(console.error), ONE_HOUR_MS);

  // Run once a day for 2-day warnings (offset by 1 minute so it doesn't clash)
  setTimeout(() => {
    sendUpcomingAuctionWarnings().catch(console.error);
    setInterval(
      () => sendUpcomingAuctionWarnings().catch(console.error),
      ONE_DAY_MS,
    );
  }, 60_000);

  console.log("[AuctionService] Scheduler started.");
}

module.exports = {
  startAuctionScheduler,
  processExpiredLoans,
  sendUpcomingAuctionWarnings,
  moveLoanToAuction, // export for manual/admin triggers
};
