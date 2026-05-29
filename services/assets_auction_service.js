// services/auction.service.js
const mongoose = require("mongoose");
const Asset = require("../models/asset.model");
const Loan = require("../models/loan.model");
const Auction = require("../models/auction.model");
const User = require("../models/user.model");
const { sendSmsWithMessage } = require("../utils/sms_utils"); // your twilio file
const { sendEmail, generateDocumentTemplate, sendLoanAuctionAdminEmail } = require("../utils/emails_util");
const NotificationService = require("./notifications_service");

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
// Helper – calculate total amount owed at auction
//
// Breaks down into:
//   1. current_balance          – remaining principal (already reflects any payments)
//   2. accrued interest         – interest_rate_percent applied to current_balance
//                                 pro-rated by how many interest periods have elapsed
//                                 since start_date (minimum 1 full period)
//   3. storage charge           – storage_charge_percent of current_balance
//                                 (flat, one-off charge for holding the asset)
//   4. late penalty             – penalty_percent of current_balance
//                                 (applied once because the loan is now in default)
//
// All percentages are stored as plain numbers (e.g. 4 = 4 %).
// ─────────────────────────────────────────────
function calculateAuctionAmount(loan) {
  const balance = loan.current_balance;

  // How many full interest periods have elapsed since the loan started?
  const now = new Date();
  const startDate = new Date(loan.start_date);
  const elapsedDays = Math.max(
    0,
    Math.floor((now - startDate) / (1000 * 60 * 60 * 24)),
  );
  const periodDays = loan.interest_period_days || 30;
  const periods = Math.max(1, Math.floor(elapsedDays / periodDays));

  const interestCharge = balance * (loan.interest_rate_percent / 100) * periods;

  const storageCharge = balance * (loan.storage_charge_percent / 100);

  const penaltyCharge = balance * (loan.penalty_percent / 100);

  const total = balance + interestCharge + storageCharge + penaltyCharge;

  return {
    base_balance: balance,
    interest_charge: parseFloat(interestCharge.toFixed(2)),
    storage_charge: parseFloat(storageCharge.toFixed(2)),
    penalty_charge: parseFloat(penaltyCharge.toFixed(2)),
    total: parseFloat(total.toFixed(2)),
    periods_elapsed: periods,
  };
}

// ─────────────────────────────────────────────
// Helper – update auction status based on dates
// ─────────────────────────────────────────────
async function updateAuctionStatuses() {
  const now = new Date();

  // Close auctions that have ended but are still live
  const closedResult = await Auction.updateMany(
    {
      status: "live",
      ends_at: { $lte: now },
    },
    {
      $set: { status: "closed" },
    },
  );

  // Reopen auctions that should be live but are closed (edge case)
  const reopenedResult = await Auction.updateMany(
    {
      status: "closed",
      ends_at: { $gt: now },
      starts_at: { $lte: now },
    },
    {
      $set: { status: "live" },
    },
  );

  // Set auctions to live if start date has arrived
  const startedResult = await Auction.updateMany(
    {
      status: "draft",
      starts_at: { $lte: now },
      ends_at: { $gt: now },
    },
    {
      $set: { status: "live" },
    },
  );

  if (
    closedResult.modifiedCount > 0 ||
    reopenedResult.modifiedCount > 0 ||
    startedResult.modifiedCount > 0
  ) {
    console.log(
      `[AuctionService] Status updates: ${closedResult.modifiedCount} closed, ` +
        `${reopenedResult.modifiedCount} reopened, ${startedResult.modifiedCount} started.`,
    );
  }

  return {
    closed: closedResult.modifiedCount,
    reopened: reopenedResult.modifiedCount,
    started: startedResult.modifiedCount,
  };
}

// ─────────────────────────────────────────────
// Helper – send auction creation notification to all users
// (Email, Push, In-App only – no SMS)
// ─────────────────────────────────────────────
async function sendAuctionCreatedNotificationToAllUsers(
  asset,
  loan,
  auction,
  breakdown,
) {
  try {
    const adminRoles = [
      "super_admin_vendor",
      "admin_pawn_limited",
      "management",
      "loan_officer_approval",
      "loan_officer_processor",
      "call_centre_support",
    ];

    // Get all active users (customers + staff)
    const allUsers = await User.find({ status: "active" }).lean();

    if (allUsers.length === 0) {
      console.log("[AuctionService] No active users to notify about auction");
      return;
    }

    // Create notification title and message
    const notificationTitle = `New Auction: ${asset.title}`;
    const notificationMessage = `Asset "${asset.title}" (${asset.asset_no}) has been listed for auction with starting bid $${auction.starting_bid_amount.toLocaleString()}. Auction ends on ${new Date(auction.ends_at).toLocaleDateString()}.`;

    // Create notification in database and send to all users
    const notificationResult = await NotificationService.createNotification(
      {
        title: notificationTitle,
        message: notificationMessage,
        type: "auction_created",
        priority: "normal",
        audience: { scope: "all" },
        channels: ["email", "push", "in_app"],
        entity_type: "auction",
        entity_id: auction._id,
        action_text: "View Auction",
        action_url: `/auctions/${auction._id}`,
        data: {
          auction_id: auction._id,
          auction_no: auction.auction_no,
          asset_id: asset._id,
          asset_no: asset.asset_no,
          asset_title: asset.title,
          starting_bid: auction.starting_bid_amount,
          ends_at: auction.ends_at,
          loan_no: loan.loan_no,
          total_owed: breakdown.total,
        },
      },
      loan.created_by, // created_by user ID
    );

    console.log(
      `[AuctionService] Auction notification sent to ${allUsers.length} users. ` +
        `Result: ${notificationResult.success ? "success" : "failed"}`,
    );

    return notificationResult;
  } catch (error) {
    console.error(
      "[AuctionService] Failed to send auction notifications:",
      error.message,
    );
    return null;
  }
}

// ─────────────────────────────────────────────
// Email – asset moved to auction (for the specific customer)
// ─────────────────────────────────────────────
async function sendAuctionNotificationEmail({
  to,
  fullName,
  asset,
  loan,
  auction,
  breakdown,
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
              <td style="padding:4px 0;color:#666;font-size:12px;border-top:1px solid #f5c6c6;padding-top:10px;">Principal Balance:</td>
              <td style="padding:4px 0;color:#333;font-size:12px;border-top:1px solid #f5c6c6;padding-top:10px;">
                $${breakdown.base_balance.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">
                Interest (${loan.interest_rate_percent}% × ${breakdown.periods_elapsed} period${breakdown.periods_elapsed !== 1 ? "s" : ""}):
              </td>
              <td style="padding:4px 0;color:#333;font-size:12px;">
                $${breakdown.interest_charge.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Storage Charge (${loan.storage_charge_percent}%):</td>
              <td style="padding:4px 0;color:#333;font-size:12px;">
                $${breakdown.storage_charge.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">Late Penalty (${loan.penalty_percent}%):</td>
              <td style="padding:4px 0;color:#333;font-size:12px;">
                $${breakdown.penalty_charge.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;border-top:2px solid #e53e3e;padding-top:8px;">
                Total Outstanding:
              </td>
              <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;border-top:2px solid #e53e3e;padding-top:8px;">
                $${breakdown.total.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;padding-top:10px;">Auction No:</td>
              <td style="padding:4px 0;color:#333;font-size:12px;padding-top:10px;">${auction.auction_no}</td>
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

    // ── Calculate the full amount owed including all charges ──
    const breakdown = calculateAuctionAmount(loan);

    // Starting bid = max(evaluated asset value, total amount owed)
    // This ensures the auction at minimum covers what is owed.
    // If the asset is worth more we use the higher value so the customer
    // benefits from any surplus after the debt is recovered.
    const startingBid = asset.evaluated_value
      ? Math.max(asset.evaluated_value, breakdown.total)
      : breakdown.total;

    // Reserve price = total owed (we must at least recover the full debt)
    const reservePrice = breakdown.total;

    const now = new Date();
    const auctionEnd = new Date(now);
    auctionEnd.setDate(auctionEnd.getDate() + 7); // auction runs for 7 days

    const auctionNo = await generateAuctionNo();

    const [auction] = await Auction.create(
      [
        {
          auction_no: auctionNo,
          asset: asset._id,
          starting_bid_amount: startingBid,
          reserve_price: reservePrice,
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
      // 1. Send notification to the specific customer (email + SMS)
      const customer = await User.findById(loan.customer_user).lean();
      if (customer) {
        const fullName = `${customer.first_name} ${customer.last_name}`;

        // Email to customer
        if (customer.email) {
          await sendAuctionNotificationEmail({
            to: customer.email,
            fullName,
            asset,
            loan,
            auction,
            breakdown,
          }).catch((err) =>
            console.error(
              `Auction email failed for loan ${loan.loan_no}:`,
              err.message,
            ),
          );
        }

        // SMS to customer
        if (customer.phone) {
          const smsBody =
            `REAL TIME CAPITAL: Your asset "${asset.title}" (${asset.asset_no}) ` +
            `has been listed for auction (Ref: ${auctionNo}) due to non-payment of ` +
            `Loan #${loan.loan_no}. ` +
            `Total owed incl. interest, storage & penalty: $${breakdown.total.toLocaleString()}. ` +
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

      // 2. Send notification to ALL users (email, push, in-app) about new auction
      await sendAuctionCreatedNotificationToAllUsers(
        asset,
        loan,
        auction,
        breakdown,
      );

      // 3. Notify admins about the auction
      const customerName = customer
        ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim()
        : "Unknown Client";
      await sendLoanAuctionAdminEmail({
        loanNo: loan.loan_no,
        customerName,
        principalAmount: loan.principal_amount,
        assetTitle: asset.title,
        assetNo: asset.asset_no,
        totalOwed: breakdown.total,
        auctionNo: auction.auction_no,
      }).catch((err) =>
        console.error(`Auction admin email failed for loan ${loan.loan_no}:`, err.message)
      );
    } catch (notifyErr) {
      console.error("Notification error (non-fatal):", notifyErr.message);
    }

    console.log(
      `[AuctionService] Loan ${loan.loan_no} → auction ${auctionNo} | ` +
        `balance: $${breakdown.base_balance} + interest: $${breakdown.interest_charge} + ` +
        `storage: $${breakdown.storage_charge} + penalty: $${breakdown.penalty_charge} = ` +
        `total: $${breakdown.total} | starting bid: $${startingBid}`,
    );

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

  // First, update auction statuses based on dates
  await updateAuctionStatuses();

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

  // First, update auction statuses
  await updateAuctionStatuses();

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
// Scheduled Job 3: Auto-close expired auctions
// Runs every 15 minutes to keep statuses in sync
// ─────────────────────────────────────────────
async function autoCloseExpiredAuctions() {
  console.log("[AuctionService] Running autoCloseExpiredAuctions...");
  const result = await updateAuctionStatuses();
  return result;
}

// ─────────────────────────────────────────────
// Start the scheduler (call this once on server boot)
// ─────────────────────────────────────────────
function startAuctionScheduler() {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const ONE_DAY_MS = 24 * ONE_HOUR_MS;
  const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

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

  // Run every 15 minutes to auto-close expired auctions
  setTimeout(() => {
    autoCloseExpiredAuctions().catch(console.error);
    setInterval(
      () => autoCloseExpiredAuctions().catch(console.error),
      FIFTEEN_MINUTES_MS,
    );
  }, 30_000);

  console.log("[AuctionService] Scheduler started.");
}

module.exports = {
  startAuctionScheduler,
  processExpiredLoans,
  sendUpcomingAuctionWarnings,
  moveLoanToAuction, // export for manual/admin triggers
  calculateAuctionAmount, // export for use in admin previews / UI
  updateAuctionStatuses, // export for manual status updates
  autoCloseExpiredAuctions, // export for manual triggering
};
