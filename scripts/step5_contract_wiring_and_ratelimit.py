#!/usr/bin/env python3
"""
step5_contract_wiring_and_ratelimit.py

1. Wires the deployed VERDICT contract address + StudioNet RPC config into
   .env.example (placeholders only) and creates/updates local .env files
   (gitignored) with the real address for backend and frontend.
2. Adds a Redis-backed rate limiter (Upstash) shared across the backend API
   process and the indexer process, so GenLayer's 30 requests/minute cap is
   enforced from a single coordinated bucket instead of racing.
3. Adds a backend GenLayer read-proxy route so the frontend reads contract
   state through the backend (sharing the same rate-limited bucket) instead
   of hammering the RPC directly from every browser tab.

Usage:
    cd /Users/macbook/verdict
    python3 scripts/step5_contract_wiring_and_ratelimit.py
"""

from pathlib import Path
import os
import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND = PROJECT_ROOT / "backend"
FRONTEND = PROJECT_ROOT / "frontend"

CONTRACT_ADDRESS = "0x56118ae3ee66b662a9a4CEf3424008c1D1036DbD"
GENLAYER_RPC_URL = "https://studio.genlayer.com/api"
GENLAYER_CHAIN_ID = "61999"

# SECURITY: the Redis connection string is a credential and must never be
# hardcoded in this file (this script is committed to a public GitHub repo).
# Pass it via an environment variable at run time instead:
#   VERDICT_REDIS_URL='rediss://...' python3 scripts/step5_contract_wiring_and_ratelimit.py
REDIS_URL = os.environ.get("VERDICT_REDIS_URL")
if not REDIS_URL:
    print(
        "ERROR: VERDICT_REDIS_URL environment variable is not set.\n"
        "Run this script as:\n"
        "  VERDICT_REDIS_URL='rediss://...' python3 scripts/step5_contract_wiring_and_ratelimit.py\n"
        "(The Redis URL is a credential and is intentionally never hardcoded in this\n"
        "committed script.)",
        file=sys.stderr,
    )
    sys.exit(1)

REDIS_RATE_LIMITER_TS = """\
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

import Redis from "ioredis";
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
    redisClient.on("error", (err) => {
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
"""

ROUTES_GENLAYER_TS = """\
/**
 * GenLayer read-proxy routes.
 *
 * The frontend does NOT call the GenLayer StudioNet RPC directly for reads.
 * Every browser tab doing so independently would make the shared 30/min
 * rate-limit budget impossible to coordinate. Instead, all view-method
 * reads go through here, sharing the same Redis-coordinated bucket as the
 * indexer (see lib/rate-limiter.ts). Writes (stake locking, evidence
 * submission, verdict-triggering calls) still happen directly from the
 * user's own wallet in the browser — those are wallet-signed transactions,
 * not RPC-rate-limited reads, and must remain non-custodial.
 */

import type { FastifyPluginAsync } from "fastify";
import { getCase, getCaseEvents, getEvidence, viewCall, isContractConfigured } from "../lib/genlayer-client.js";

export const genlayerRoutes: FastifyPluginAsync = async (app) => {
  app.get("/genlayer/status", async () => ({
    contractConfigured: isContractConfigured(),
  }));

  app.get("/genlayer/case/:caseId", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    const { caseId } = req.params as { caseId: string };
    try {
      const result = await getCase(Number(caseId));
      return { case: result };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_case failed");
      return reply.code(502).send({ error: "Failed to read case from contract" });
    }
  });

  app.get("/genlayer/case/:caseId/events", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    const { caseId } = req.params as { caseId: string };
    const query = req.query as { limit?: string };
    try {
      const result = await getCaseEvents(Number(caseId), query.limit ? Number(query.limit) : 50);
      return { events: result };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_case_events failed");
      return reply.code(502).send({ error: "Failed to read case events from contract" });
    }
  });

  app.get("/genlayer/evidence/:evidenceId", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    const { evidenceId } = req.params as { evidenceId: string };
    try {
      const result = await getEvidence(Number(evidenceId));
      return { evidence: result };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_evidence failed");
      return reply.code(502).send({ error: "Failed to read evidence from contract" });
    }
  });

  app.get("/genlayer/protocol-config", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    try {
      const result = await viewCall("get_protocol_config");
      return { config: result };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_protocol_config failed");
      return reply.code(502).send({ error: "Failed to read protocol config from contract" });
    }
  });

  app.get("/genlayer/constitution", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    const query = req.query as { version?: string };
    try {
      const result = await viewCall("get_constitution", query.version ? [Number(query.version)] : [0]);
      return { constitution: result };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_constitution failed");
      return reply.code(502).send({ error: "Failed to read constitution from contract" });
    }
  });
};
"""

FRONTEND_GENLAYER_PROXY_NOTE = """\
/**
 * Frontend read access to the VERDICT contract goes through the backend
 * proxy (`${NEXT_PUBLIC_API_BASE_URL}/genlayer/*`), NOT a direct RPC call
 * from the browser. This lets the backend coordinate GenLayer StudioNet's
 * 30 requests/minute rate limit across every open tab and the indexer via
 * one shared Redis counter (backend/src/lib/rate-limiter.ts) — see
 * docs/GENLAYER.md "Rate limiting" section.
 *
 * Direct browser -> contract calls are reserved for WRITE transactions
 * (stake locking, evidence submission, appeal filing, etc.), which are
 * wallet-signed by the user and go through the wallet's own RPC, not this
 * app's coordinated read budget.
 */
export async function fetchCaseFromContract(apiBaseUrl: string, contractCaseId: number) {
  const res = await fetch(`${apiBaseUrl}/genlayer/case/${contractCaseId}`);
  if (!res.ok) {
    throw new Error(`Failed to read case ${contractCaseId} from contract (${res.status})`);
  }
  const body = (await res.json()) as { case: Record<string, unknown> };
  return body.case;
}

export async function fetchProtocolConfig(apiBaseUrl: string) {
  const res = await fetch(`${apiBaseUrl}/genlayer/protocol-config`);
  if (!res.ok) {
    throw new Error(`Failed to read protocol config (${res.status})`);
  }
  const body = (await res.json()) as { config: Record<string, unknown> };
  return body.config;
}
"""


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"WROTE {path.relative_to(PROJECT_ROOT)}")


def write_if_missing(path: Path, content: str) -> None:
    if path.exists() and path.stat().st_size > 0:
        print(f"SKIP  (already exists): {path.relative_to(PROJECT_ROOT)}")
        return
    write_file(path, content)


def update_env_example() -> None:
    path = PROJECT_ROOT / ".env.example"
    text = path.read_text(encoding="utf-8")

    text = text.replace(
        'GENLAYER_RPC_URL=changeme_studionet_rpc_url\nGENLAYER_CHAIN_ID=changeme_studionet_chain_id\nVERDICT_CONTRACT_ADDRESS=changeme_after_deployment',
        f'GENLAYER_RPC_URL={GENLAYER_RPC_URL}\nGENLAYER_CHAIN_ID={GENLAYER_CHAIN_ID}\n'
        f'# Deployed VERDICT contract on StudioNet. Public on-chain address, safe to\n'
        f'# reference in docs/config, but the .env.example placeholder below is left\n'
        f'# generic so a fresh clone doesn\'t silently point at THIS deployment.\n'
        f'VERDICT_CONTRACT_ADDRESS=changeme_after_deployment',
    )

    if "REDIS_URL" not in text:
        text = text.replace(
            "GENLAYER_INDEXER_START_BLOCK=0",
            "GENLAYER_INDEXER_START_BLOCK=0\n\n"
            "# Upstash Redis — coordinates GenLayer's 30 requests/minute StudioNet rate\n"
            "# limit across the backend API process and the indexer process (and every\n"
            "# frontend tab, via the /genlayer/* proxy routes). Optional: if unset, the\n"
            "# rate limiter fails open (no coordination) rather than crashing.\n"
            "REDIS_URL=rediss://changeme_upstash_redis_connection_string",
        )

    if "NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS=changeme_after_deployment" in text:
        text = text.replace(
            "NEXT_PUBLIC_GENLAYER_RPC_URL=changeme_studionet_rpc_url\nNEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS=changeme_after_deployment",
            f"NEXT_PUBLIC_GENLAYER_RPC_URL={GENLAYER_RPC_URL}\n"
            f"NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS=changeme_after_deployment",
        )

    path.write_text(text, encoding="utf-8")
    print(f"UPDATED {path.relative_to(PROJECT_ROOT)}")


def write_local_env(path: Path, extra_lines: list[str]) -> None:
    """Creates a LOCAL, gitignored .env file with real values for dev use."""
    example_path = path.parent / (".env.example" if (path.parent / ".env.example").exists() else "")
    base_content = (PROJECT_ROOT / ".env.example").read_text(encoding="utf-8")
    content = base_content + "\n# ---- Local overrides (this file is gitignored) ----\n" + "\n".join(extra_lines) + "\n"
    path.write_text(content, encoding="utf-8")
    print(f"WROTE (local, gitignored) {path}")


def main() -> None:
    print(f"Step 5: Contract wiring + rate limiting — project root: {PROJECT_ROOT}\n")

    update_env_example()

    # Real local .env files (gitignored) with the actual deployed values.
    write_local_env(
        BACKEND / ".env",
        [
            f"GENLAYER_RPC_URL={GENLAYER_RPC_URL}",
            f"GENLAYER_CHAIN_ID={GENLAYER_CHAIN_ID}",
            f"VERDICT_CONTRACT_ADDRESS={CONTRACT_ADDRESS}",
            f'REDIS_URL="{REDIS_URL}"',
        ],
    )
    write_local_env(
        FRONTEND / ".env.local",
        [
            f"NEXT_PUBLIC_GENLAYER_RPC_URL={GENLAYER_RPC_URL}",
            f"NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS={CONTRACT_ADDRESS}",
        ],
    )

    write_if_missing(BACKEND / "src" / "lib" / "rate-limiter.ts", REDIS_RATE_LIMITER_TS)
    write_if_missing(BACKEND / "src" / "routes" / "genlayer.ts", ROUTES_GENLAYER_TS)
    write_if_missing(FRONTEND / "lib" / "genlayer-proxy.ts", FRONTEND_GENLAYER_PROXY_NOTE)

    # Patch backend env schema to accept REDIS_URL (optional).
    env_ts_path = BACKEND / "src" / "lib" / "env.ts"
    env_ts = env_ts_path.read_text(encoding="utf-8")
    if "REDIS_URL" not in env_ts:
        env_ts = env_ts.replace(
            "GENLAYER_INDEXER_START_BLOCK: z.coerce.number().default(0),",
            "GENLAYER_INDEXER_START_BLOCK: z.coerce.number().default(0),\n"
            "  REDIS_URL: z.string().optional(),",
        )
        env_ts_path.write_text(env_ts, encoding="utf-8")
        print(f"PATCHED {env_ts_path.relative_to(PROJECT_ROOT)}")
    else:
        print(f"SKIP  (REDIS_URL already present): {env_ts_path.relative_to(PROJECT_ROOT)}")

    # Wire genlayer-client.ts to acquire a rate-limit slot before every RPC call.
    client_path = BACKEND / "src" / "lib" / "genlayer-client.ts"
    client_ts = client_path.read_text(encoding="utf-8")
    if "acquireGenlayerRpcSlot" not in client_ts:
        client_ts = client_ts.replace(
            'import { env } from "./env.js";',
            'import { env } from "./env.js";\nimport { acquireGenlayerRpcSlot } from "./rate-limiter.js";',
        )
        client_ts = client_ts.replace(
            "async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {\n  if (!env.GENLAYER_RPC_URL) {",
            "async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {\n"
            "  await acquireGenlayerRpcSlot();\n"
            "  if (!env.GENLAYER_RPC_URL) {",
        )
        client_path.write_text(client_ts, encoding="utf-8")
        print(f"PATCHED {client_path.relative_to(PROJECT_ROOT)}")
    else:
        print(f"SKIP  (already wired): {client_path.relative_to(PROJECT_ROOT)}")

    # Register the new genlayer routes in index.ts.
    index_path = BACKEND / "src" / "index.ts"
    index_ts = index_path.read_text(encoding="utf-8")
    if "genlayerRoutes" not in index_ts:
        index_ts = index_ts.replace(
            'import { casebookRoutes } from "./routes/casebook.js";',
            'import { casebookRoutes } from "./routes/casebook.js";\nimport { genlayerRoutes } from "./routes/genlayer.js";',
        )
        index_ts = index_ts.replace(
            "  await app.register(casebookRoutes);",
            "  await app.register(casebookRoutes);\n  await app.register(genlayerRoutes);",
        )
        index_path.write_text(index_ts, encoding="utf-8")
        print(f"PATCHED {index_path.relative_to(PROJECT_ROOT)}")
    else:
        print(f"SKIP  (already registered): {index_path.relative_to(PROJECT_ROOT)}")

    # Add ioredis dependency.
    pkg_path = BACKEND / "package.json"
    pkg_text = pkg_path.read_text(encoding="utf-8")
    if '"ioredis"' not in pkg_text:
        pkg_text = pkg_text.replace(
            '"dotenv": "^16.4.5"',
            '"dotenv": "^16.4.5",\n    "ioredis": "^5.4.1"',
        )
        pkg_path.write_text(pkg_text, encoding="utf-8")
        print(f"PATCHED {pkg_path.relative_to(PROJECT_ROOT)}")
    else:
        print(f"SKIP  (ioredis already present): {pkg_path.relative_to(PROJECT_ROOT)}")

    print("\nDone.")
    print(f"\nDeployed contract address wired: {CONTRACT_ADDRESS}")
    print("REMINDER: set the same REDIS_URL and VERDICT_CONTRACT_ADDRESS as Fly.io")
    print("secrets and Vercel env vars before deploying (see docs/DEPLOYMENT.md).")


if __name__ == "__main__":
    main()
