/**
 * Shared Redis-backed rate limiter for GenLayer RPC calls.
 *
 * GenLayer StudioNet enforces a 30 requests/minute cap. This backend runs
 * as (at least) two processes on Fly.io — the HTTP API and the indexer
 * poll loop — plus every deployed frontend reads through the proxy route
 * in routes/genlayer.ts. Without a SHARED limiter, each process would
 * track its own local counter and collectively blow past 30/min. Redis
 * (Upstash) gives one source of truth for the bucket across all of them.
 *
 * Implementation: fixed 60-second window counter via INCR + EXPIRE. Simpler
 * than a sliding-window/token-bucket and sufficiently accurate at this
 * volume — a fixed window can allow a short burst across the window
 * boundary, so the cap is set conservatively below the true limit (25, not
 * 30) to leave headroom.
 */

import { Redis } from "ioredis";
import { env } from "./env.js";

const GENLAYER_RATE_LIMIT_PER_MINUTE = 25; // conservative margin under GenLayer's 30/min cap
const WINDOW_SECONDS = 60;
const RATE_LIMIT_KEY = "verdict:genlayer:rpc:window";

// AUDIT FIX (2026-08-25): StudioNet also enforces a separate 5,000
// requests/DAY quota, independent of the 30/min cap above — confirmed via
// a real "Rate limit exceeded: 5000 requests per day" error from a live
// deployment. Nothing here previously tracked daily usage at all, so the
// per-minute limiter could (and did) let the indexer sustain a rate that
// exhausts the daily quota in a few hours even while staying well under
// 25/min. This is a second, independent budget — both must pass.
const GENLAYER_DAILY_LIMIT = 4500; // conservative margin under StudioNet's 5,000/day cap
const DAY_SECONDS = 24 * 60 * 60;
const DAILY_LIMIT_KEY = "verdict:genlayer:rpc:day";

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (!env.REDIS_URL) {
    return null;
  }
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      // Upstash requires TLS (rediss://) and tolerates brief reconnects;
      // don't let a Redis hiccup crash the whole process.
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    redisClient.on("error", (err: Error) => {
      console.error("[rate-limiter] redis connection error", err.message);
    });
  }
  return redisClient;
}

/**
 * Resolves once it is safe to make a GenLayer RPC call, blocking (with a
 * short poll/backoff) if the shared window is already at capacity.
 * Fails OPEN (allows the call) if Redis is unavailable/unconfigured —
 * GenLayer's own rate limiting is the ultimate backstop; this is a
 * best-effort coordination layer, not a hard guarantee, and we'd rather
 * risk an occasional 429 from GenLayer than take the whole app down
 * because Upstash had a blip.
 */
export async function acquireGenlayerRpcSlot(): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return; // no Redis configured — proceed without coordination
  }

  // Daily budget is checked ONCE, before the per-minute retry loop below —
  // it must only be incremented once per logical call, not once per retry
  // iteration (a call that backs off 5 times for the per-minute window
  // would otherwise burn 5 daily-budget slots for one actual RPC call).
  // If the day's quota is gone, no amount of waiting seconds fixes that,
  // so this fails fast with a distinct, actionable error rather than
  // spinning for 20s only to still fail.
  let dailyCount: number;
  try {
    dailyCount = await redis.incr(DAILY_LIMIT_KEY);
    if (dailyCount === 1) {
      await redis.expire(DAILY_LIMIT_KEY, DAY_SECONDS);
    }
  } catch (err) {
    console.error("[rate-limiter] redis error on daily counter, failing open", err);
    dailyCount = 0;
  }
  if (dailyCount > GENLAYER_DAILY_LIMIT) {
    throw new Error(
      `GenLayer RPC daily budget exhausted (>${GENLAYER_DAILY_LIMIT}/day) — refusing this call rather than risk StudioNet's hard 5,000/day cutoff`,
    );
  }

  const MAX_WAIT_MS = 20_000;
  const POLL_INTERVAL_MS = 500;
  const startedAt = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let count: number;
    try {
      count = await redis.incr(RATE_LIMIT_KEY);
      if (count === 1) {
        await redis.expire(RATE_LIMIT_KEY, WINDOW_SECONDS);
      }
    } catch (err) {
      console.error("[rate-limiter] redis error, failing open", err);
      return;
    }

    if (count <= GENLAYER_RATE_LIMIT_PER_MINUTE) {
      return; // slot acquired
    }

    // Over budget for this window — back off and retry, bounded so a caller
    // never hangs forever if the bucket is persistently saturated.
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error(
        `GenLayer RPC rate limit window saturated (>${GENLAYER_RATE_LIMIT_PER_MINUTE}/min) and wait exceeded ${MAX_WAIT_MS}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
