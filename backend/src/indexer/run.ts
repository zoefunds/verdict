import "dotenv/config";
import { syncAllCases } from "./poll.js";

// AUDIT FIX (2026-08-25): was 15_000 — at that interval, this loop alone
// makes 86400/15 = 5,760 get_case_count calls/day (before even counting
// one get_case call per open case), which EXCEEDS StudioNet's real
// 5,000-requests/day quota on its own, with zero user traffic. Confirmed
// live: the indexer was silently failing almost every cycle with "Rate
// limit exceeded: 5000 requests per day", so on-chain status changes
// never reached the DB/frontend. The existing Redis rate limiter
// (lib/rate-limiter.ts) only coordinated the 30/min short-term cap; nothing
// governed the daily quota. Bumped to 60s AND added a daily budget
// tracker (see rate-limiter.ts) as the second half of this fix.
const POLL_INTERVAL_MS = 60_000;

// AUDIT FIX (2026-08-25): observed live — once StudioNet started rejecting
// every call with its daily rate limit, this loop kept retrying at the
// same fixed 60s interval indefinitely, cycle after cycle, with no signal
// that anything was different from a normal transient blip. If rejected
// calls still count against the daily counter, that blind retrying can
// perpetuate its own exhaustion. Back off exponentially on consecutive
// failures (capped at 30 minutes) so a sustained outage — quota exhaustion
// or otherwise — gives the upstream room to recover instead of being
// hammered at the same rate the whole time; reset to the normal interval
// the moment a cycle succeeds again.
const MAX_BACKOFF_MS = 30 * 60_000;

async function loop() {
  let consecutiveFailures = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Date.now();
    let succeeded = false;
    try {
      succeeded = await syncAllCases();
    } catch (err) {
      console.error("[indexer] sync cycle failed", err);
    }

    if (succeeded) {
      if (consecutiveFailures > 0) {
        console.log(`[indexer] recovered after ${consecutiveFailures} consecutive failed cycle(s)`);
      }
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
    }

    const backoffMs = consecutiveFailures > 0 ? Math.min(POLL_INTERVAL_MS * 2 ** (consecutiveFailures - 1), MAX_BACKOFF_MS) : POLL_INTERVAL_MS;
    if (consecutiveFailures > 0) {
      console.warn(`[indexer] backing off ${Math.round(backoffMs / 1000)}s after ${consecutiveFailures} consecutive failed cycle(s)`);
    }
    const elapsed = Date.now() - start;
    const wait = Math.max(0, backoffMs - elapsed);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

console.log("[indexer] starting VERDICT contract -> Postgres sync loop");
loop();
