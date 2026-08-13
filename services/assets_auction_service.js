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
// The grace period 10% penalty is already baked into current_balance when
// Phase 1 fires. Auction does NOT add any further penalty — the rate is
// frozen at the same 10% applied during grace.
//
// Example – $100 principal, 2-week loan:
//   Loan created  : $100 + 20% fee   = $120  (current_balance at creation)
//   Grace penalty : +10% of $120     = +$12  (current_balance → $132)
//   Auction total :                    $132  (no additional charge)
//
// If the winning bid exceeds this settlement total, the excess profit is
// split 50/50 between the investor and RTC (tracked on the Auction document).
// ─────────────────────────────────────────────
function calculateAuctionAmount(loan) {
  const balance = loan.current_balance; // already includes grace penalty
  const bd = loan.repayment_breakdown || {};

  return {
    base_balance: balance,
    grace_penalty: parseFloat((bd.penalty_amount || 0).toFixed(2)),
    penalty_charge: 0, // no additional penalty at auction
    total: balance,
    // kept for email template compatibility
    interest_charge: 0,
    storage_charge: 0,
    periods_elapsed: 1,
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
              <td style="padding:4px 0;color:#666;font-size:12px;border-top:1px solid #f5c6c6;padding-top:10px;">Balance Before Grace Penalty:</td>
              <td style="padding:4px 0;color:#333;font-size:12px;border-top:1px solid #f5c6c6;padding-top:10px;">
                $${(breakdown.base_balance - breakdown.grace_penalty).toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#666;font-size:12px;">
                Grace Penalty (${loan.penalty_percent}%):
              </td>
              <td style="padding:4px 0;color:#333;font-size:12px;">
                $${breakdown.grace_penalty.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;border-top:2px solid #e53e3e;padding-top:8px;">
                Total Outstanding (Settlement Amount):
              </td>
              <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;border-top:2px solid #e53e3e;padding-top:8px;">
                $${breakdown.total.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td colspan="2" style="padding:8px 0 4px 0;color:#666;font-size:11px;font-style:italic;">
                Note: No additional penalty applies at auction — the 10% grace period rate is final.
                If the asset sells above the settlement amount, any surplus is shared 50/50 between
                the investor and Real Time Capital.
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
        `settlement total (incl. grace penalty): $${breakdown.total} | starting bid: $${startingBid}`,
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
// Helper – notify customer that their loan entered grace period
// ─────────────────────────────────────────────
async function sendGracePeriodNotification(loan, customer, penaltyAmount, graceDays, penaltyPercent) {
  const fullName = `${customer.first_name} ${customer.last_name}`;
  const subject = `URGENT: Grace Period Active – Loan #${loan.loan_no}`;
  const title   = "Grace Period Has Started";

  const message = `
    <p style="margin:0 0 15px 0;">Dear ${fullName},</p>
    <p style="margin:0 0 15px 0;">
      Your loan <strong>#${loan.loan_no}</strong> has passed its due date without full repayment.
      A <strong>${penaltyPercent}% late penalty of $${penaltyAmount.toLocaleString()}</strong>
      has been added to your outstanding balance.
    </p>
    <p style="margin:0 0 15px 0;">
      You now have a <strong>${graceDays}-day grace period</strong> to repay in full.
      If payment is not received within this period, your collateral asset will be
      <strong>automatically listed for auction</strong>.
    </p>
    <p style="margin:0;">Please contact us immediately to arrange payment.</p>
  `;

  const detailsHtml = `
    <table width="100%" cellpadding="0" cellspacing="0"
           style="margin:20px 0;background:#fff9e6;border:1px solid #ffa500;border-radius:8px;">
      <tr><td style="padding:15px;">
        <p style="color:#8b5a00;font-size:12px;margin:0 0 10px 0;font-weight:bold;">⚠ GRACE PERIOD DETAILS</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:4px 0;color:#666;font-size:12px;width:200px;">Loan No:</td>
            <td style="padding:4px 0;color:#333;font-size:12px;font-weight:bold;">${loan.loan_no}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#666;font-size:12px;">Penalty Rate:</td>
            <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;">${penaltyPercent}%</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#666;font-size:12px;">Penalty Amount Added:</td>
            <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;">$${penaltyAmount.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#666;font-size:12px;">Grace Period:</td>
            <td style="padding:4px 0;color:#333;font-size:12px;font-weight:bold;">${graceDays} days from due date</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;padding-top:10px;">Action Required:</td>
            <td style="padding:4px 0;color:#c53030;font-size:12px;font-weight:bold;padding-top:10px;">Pay in full to avoid auction</td>
          </tr>
        </table>
      </td></tr>
    </table>
  `;

  const { generateDocumentTemplate, sendEmail } = require("../utils/emails_util");
  const html = generateDocumentTemplate({ title, message, details: detailsHtml });

  if (customer.email) {
    await sendEmail({ to: customer.email, subject, html }).catch((err) =>
      console.error(`Grace period email failed for loan ${loan.loan_no}:`, err.message)
    );
  }

  if (customer.phone) {
    const smsBody =
      `REAL TIME CAPITAL: Loan #${loan.loan_no} is overdue. ` +
      `A ${penaltyPercent}% penalty ($${penaltyAmount.toLocaleString()}) has been added. ` +
      `You have ${graceDays} days to repay or your asset will go to auction. Contact us now.`;
    await sendSmsWithMessage(customer.phone, smsBody).catch((err) =>
      console.error(`Grace period SMS failed for loan ${loan.loan_no}:`, err.message)
    );
  }
}

// ─────────────────────────────────────────────
// Scheduled Job 1: Two-phase grace → auction lifecycle
//
// Timeline example — 2-week loan applied July 1:
//   • July 1  : loan given, 14-day count starts July 2 (application day excluded)
//   • July 15 : due date — last day customer can pay $120 with no penalty
//   • July 16 : grace starts — 10% penalty added (e.g. $120 → $132)
//   • July 22 : grace ends — asset listed for auction at $132 (NO extra penalty)
//
// The 10% grace penalty is the final penalty. Auction does NOT add any further
// charge. If the asset sells above the settlement amount ($132), the surplus
// is split 50/50 between the investor and RTC (recorded on the Auction document).
//
// Same logic applies to monthly loans (due_date + 30 days, grace July 16→ Aug 7).
//
// Phase 1 (every run): loans whose due_date has passed AND the day after due has
//   arrived → status = "in_grace", 10% penalty applied once.
//
// Phase 2 (every run): in_grace loans where grace window has expired →
//   move to auction. Settlement total = current_balance (already includes grace penalty).
//
// Runs every hour.
// ─────────────────────────────────────────────
async function processExpiredLoans() {
  console.log("[AuctionService] Running processExpiredLoans...");
  await updateAuctionStatuses();

  const now = new Date();
  let graced = 0;
  let moved  = 0;

  // ── Phase 1: grace starts the day AFTER the due date ──
  // e.g. due July 15 → grace starts July 16
  const overdueLoans = await Loan.find({
    status: { $in: ["active", "overdue"] },
    due_date: { $lte: now },
  }).lean();

  for (const loan of overdueLoans) {
    const graceDays   = loan.grace_days ?? 7;
    const graceEndsAt = new Date(loan.due_date);
    graceEndsAt.setDate(graceEndsAt.getDate() + graceDays);

    // Only handle loans still inside the grace window here
    if (now >= graceEndsAt) continue;

    // Grace starts the day AFTER the due date — do nothing on the due date itself
    const dayAfterDue = new Date(loan.due_date);
    dayAfterDue.setDate(dayAfterDue.getDate() + 1);
    if (now < dayAfterDue) continue;

    try {
      const bd = loan.repayment_breakdown || {};
      const penaltyAlreadyApplied = Boolean(bd.penalty_applied);
      const penaltyPercent        = loan.penalty_percent ?? 10;

      const updateData = { status: "in_grace" };

      let penaltyAmount = 0;
      if (!penaltyAlreadyApplied) {
        const balanceBefore = loan.current_balance;
        penaltyAmount       = parseFloat((balanceBefore * (penaltyPercent / 100)).toFixed(2));
        const totalWithPenalty = parseFloat((balanceBefore + penaltyAmount).toFixed(2));

        updateData.current_balance = totalWithPenalty;
        updateData.repayment_breakdown = {
          ...bd,
          penalty_applied:        true,
          penalty_percent:        penaltyPercent,
          penalty_amount:         penaltyAmount,
          balance_before_penalty: balanceBefore,
          total_with_penalty:     totalWithPenalty,
          penalty_applied_at:     new Date().toISOString(),
        };
      }

      await Loan.findByIdAndUpdate(loan._id, updateData);
      graced++;
      console.log(
        `[AuctionService] Loan ${loan.loan_no} → in_grace | ` +
        `penalty applied: ${!penaltyAlreadyApplied} | grace ends: ${graceEndsAt.toDateString()}`
      );

      // Notify customer (non-fatal)
      if (!penaltyAlreadyApplied) {
        const customer = await User.findById(loan.customer_user).lean();
        if (customer) {
          sendGracePeriodNotification(loan, customer, penaltyAmount, graceDays, penaltyPercent)
            .catch((err) => console.error("Grace period notification error:", err.message));
        }
      }
    } catch (err) {
      console.error(`[AuctionService] Failed to set loan ${loan.loan_no} to in_grace:`, err.message);
    }
  }

  // ── Phase 2: grace period expired → auction ────────────────────────
  // Covers both in_grace loans and any active/overdue loans that skipped phase 1
  const auctionCandidates = await Loan.find({
    status: { $in: ["active", "overdue", "in_grace"] },
    due_date: { $lte: now },
  }).populate("asset").lean();

  for (const loan of auctionCandidates) {
    const graceDays   = loan.grace_days ?? 7;
    const graceEndsAt = new Date(loan.due_date);
    graceEndsAt.setDate(graceEndsAt.getDate() + graceDays);

    // graceEndsAt = July 22 = last day customer can still pay.
    // Auction fires the NEXT day (July 23), so skip if now <= graceEndsAt.
    if (now <= graceEndsAt) continue;

    if (!loan.asset || ["auction", "sold"].includes(loan.asset.status)) continue;

    const existingAuction = await Auction.findOne({
      asset: loan.asset._id,
      status: { $in: ["draft", "live"] },
    }).lean();
    if (existingAuction) continue;

    try {
      await moveLoanToAuction(loan);
      moved++;
    } catch (err) {
      console.error(`[AuctionService] Failed to move loan ${loan.loan_no} to auction:`, err.message);
    }
  }

  console.log(
    `[AuctionService] processExpiredLoans complete – ` +
    `${graced} loan(s) entered grace period, ${moved} loan(s) moved to auction.`
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
