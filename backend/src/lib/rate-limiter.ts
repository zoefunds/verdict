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
