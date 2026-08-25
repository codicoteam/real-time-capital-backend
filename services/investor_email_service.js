"use strict";

const nodemailer = require("nodemailer");

// ─── Transporter (shared Gmail SMTP) ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(n || 0);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) : "—";

const fmtPct = (n) => `${(n || 0).toFixed(1)}%`;

const adminEmails = () => {
  const env = process.env.INVESTOR_ADMIN_EMAILS || process.env.ADMIN_NOTIFICATION_EMAILS || process.env.EMAIL_USER;
  return env ? env.split(",").map((e) => e.trim()).filter(Boolean) : [];
};

async function send({ to, subject, html }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("[InvestorEmail] EMAIL_USER / EMAIL_PASS not set — skipping email.");
    return;
  }
  try {
    await transporter.sendMail({
      from: `Real Time Capital Investors <${process.env.EMAIL_USER}>`,
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      html,
    });
    console.log(`[InvestorEmail] Sent "${subject}" → ${Array.isArray(to) ? to.join(", ") : to}`);
  } catch (err) {
    console.error("[InvestorEmail] Failed to send email:", err.message);
  }
}

// ─── Shared HTML layout ───────────────────────────────────────────────────────

function layout(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Real Time Capital — Investor Notification</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

      <!-- ── Header ── -->
      <tr>
        <td style="background:linear-gradient(135deg,#064e3b 0%,#065f46 50%,#047857 100%);padding:36px 40px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background:rgba(255,255,255,0.15);border-radius:12px;padding:10px 14px;vertical-align:middle;">
                      <span style="color:#34d399;font-size:22px;font-weight:900;letter-spacing:-0.5px;">RTC</span>
                    </td>
                    <td style="padding-left:12px;vertical-align:middle;">
                      <p style="margin:0;color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.3px;">Real Time Capital</p>
                      <p style="margin:4px 0 0;color:#6ee7b7;font-size:12px;font-weight:600;letter-spacing:0.5px;">INVESTOR RELATIONS</p>
                    </td>
                  </tr>
                </table>
              </td>
              <td align="right" style="vertical-align:middle;">
                <span style="background:rgba(52,211,153,0.2);border:1px solid rgba(52,211,153,0.4);border-radius:20px;color:#6ee7b7;font-size:11px;font-weight:700;padding:5px 14px;letter-spacing:0.5px;white-space:nowrap;">LOAN ASSIGNMENT</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ── Content ── -->
      <tr><td style="padding:0;">${content}</td></tr>

      <!-- ── Footer ── -->
      <tr>
        <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 40px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
                  <strong style="color:#334155;">Real Time Capital</strong> · Professional Pawn &amp; Microfinance Services<br/>
                  This is an automated notification. Please do not reply to this email.<br/>
                  Questions? Contact us at <a href="mailto:${process.env.EMAIL_USER || "info@rtcapital.co.zw"}" style="color:#10b981;">${process.env.EMAIL_USER || "info@rtcapital.co.zw"}</a>
                </p>
              </td>
              <td align="right" style="vertical-align:top;">
                <p style="margin:0;color:#94a3b8;font-size:11px;">© ${new Date().getFullYear()} Real Time Capital</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Shared financial scenario cards ─────────────────────────────────────────

function scenarioCards({ principal, investorProfit, investorSharePct, penaltyPct, evaluatedValue, totalLoanProfit }) {
  // Scenario 1: Normal completion
  const normalTotal = principal + investorProfit;

  // Scenario 2: Penalty (if borrower falls into grace/overdue) — 10% of the whole
  // amount owed (principal + interest/storage, i.e. totalLoanProfit), not principal alone.
  const penaltyAmount = (principal + (totalLoanProfit || 0)) * ((penaltyPct || 10) / 100);
  const penaltyInvestorExtra = parseFloat((penaltyAmount * (investorSharePct / 100)).toFixed(2));
  const penaltyTotal = normalTotal + penaltyInvestorExtra;

  // Scenario 3: Auction (collateral sold)
  const assetCoverage = evaluatedValue || 0;
  // If asset value >= total repayable: investor fully covered
  // If asset value >= principal but < total: partial profit
  // If asset value < principal: some loss
  const auctionRecovery = Math.min(assetCoverage, principal + investorProfit);
  const auctionCoveragePct = principal > 0 ? Math.min((assetCoverage / (principal + investorProfit)) * 100, 100) : 0;
  const fullyCovered = assetCoverage >= (principal + investorProfit);

  return `
  <!-- ── Scenario Cards ── -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
    <tr>
      <td style="padding:0 0 10px;color:#1e293b;font-size:15px;font-weight:700;letter-spacing:-0.2px;">Return Scenarios</td>
    </tr>
    <tr>
      <td>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>

            <!-- Card 1: Completion -->
            <td width="33%" style="padding-right:8px;vertical-align:top;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;overflow:hidden;">
                <tr><td style="background:#16a34a;padding:10px 14px;">
                  <p style="margin:0;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.5px;">✓ FULL REPAYMENT</p>
                </td></tr>
                <tr><td style="padding:14px;">
                  <p style="margin:0 0 4px;color:#15803d;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Best Case</p>
                  <p style="margin:0 0 10px;color:#166534;font-size:11px;line-height:1.4;">Borrower repays in full by due date.</p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #bbf7d0;padding-top:10px;">
                    <tr><td style="color:#374151;font-size:11px;padding:3px 0;">Principal back</td><td align="right" style="color:#166534;font-size:11px;font-weight:700;">${fmt(principal)}</td></tr>
                    <tr><td style="color:#374151;font-size:11px;padding:3px 0;">Your profit (${fmtPct(investorSharePct)} share)</td><td align="right" style="color:#16a34a;font-size:11px;font-weight:700;">+${fmt(investorProfit)}</td></tr>
                    <tr style="border-top:1px solid #bbf7d0;">
                      <td style="color:#166534;font-size:12px;font-weight:800;padding-top:8px;">Total received</td>
                      <td align="right" style="color:#15803d;font-size:14px;font-weight:900;padding-top:8px;">${fmt(normalTotal)}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>
            </td>

            <!-- Card 2: Penalty -->
            <td width="33%" style="padding:0 4px;vertical-align:top;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:12px;overflow:hidden;">
                <tr><td style="background:#d97706;padding:10px 14px;">
                  <p style="margin:0;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.5px;">⚠ GRACE / PENALTY</p>
                </td></tr>
                <tr><td style="padding:14px;">
                  <p style="margin:0 0 4px;color:#92400e;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Delayed Repayment</p>
                  <p style="margin:0 0 10px;color:#78350f;font-size:11px;line-height:1.4;">Borrower pays within grace period. Penalty added.</p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #fde68a;padding-top:10px;">
                    <tr><td style="color:#374151;font-size:11px;padding:3px 0;">Normal return</td><td align="right" style="color:#92400e;font-size:11px;font-weight:700;">${fmt(normalTotal)}</td></tr>
                    <tr><td style="color:#374151;font-size:11px;padding:3px 0;">Penalty share (${fmtPct(penaltyPct || 10)} × ${fmtPct(investorSharePct)})</td><td align="right" style="color:#d97706;font-size:11px;font-weight:700;">+${fmt(penaltyInvestorExtra)}</td></tr>
                    <tr style="border-top:1px solid #fde68a;">
                      <td style="color:#92400e;font-size:12px;font-weight:800;padding-top:8px;">Total received</td>
                      <td align="right" style="color:#d97706;font-size:14px;font-weight:900;padding-top:8px;">${fmt(penaltyTotal)}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>
            </td>

            <!-- Card 3: Auction -->
            <td width="33%" style="padding-left:8px;vertical-align:top;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:${fullyCovered ? "#f0fdf4" : "#fff7ed"};border:1.5px solid ${fullyCovered ? "#86efac" : "#fed7aa"};border-radius:12px;overflow:hidden;">
                <tr><td style="background:${fullyCovered ? "#0d9488" : "#ea580c"};padding:10px 14px;">
                  <p style="margin:0;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.5px;">🔨 AUCTION / DEFAULT</p>
                </td></tr>
                <tr><td style="padding:14px;">
                  <p style="margin:0 0 4px;color:${fullyCovered ? "#0f766e" : "#9a3412"};font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">${fullyCovered ? "Asset Fully Covers Loan" : "Partial Recovery"}</p>
                  <p style="margin:0 0 10px;color:${fullyCovered ? "#134e4a" : "#7c2d12"};font-size:11px;line-height:1.4;">Asset auctioned. Recovery based on sale price.</p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${fullyCovered ? "#bbf7d0" : "#fed7aa"};padding-top:10px;">
                    <tr><td style="color:#374151;font-size:11px;padding:3px 0;">Asset value</td><td align="right" style="font-size:11px;font-weight:700;color:#374151;">${fmt(evaluatedValue)}</td></tr>
                    <tr><td style="color:#374151;font-size:11px;padding:3px 0;">Asset coverage</td><td align="right" style="font-size:11px;font-weight:700;color:${fullyCovered ? "#16a34a" : "#ea580c"};">${auctionCoveragePct.toFixed(0)}%</td></tr>
                    <tr style="border-top:1px solid ${fullyCovered ? "#bbf7d0" : "#fed7aa"};">
                      <td style="font-size:12px;font-weight:800;padding-top:8px;color:${fullyCovered ? "#0f766e" : "#9a3412"};">Est. recovery</td>
                      <td align="right" style="font-size:14px;font-weight:900;padding-top:8px;color:${fullyCovered ? "#0d9488" : "#ea580c"};">${fmt(auctionRecovery)}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>
            </td>

          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

// ─── Collateral image grid ────────────────────────────────────────────────────

function imageGrid(images = [], assetTitle = "") {
  if (!images || images.length === 0) return "";
  const shown = images.slice(0, 4);
  const cols = Math.min(shown.length, 2);
  const cellWidth = cols === 1 ? "100%" : "50%";

  const cells = shown
    .map(
      (url) => `<td width="${cellWidth}" style="padding:4px;vertical-align:top;">
        <img src="${url}" alt="${assetTitle}" width="100%" style="border-radius:10px;display:block;max-height:180px;object-fit:cover;border:1px solid #e2e8f0;" />
      </td>`,
    )
    .join("");

  const rows = [];
  for (let i = 0; i < shown.length; i += 2) {
    rows.push(`<tr>${cells.slice(i * cellWidth.length, (i + 2) * cellWidth.length)}</tr>`);
  }

  // Simpler: just do pairs
  const imgPairs = [];
  for (let i = 0; i < shown.length; i += 2) {
    const pair = shown.slice(i, i + 2);
    imgPairs.push(`<tr>${pair
      .map(
        (url) => `<td width="${100 / pair.length}%" style="padding:4px;vertical-align:top;">
          <img src="${url}" alt="${assetTitle}" width="100%" style="border-radius:10px;display:block;max-height:180px;object-fit:cover;border:1px solid #e2e8f0;" />
        </td>`,
      )
      .join("")}</tr>`);
  }

  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
    <tr><td style="padding:0 0 10px;color:#1e293b;font-size:15px;font-weight:700;">Collateral Photos</td></tr>
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${imgPairs.join("")}
      </table>
    </td></tr>
    ${images.length > 4 ? `<tr><td style="padding:8px 0 0;color:#64748b;font-size:12px;">+ ${images.length - 4} more photo(s) on file</td></tr>` : ""}
  </table>`;
}

// ─── Loan detail table ────────────────────────────────────────────────────────

function loanDetailTable({ loanRef, borrowerName, category, term, principal, interest, storage, totalRepayable, startDate, dueDate }) {
  const CATEGORY_LABELS = { small_loans: "Small Loans", motor_vehicle: "Motor Vehicle", jewellery: "Jewellery" };
  const TERM_LABELS = { two_week: "2-Week (14-day)", one_month: "Monthly (30-day)", two_weeks: "2-Week (14-day)" };

  const row = (label, value, highlight = false) =>
    `<tr>
      <td style="padding:9px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">${label}</td>
      <td align="right" style="padding:9px 0;font-size:13px;font-weight:${highlight ? "800" : "600"};color:${highlight ? "#0f172a" : "#334155"};border-bottom:1px solid #f1f5f9;">${value}</td>
    </tr>`;

  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:0;margin:20px 0 0;overflow:hidden;">
    <tr><td style="background:#1e293b;padding:12px 18px;">
      <p style="margin:0;color:#f8fafc;font-size:13px;font-weight:700;letter-spacing:0.2px;">Loan Details</p>
    </td></tr>
    <tr><td style="padding:4px 18px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${row("Loan Reference", `<span style="font-family:monospace;">${loanRef}</span>`)}
        ${row("Borrower", borrowerName)}
        ${row("Collateral Category", CATEGORY_LABELS[category] || category)}
        ${row("Loan Term", TERM_LABELS[term] || term)}
        ${row("Principal Amount", fmt(principal))}
        ${row("Interest Charged", fmt(interest))}
        ${row("Storage / Handling", fmt(storage))}
        ${row("Total Repayable", fmt(totalRepayable), true)}
        ${row("Start Date", fmtDate(startDate))}
        ${row("Due Date", `<strong style="color:#0f172a;">${fmtDate(dueDate)}</strong>`)}
      </table>
    </td></tr>
  </table>`;
}

// ─── Investor email ───────────────────────────────────────────────────────────

async function sendLoanAssignmentToInvestor({ investor, loan, allocation, asset, borrower }) {
  const assetImages = asset?.asset_images || [];
  const evaluatedValue = asset?.evaluated_value || 0;
  const assetTitle = asset?.title || "Collateral Asset";
  const borrowerName = borrower
    ? `${borrower.first_name || ""} ${borrower.last_name || ""}`.trim() || "Borrower"
    : "Borrower";

  const content = `
  <table width="100%" cellpadding="0" cellspacing="0">
    <!-- Greeting strip -->
    <tr>
      <td style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border-bottom:1px solid #a7f3d0;padding:24px 40px;">
        <p style="margin:0;color:#065f46;font-size:22px;font-weight:800;">Hello, ${investor.name} 👋</p>
        <p style="margin:8px 0 0;color:#059669;font-size:14px;">Great news — the allocation algorithm has assigned you a new loan.</p>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding:28px 40px 36px;">

        <!-- Intro -->
        <p style="margin:0 0 20px;color:#334155;font-size:14px;line-height:1.7;">
          Your capital has been deployed into the following loan. Your profit share is calculated on the interest and charges collected from the borrower. Below you'll find the full loan breakdown, collateral photos, and projected return scenarios.
        </p>

        <!-- Profit highlight box -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#064e3b,#065f46);border-radius:14px;margin-bottom:4px;">
          <tr>
            <td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;color:#6ee7b7;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Your Expected Return</p>
                    <p style="margin:6px 0 0;color:#ffffff;font-size:30px;font-weight:900;">+${fmt(allocation.investor_profit)}</p>
                    <p style="margin:4px 0 0;color:#a7f3d0;font-size:12px;">${fmtPct(allocation.investor_share_pct)} profit share on ${fmt(allocation.total_loan_profit)} total interest</p>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <table cellpadding="0" cellspacing="0">
                      <tr><td style="text-align:right;">
                        <p style="margin:0;color:#6ee7b7;font-size:11px;font-weight:600;">Principal deployed</p>
                        <p style="margin:4px 0 0;color:#ffffff;font-size:18px;font-weight:800;">${fmt(allocation.principal_amount)}</p>
                      </td></tr>
                      <tr><td style="text-align:right;padding-top:10px;">
                        <p style="margin:0;color:#6ee7b7;font-size:11px;font-weight:600;">RTC platform fee</p>
                        <p style="margin:4px 0 0;color:#a7f3d0;font-size:13px;font-weight:700;">${fmt(allocation.rtc_revenue)}</p>
                      </td></tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        ${loanDetailTable({
          loanRef: loan.loan_no,
          borrowerName,
          category: loan.collateral_category,
          term: loan.loan_period_type,
          principal: loan.principal_amount,
          interest: loan.interest_amount,
          storage: loan.storage_charge_amount,
          totalRepayable: loan.expected_total_repayable,
          startDate: loan.start_date,
          dueDate: loan.due_date,
        })}

        ${imageGrid(assetImages, assetTitle)}

        ${scenarioCards({
          principal: allocation.principal_amount,
          investorProfit: allocation.investor_profit,
          investorSharePct: allocation.investor_share_pct,
          penaltyPct: loan.penalty_percent || 10,
          evaluatedValue,
          totalLoanProfit: allocation.total_loan_profit,
        })}

        <!-- Note -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 18px;">
          <tr>
            <td style="color:#1e40af;font-size:12px;line-height:1.7;">
              <strong>ℹ Note:</strong> Your profit is automatically calculated and recorded when the loan status changes. Log in to your investor portal to track real-time status updates and receive notifications at each stage of this loan.
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>`;

  const subject = `📋 New Loan Assigned — ${loan.loan_no} | ${fmt(allocation.investor_profit)} expected profit`;

  await send({ to: investor.email, subject, html: layout(content) });
}

// ─── Super-admin notification email ──────────────────────────────────────────

async function sendAdminLoanAssignmentNotification({ investor, loan, allocation, asset, borrower }) {
  const assetImages = asset?.asset_images || [];
  const evaluatedValue = asset?.evaluated_value || 0;
  const assetTitle = asset?.title || "Collateral Asset";
  const borrowerName = borrower
    ? `${borrower.first_name || ""} ${borrower.last_name || ""}`.trim() || "Borrower"
    : "Borrower";

  const recipients = adminEmails();
  if (recipients.length === 0) {
    console.warn("[InvestorEmail] No admin email recipients configured (INVESTOR_ADMIN_EMAILS / ADMIN_NOTIFICATION_EMAILS).");
    return;
  }

  const content = `
  <table width="100%" cellpadding="0" cellspacing="0">
    <!-- Alert strip -->
    <tr>
      <td style="background:linear-gradient(135deg,#1e1b4b,#312e81);border-bottom:1px solid #4338ca;padding:24px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0;color:#c7d2fe;font-size:12px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;">SWRR Algorithm — Loan Assignment</p>
              <p style="margin:8px 0 0;color:#ffffff;font-size:20px;font-weight:800;">Loan ${loan.loan_no} has been assigned</p>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="background:rgba(99,102,241,0.3);border:1px solid rgba(129,140,248,0.5);border-radius:20px;color:#a5b4fc;font-size:11px;font-weight:700;padding:5px 14px;">AUTO-ASSIGNED</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding:28px 40px 36px;">

        <p style="margin:0 0 20px;color:#334155;font-size:14px;line-height:1.7;">
          The Smooth Weighted Round-Robin algorithm has automatically assigned the following loan to an investor. Please review the assignment details below.
        </p>

        <!-- Assignment summary box -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;margin-bottom:20px;overflow:hidden;">
          <tr><td style="background:#0f172a;padding:10px 18px;">
            <p style="margin:0;color:#f8fafc;font-size:12px;font-weight:700;letter-spacing:0.3px;">ASSIGNMENT SUMMARY</p>
          </td></tr>
          <tr><td style="padding:0 18px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="50%" style="padding:14px 8px 14px 0;border-right:1px solid #e2e8f0;vertical-align:top;">
                  <p style="margin:0;color:#64748b;font-size:11px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;">Investor Assigned</p>
                  <p style="margin:6px 0 2px;color:#0f172a;font-size:16px;font-weight:800;">${investor.name}</p>
                  <p style="margin:0;color:#64748b;font-size:12px;">${investor.email}</p>
                  <p style="margin:4px 0 0;color:#64748b;font-size:12px;">Committed Capital: <strong style="color:#0f172a;">${fmt(investor.committed_capital)}</strong></p>
                </td>
                <td width="50%" style="padding:14px 0 14px 18px;vertical-align:top;">
                  <p style="margin:0;color:#64748b;font-size:11px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;">Investor's Return</p>
                  <p style="margin:6px 0 2px;color:#16a34a;font-size:24px;font-weight:900;">+${fmt(allocation.investor_profit)}</p>
                  <p style="margin:0;color:#64748b;font-size:12px;">${fmtPct(allocation.investor_share_pct)} share · Principal: ${fmt(allocation.principal_amount)}</p>
                  <p style="margin:4px 0 0;color:#64748b;font-size:12px;">RTC Revenue: <strong style="color:#0f172a;">${fmt(allocation.rtc_revenue)}</strong></p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>

        ${loanDetailTable({
          loanRef: loan.loan_no,
          borrowerName,
          category: loan.collateral_category,
          term: loan.loan_period_type,
          principal: loan.principal_amount,
          interest: loan.interest_amount,
          storage: loan.storage_charge_amount,
          totalRepayable: loan.expected_total_repayable,
          startDate: loan.start_date,
          dueDate: loan.due_date,
        })}

        ${imageGrid(assetImages, assetTitle)}

        ${scenarioCards({
          principal: allocation.principal_amount,
          investorProfit: allocation.investor_profit,
          investorSharePct: allocation.investor_share_pct,
          penaltyPct: loan.penalty_percent || 10,
          evaluatedValue,
          totalLoanProfit: allocation.total_loan_profit,
        })}

        <!-- Admin CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px 18px;">
          <tr>
            <td style="color:#0c4a6e;font-size:12px;line-height:1.7;">
              <strong>👤 Action:</strong> You can view this investor's full portfolio and transaction history in the Investor Module. If you need to override this assignment or adjust the investor's profit share, please do so in the admin panel.
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>`;

  const subject = `[RTC Admin] Loan ${loan.loan_no} assigned to ${investor.name} — ${fmt(allocation.investor_profit)} projected profit`;

  await send({ to: recipients, subject, html: layout(content) });
}

// ─── Transaction confirmation email ──────────────────────────────────────────

async function sendTransactionEmail({ investor, transaction }) {
  // Skip RTC internal account and investors without a real email
  if (!investor.email || investor.kind === "rtc") return;

  const TYPE_META = {
    deposit: {
      label: "Capital Deposit",
      verb: "deposited",
      sign: "+",
      headerBg: "linear-gradient(135deg,#065f46,#059669)",
      accentColor: "#059669",
      accentLight: "#d1fae5",
      accentBorder: "#6ee7b7",
      badgeBg: "#ecfdf5",
      badgeText: "#065f46",
      icon: "&#8595;",
    },
    profit_withdrawal: {
      label: "Profit Payout",
      verb: "withdrawn as profit",
      sign: "",
      headerBg: "linear-gradient(135deg,#0c4a6e,#0284c7)",
      accentColor: "#0284c7",
      accentLight: "#e0f2fe",
      accentBorder: "#7dd3fc",
      badgeBg: "#f0f9ff",
      badgeText: "#0c4a6e",
      icon: "&#36;",
    },
    capital_withdrawal: {
      label: "Capital Withdrawal",
      verb: "withdrawn from capital",
      sign: "−",
      headerBg: "linear-gradient(135deg,#78350f,#d97706)",
      accentColor: "#d97706",
      accentLight: "#fef3c7",
      accentBorder: "#fcd34d",
      badgeBg: "#fffbeb",
      badgeText: "#78350f",
      icon: "&#8593;",
    },
  };

  const meta = TYPE_META[transaction.type] || TYPE_META.deposit;
  const firstName = investor.name ? investor.name.split(" ")[0] : "Investor";
  const capitalChanged = transaction.committed_capital_after !== transaction.committed_capital_before;
  const now = new Date(transaction.created_at || Date.now());

  const content = `
  <table width="100%" cellpadding="0" cellspacing="0">

    <!-- Header -->
    <tr>
      <td style="background:${meta.headerBg};padding:32px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0;color:rgba(255,255,255,0.75);font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Transaction Confirmed</p>
              <p style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:800;">${meta.label}</p>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">${fmtDate(now)} &nbsp;·&nbsp; ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</p>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);border-radius:50%;width:52px;height:52px;line-height:52px;text-align:center;font-size:22px;font-weight:900;color:#ffffff;">${meta.icon}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding:28px 40px 36px;">

        <p style="margin:0 0 22px;color:#334155;font-size:14px;line-height:1.8;">
          Hi <strong>${firstName}</strong>, this is a confirmation that the following transaction has been recorded on your Real Time Capital investor account.
        </p>

        <!-- Amount highlight -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${meta.accentLight};border:1.5px solid ${meta.accentBorder};border-radius:14px;margin-bottom:20px;">
          <tr>
            <td style="padding:20px 24px;" align="center">
              <p style="margin:0;color:${meta.accentColor};font-size:13px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">${meta.label}</p>
              <p style="margin:8px 0 0;color:${meta.accentColor};font-size:36px;font-weight:900;letter-spacing:-0.5px;">${meta.sign}${fmt(transaction.amount)}</p>
              ${transaction.notes ? `<p style="margin:10px 0 0;color:#475569;font-size:12px;font-style:italic;">&ldquo;${transaction.notes}&rdquo;</p>` : ""}
            </td>
          </tr>
        </table>

        <!-- Account snapshot -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;margin-bottom:20px;overflow:hidden;">
          <tr><td style="background:#0f172a;padding:10px 18px;">
            <p style="margin:0;color:#f8fafc;font-size:12px;font-weight:700;letter-spacing:0.3px;">ACCOUNT SNAPSHOT</p>
          </td></tr>
          <tr><td style="padding:6px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${capitalChanged ? `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:11px 18px;color:#64748b;font-size:13px;">Committed capital before</td>
                <td style="padding:11px 18px;text-align:right;color:#0f172a;font-size:13px;font-weight:700;">${fmt(transaction.committed_capital_before)}</td>
              </tr>
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:11px 18px;color:#64748b;font-size:13px;">Committed capital after</td>
                <td style="padding:11px 18px;text-align:right;font-size:13px;font-weight:700;color:${meta.accentColor};">${fmt(transaction.committed_capital_after)}</td>
              </tr>
              ` : `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:11px 18px;color:#64748b;font-size:13px;">Committed capital</td>
                <td style="padding:11px 18px;text-align:right;color:#0f172a;font-size:13px;font-weight:700;">${fmt(transaction.committed_capital_after)}</td>
              </tr>
              `}
              <tr>
                <td style="padding:11px 18px;color:#64748b;font-size:13px;">Transaction type</td>
                <td style="padding:11px 18px;text-align:right;">
                  <span style="background:${meta.badgeBg};color:${meta.badgeText};border-radius:20px;font-size:11px;font-weight:700;padding:3px 10px;">${meta.label.toUpperCase()}</span>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>

        ${transaction.type === "profit_withdrawal" ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;margin-bottom:20px;padding:14px 18px;">
          <tr><td style="color:#1e40af;font-size:12px;line-height:1.7;">
            <strong>&#9432; Note:</strong> Profit payouts do not affect your committed capital. Your capital remains fully deployed in active loans.
          </td></tr>
        </table>` : ""}

        ${transaction.type === "capital_withdrawal" ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;margin-bottom:20px;padding:14px 18px;">
          <tr><td style="color:#92400e;font-size:12px;line-height:1.7;">
            <strong>&#9432; Note:</strong> This withdrawal has been deducted from your committed capital. Only idle capital (not deployed in active loans) can be withdrawn.
          </td></tr>
        </table>` : ""}

        <p style="margin:0;color:#64748b;font-size:12px;line-height:1.7;">
          You can view your full transaction history by logging in to your <a href="#" style="color:${meta.accentColor};font-weight:600;text-decoration:none;">investor portal</a>. If you did not expect this transaction or have any questions, please contact your account manager.
        </p>

      </td>
    </tr>
  </table>`;

  const subjectMap = {
    deposit: `Deposit confirmed — ${fmt(transaction.amount)} added to your account`,
    profit_withdrawal: `Profit payout of ${fmt(transaction.amount)} processed`,
    capital_withdrawal: `Capital withdrawal of ${fmt(transaction.amount)} recorded`,
  };

  await send({
    to: investor.email,
    subject: subjectMap[transaction.type] || `Transaction recorded — ${fmt(transaction.amount)}`,
    html: layout(content),
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send both investor and admin emails for a new loan assignment.
 * Fully non-blocking — errors are caught and logged, never thrown.
 */
async function sendLoanAssignmentEmails({ investor, loan, allocation, asset, borrower }) {
  await Promise.allSettled([
    sendLoanAssignmentToInvestor({ investor, loan, allocation, asset, borrower }),
    sendAdminLoanAssignmentNotification({ investor, loan, allocation, asset, borrower }),
  ]);
}

/**
 * Send a transaction confirmation email to the investor.
 * Fully non-blocking — call with .catch() or fire-and-forget.
 */
async function sendTransactionConfirmationEmail({ investor, transaction }) {
  await sendTransactionEmail({ investor, transaction });
}

module.exports = { sendLoanAssignmentEmails, sendTransactionConfirmationEmail };
