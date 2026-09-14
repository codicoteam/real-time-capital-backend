"use strict";

// Sends the admin activity digest every day at 18:00 Central Africa Time (UTC+2,
// no DST — Africa/Harare never changes offset). Follows the same setTimeout/
// setInterval scheduling style already used in services/assets_auction_service.js
// (no cron package in this codebase), but computes the first run against an actual
// wall-clock target instead of an arbitrary boot-time offset, since "6pm CAT" is a
// fixed time of day rather than a fixed interval.

const dailyDigestService = require("./daily_digest_service");
const { sendDailyDigestEmail } = require("../utils/emails_util");

const CAT_OFFSET_MS = 2 * 60 * 60 * 1000;
const TARGET_CAT_HOUR = 18; // 6pm
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Milliseconds from now until the next 18:00 CAT (today's, if still ahead;
 * otherwise tomorrow's).
 */
function msUntilNextSixPmCat(now = new Date()) {
  const catNow = new Date(now.getTime() + CAT_OFFSET_MS);
  const y = catNow.getUTCFullYear();
  const m = catNow.getUTCMonth();
  const d = catNow.getUTCDate();

  let targetCatUtc = new Date(Date.UTC(y, m, d, TARGET_CAT_HOUR, 0, 0, 0) - CAT_OFFSET_MS);
  if (targetCatUtc.getTime() <= now.getTime()) {
    targetCatUtc = new Date(targetCatUtc.getTime() + ONE_DAY_MS);
  }
  return targetCatUtc.getTime() - now.getTime();
}

async function runDailyDigest() {
  try {
    console.log("[DailyDigest] Generating and sending daily activity digest...");
    const digest = await dailyDigestService.getDigestData(new Date());
    const result = await sendDailyDigestEmail(digest);
    console.log(`[DailyDigest] Sent to: ${(result.sent_to || []).join(", ")}`);
    return { digest, ...result };
  } catch (error) {
    console.error("[DailyDigest] Failed to send daily digest:", error.message);
    throw error;
  }
}

function startDailyDigestScheduler() {
  const delay = msUntilNextSixPmCat();
  const hours = (delay / 3600000).toFixed(1);
  console.log(`[DailyDigest] Scheduler started — next run in ${hours}h (18:00 CAT).`);

  setTimeout(() => {
    runDailyDigest().catch(() => {});
    setInterval(() => runDailyDigest().catch(() => {}), ONE_DAY_MS);
  }, delay);
}

module.exports = { startDailyDigestScheduler, runDailyDigest, msUntilNextSixPmCat };
