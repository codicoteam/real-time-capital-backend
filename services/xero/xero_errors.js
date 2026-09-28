"use strict";

// A sync failure that retrying can never fix — the record the sync needs no longer exists
// (e.g. a deposit whose investor was deleted). withSyncLog dead-letters these instead of
// scheduling another attempt: without that, the retry poller re-ran the same doomed sync
// every 5 minutes forever and generated tens of thousands of identical failed log rows.
class XeroPermanentSyncError extends Error {
  constructor(message) {
    super(message);
    this.name = "XeroPermanentSyncError";
    this.permanent = true;
  }
}

// Beyond this many attempts a row is left failed for a human instead of retried forever.
const MAX_AUTO_ATTEMPTS = 8;

// Exponential backoff: 10, 20, 40, then capped at 60 minutes.
function nextRetryAt(attempts) {
  const minutes = Math.min(60, 5 * Math.pow(2, attempts));
  return new Date(Date.now() + minutes * 60 * 1000);
}

module.exports = { XeroPermanentSyncError, MAX_AUTO_ATTEMPTS, nextRetryAt };
