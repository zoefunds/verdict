#!/usr/bin/env python3
"""
step4_indexer_and_docs.py

Creates:
  - backend/src/lib/genlayer-client.ts  thin GenLayer JSON-RPC view-call client
  - backend/src/indexer/poll.ts          polling indexer (contract -> Postgres)
  - backend/src/indexer/run.ts           standalone entrypoint for the indexer process
  - docs/ARCHITECTURE.md
  - docs/SECURITY.md
  - docs/DEPLOYMENT.md
  - docs/GENLAYER.md

Usage:
    cd /Users/macbook/verdict
    python3 scripts/step4_indexer_and_docs.py
"""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND = PROJECT_ROOT / "backend"
DOCS = PROJECT_ROOT / "docs"

GENLAYER_CLIENT_TS = """\
/**
 * Minimal GenLayer StudioNet read client for the indexer.
 *
 * GenLayer's execution model is not identical to a Solidity EVM chain —
 * this contract does not emit Solidity-style event logs; instead it records
 * an internal, bounded per-case event log readable via the `get_case_events`
 * view method (see contracts/verdict_contract.py `_log` / `get_case_events`).
 * That means the reliable sync strategy here is POLLING the contract's view
 * methods on an interval, not subscribing to `eth_getLogs`-style filters.
 *
 * This client wraps the GenLayer JSON-RPC `gen_call` (view-call) endpoint.
 * Exact method/param names should be reconfirmed against the GenLayer JS SDK
 * / docs.genlayer.com for your installed SDK version before relying on this
 * in production — this file intentionally isolates that surface to one
 * place so it's a single, small area to patch if the RPC shape differs.
 */

import { env } from "./env.js";

export class GenLayerClientError extends Error {}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  if (!env.GENLAYER_RPC_URL) {
    throw new GenLayerClientError("GENLAYER_RPC_URL is not configured");
  }
  const res = await fetch(env.GENLAYER_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new GenLayerClientError(`GenLayer RPC HTTP ${res.status}`);
  }
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) {
    throw new GenLayerClientError(`GenLayer RPC error: ${body.error.message}`);
  }
  if (body.result === undefined) {
    throw new GenLayerClientError("GenLayer RPC returned no result");
  }
  return body.result;
}

function contractAddressOrThrow(): string {
  const addr = env.VERDICT_CONTRACT_ADDRESS;
  if (!addr || addr.startsWith("changeme")) {
    throw new GenLayerClientError("VERDICT_CONTRACT_ADDRESS is not configured — contract not yet deployed");
  }
  return addr;
}

/** Calls a @gl.public.view method on the deployed VERDICT contract. */
export async function viewCall<T>(method: string, args: unknown[] = []): Promise<T> {
  const address = contractAddressOrThrow();
  // NOTE: param shape (`gen_call` vs `eth_call`-style calldata encoding) is
  // SDK-version-dependent. This uses a plausible JSON-RPC shape; validate
  // against the installed GenLayer SDK's documented low-level call method
  // before depending on this in production, and adjust here only.
  return rpcCall<T>("gen_call", [{ to: address, function: method, args }]);
}

export async function getCaseCount(): Promise<number> {
  return viewCall<number>("get_case_count");
}

export async function getCase(caseId: number): Promise<Record<string, unknown>> {
  return viewCall<Record<string, unknown>>("get_case", [caseId]);
}

export async function getCaseEvents(caseId: number, limit = 50): Promise<Array<Record<string, unknown>>> {
  return viewCall<Array<Record<string, unknown>>>("get_case_events", [caseId, limit]);
}

export async function getEvidence(evidenceId: number): Promise<Record<string, unknown>> {
  return viewCall<Record<string, unknown>>("get_evidence", [evidenceId]);
}

export function isContractConfigured(): boolean {
  const addr = env.VERDICT_CONTRACT_ADDRESS;
  return Boolean(addr) && !addr!.startsWith("changeme");
}
"""

INDEXER_POLL_TS = """\
/**
 * Polling indexer: syncs on-chain VERDICT case state into Postgres so the
 * frontend/casebook can browse/search quickly. This is a DERIVED index,
 * never the source of truth — every write here is idempotent (upsert) and
 * the whole table set can be safely truncated and rebuilt by re-running
 * this poll loop against the contract's view methods.
 *
 * Runs as a long-lived loop when started via indexer/run.ts. Does nothing
 * (logs a warning once and idles) if VERDICT_CONTRACT_ADDRESS is not yet
 * configured, so local/dev/pre-deployment environments don't crash-loop.
 */

import { db } from "../db/client.js";
import { cases } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getCaseCount, getCase, isContractConfigured } from "../lib/genlayer-client.js";

const CONTRACT_STATUS_TO_DB_STATUS: Record<string, (typeof cases.status.enumValues)[number]> = {
  DRAFT: "draft",
  OPEN: "open",
  AWAITING_RESPONDENT_STAKE: "awaiting_respondent_stake",
  FUNDED: "funded",
  EVIDENCE_WINDOW: "evidence_window",
  UNDER_INVESTIGATION: "under_investigation",
  VERDICT_RENDERED: "verdict_rendered",
  APPEAL_WINDOW: "appeal_window",
  APPEALED: "appealed",
  RE_INVESTIGATION: "re_investigation",
  FINAL: "final",
  SETTLED: "settled",
  CANCELLED: "cancelled",
  ABANDONED_REFUNDED: "abandoned",
};

export async function syncOneCase(contractCaseId: number): Promise<void> {
  const onChain = await getCase(contractCaseId);
  const status = CONTRACT_STATUS_TO_DB_STATUS[String(onChain.status)];
  if (!status) {
    console.warn(`[indexer] unknown on-chain status "${onChain.status}" for case ${contractCaseId}, skipping`);
    return;
  }

  const [existing] = await db
    .select()
    .from(cases)
    .where(eq(cases.contractCaseId, String(contractCaseId)))
    .limit(1);

  if (!existing) {
    // The case row should already exist as a DRAFT (created via POST /cases
    // and linked via PATCH /cases/:id/link-contract before the on-chain tx
    // was even submitted). If it's missing here, the off-chain and on-chain
    // records have diverged — log loudly rather than silently fabricating a
    // case row with placeholder claim text.
    console.error(
      `[indexer] contract case ${contractCaseId} has no matching DB row — off-chain/on-chain state has diverged, manual review needed`,
    );
    return;
  }

  if (existing.status !== status) {
    await db
      .update(cases)
      .set({
        status,
        settledAt: status === "settled" ? new Date() : existing.settledAt,
        updatedAt: new Date(),
      })
      .where(eq(cases.id, existing.id));
    console.log(`[indexer] case ${contractCaseId}: ${existing.status} -> ${status}`);
  }
}

export async function syncAllCases(): Promise<void> {
  if (!isContractConfigured()) {
    console.warn("[indexer] VERDICT_CONTRACT_ADDRESS not configured — skipping sync cycle");
    return;
  }

  let count: number;
  try {
    count = await getCaseCount();
  } catch (err) {
    console.error("[indexer] failed to read case count from contract", err);
    return;
  }

  for (let id = 1; id <= count; id += 1) {
    try {
      await syncOneCase(id);
    } catch (err) {
      // One bad case must never halt the whole sync cycle.
      console.error(`[indexer] failed to sync case ${id}`, err);
    }
  }
}
"""

INDEXER_RUN_TS = """\
import "dotenv/config";
import { syncAllCases } from "./poll.js";

const POLL_INTERVAL_MS = 15_000;

async function loop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Date.now();
    try {
      await syncAllCases();
    } catch (err) {
      console.error("[indexer] sync cycle failed", err);
    }
    const elapsed = Date.now() - start;
    const wait = Math.max(0, POLL_INTERVAL_MS - elapsed);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

console.log("[indexer] starting VERDICT contract -> Postgres sync loop");
loop();
"""

ARCHITECTURE_MD = """\
# VERDICT — Architecture

## System overview

VERDICT is split across three independently deployable systems with an
intentional split of "source of truth":

1. **GenLayer Intelligent Contract (StudioNet)** — authoritative for: case
   existence, stake custody/escrow, evidence content-hash commitments,
   verdicts, appeals, settlement. If it isn't true on-chain, it isn't
   financially true, no matter what Postgres says.
2. **Postgres (backend/src/db/schema.ts, Drizzle ORM)** — the indexed /
   derived layer: rich case metadata, evidence content, constitution
   library, casebook search, notifications, audit log. Rebuildable at any
   time from the contract via `backend/src/indexer/`.
3. **Next.js frontend (Vercel)** — reads Postgres for browsing speed, but
   reads financial truth (stakes, verdicts, settlement) directly from the
   contract via `frontend/lib/genlayer.ts`.

```
 wallet signs tx           contract state changes         indexer polls
      |                          |                              |
      v                          v                              v
  GenLayer contract  <----  frontend (Vercel)  ---->   backend API (Fly.io)
      ^                          |                              |
      |                          v                              v
      +-----------------  direct verdict/stake reads      Postgres (derived)
```

## Why the split (on-chain vs off-chain vs frontend)

- **On-chain**: anything where tampering must be cryptographically
  impossible — money movement, verdict outcome, evidence hash commitments.
- **Off-chain (Postgres)**: anything that benefits from fast search/filter
  (Casebook browsing, case lists) or needs storage the chain shouldn't hold
  directly (full evidence file bytes, long-form descriptions). Every
  financially-relevant Postgres field carries a `contract_*` reference back
  to the chain so it's auditable, not just asserted.
- **Frontend**: never trusts a cached Postgres value for "did I get paid" —
  settlement/verdict reads go straight to the contract's view methods.

## Case lifecycle (state machine)

```
DRAFT -> OPEN -> AWAITING_RESPONDENT_STAKE -> FUNDED -> EVIDENCE_WINDOW ->
UNDER_INVESTIGATION -> VERDICT_RENDERED -> APPEAL_WINDOW ->
  [APPEALED -> RE_INVESTIGATION -> FINAL] | FINAL -> SETTLED
(also: CANCELLED, ABANDONED_REFUNDED as timeout/cancellation exits)
```

Mirrored identically between `contracts/verdict_contract.py` (source of
truth) and `backend/src/db/schema.ts` `case_status` enum (derived index) —
see `backend/src/indexer/poll.ts` `CONTRACT_STATUS_TO_DB_STATUS` for the
explicit mapping table.

## Directory responsibilities

- `frontend/` — Next.js App Router app. `(marketing)` = public landing,
  `(app)` = authenticated case/dashboard flows, `(public)` = logged-out
  Casebook.
- `backend/` — Fastify API: wallet auth (SIWE-style), case/evidence CRUD
  against Postgres, file storage on the Fly.io volume, and the GenLayer
  polling indexer.
- `contracts/` — the single production Intelligent Contract.
- `scripts/` — every file-creation/modification operation, as executable
  Python scripts (per the project's terminal-first workflow).
- `docs/` — this file, plus SECURITY.md, DEPLOYMENT.md, GENLAYER.md,
  MEMORY.md (running project journal).

## Transaction lifecycle (frontend)

Every stake / settlement / appeal-bond action goes through an explicit
state machine (`frontend/hooks/useTransaction.ts`):

```
idle -> wallet_confirm -> submitted -> pending -> confirmed | failed
                                            |
                                            +-> rejected | wrong_network |
                                                insufficient_funds |
                                                wallet_disconnected
```

No UI path is allowed to show a bare "Success" without passing through
`confirmed`.
"""

SECURITY_MD = """\
# VERDICT — Security Review

Status: **pre-deployment draft**. Must be revisited once the contract is
actually deployed to StudioNet and once real load/traffic patterns exist.
This is not a substitute for a professional audit before handling real
economic value beyond StudioNet testnet GEN.

## Authentication & session management

- Wallet-based auth only (SIWE-style nonce + `personal_sign`), no
  custodial private keys anywhere in the system (`backend/src/lib/auth.ts`).
- Nonces are single-use: consumed atomically before session issuance
  (`consumedAt` set in the same logical step as verification), preventing
  signature replay.
- Nonces expire after 5 minutes.
- Access tokens are short-lived JWTs (15 min default); refresh tokens live
  in an `httpOnly`, `sameSite=strict`, `secure`-in-production cookie scoped
  to `/auth` — never exposed to JS, reducing XSS blast radius.
- Auth endpoints (`/auth/nonce`, `/auth/verify`) are rate-limited tighter
  than the general API (10/min) to blunt nonce-spam and brute-force.

## Smart contract security (see contracts/verdict_contract.py)

- **Reentrancy / double-spend**: every payout path follows read-ledger ->
  zero-ledger -> persist -> `_send_gen` ordering. The transfer never
  happens before the ledger is zeroed and saved, and every payout function
  re-checks `amount <= 0` at the top so a second call after a zeroed
  balance fails cleanly (`gl.vm.UserError`) instead of double-paying.
- **Single emission chokepoint**: all GEN leaves the contract through one
  `_send_gen` function — the entire fund-movement surface can be audited by
  grepping one symbol.
- **Consensus / undetermined-status risk**: verdict evaluation uses
  `gl.vm.run_nondet_unsafe` with a custom tolerance-band comparator
  (`_verdicts_agree`), not exact-string equality, so ordinary LLM phrasing
  variance doesn't cause spurious leader rotation. Error classification
  prefixes (`[EXPECTED]`/`[EXTERNAL]`/`[TRANSIENT]`/`[LLM_ERROR]`) let
  validators agree on failure *classes* instead of exact text.
- **Prompt injection**: participant-submitted evidence text is always
  wrapped and explicitly labeled as untrusted data inside LLM prompts, never
  concatenated as instructions. Web-fetched evidence content is truncated
  (`MAX_EVIDENCE_FETCH_CHARS`) and likewise labeled untrusted.
- **Abandonment / griefing**: every escrow path has a timeout-based recovery
  exit (`claim_case_abandonment`) so funds can never be permanently stuck if
  a counterparty disappears at any stage.
- **Access control**: owner-only admin functions (`_only_owner`) are
  explicitly separated from participant actions and public views; case
  actions verify caller is a registered party (`_is_party`) before allowing
  evidence submission or fund-related calls.

## Evidence integrity

- All evidence is SHA-256 content-hashed at submission time
  (`backend/src/routes/evidence.ts`), and that hash is what gets committed
  on-chain. URL evidence is independently re-fetched by the contract at
  verdict time (`_fetch_evidence_independently`) — a hash mismatch is a
  tamper signal surfaced to the verdict reasoning, not silently accepted.
- Evidence provenance is tracked explicitly (`participant_submitted` vs
  `contract_verified` — `evidence_provenance` enum) so the UI never implies
  a claim has been independently verified when it hasn't.
- File uploads are validated by MIME allowlist and size cap
  (`EVIDENCE_MAX_FILE_SIZE_MB`), stored under randomized filenames (never
  the user-supplied name) to prevent path traversal.

## Application security

- **SSRF**: only the *contract's own* nondeterministic web-fetch (executed
  inside GenVM, not the Node backend) fetches user-submitted URLs — the
  Fastify backend itself never makes outbound requests to user-supplied
  URLs, eliminating a whole SSRF class from the Node process.
- **Input validation**: all route bodies are parsed through `zod` schemas
  with explicit length caps before touching the database.
- **SQL injection**: not applicable in the traditional sense — all queries
  go through Drizzle ORM's parameterized query builder, no raw string
  interpolation into SQL anywhere in the codebase.
- **Rate limiting**: global 100 req/min via `@fastify/rate-limit`, tighter
  on auth endpoints.
- **CORS**: locked to `CORS_ORIGIN` (the deployed frontend origin), not
  wildcard.
- **Secrets**: never committed; `.env.example` ships only placeholder
  values (verified before every commit); production secrets are set via
  `flyctl secrets set` / Vercel's environment variable UI, never in
  `fly.toml` or repo files.

## Known gaps / follow-up before real-value production use

- [ ] Formal external audit of `contracts/verdict_contract.py` before any
      non-testnet deployment.
- [ ] Automated dependency vulnerability scanning (`npm audit` / Dependabot)
      wired into CI once CI is set up.
- [ ] Structured centralized logging/monitoring on the Fly.io backend
      (currently `pino` structured logs only, no alerting pipeline yet).
- [ ] Load testing of the polling indexer against a case volume beyond
      trivial (current design polls all case IDs sequentially each cycle —
      fine at MVP scale, will need pagination/backoff at scale).
"""

DEPLOYMENT_MD = """\
# VERDICT — Deployment

## Frontend -> Vercel

```bash
cd frontend
vercel link
vercel env add NEXT_PUBLIC_API_BASE_URL production
vercel env add NEXT_PUBLIC_REOWN_PROJECT_ID production
vercel env add NEXT_PUBLIC_GENLAYER_RPC_URL production
vercel env add NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS production
vercel --prod
```

Preview deployments happen automatically on every push once the Vercel
project is linked to the GitHub repo (github.com/zoefunds/verdict).

## Backend -> Fly.io

The backend is configured for **always-on** operation
(`backend/fly.toml`: `min_machines_running = 1`, `auto_stop_machines =
false`, HTTP health checks against `/health` with automatic restart on
failure).

```bash
cd backend
flyctl auth login              # authenticate with the correct Fly account
flyctl apps create verdict-backend
flyctl volumes create verdict_evidence_data --size 3 --region iad
flyctl secrets set \\
  DATABASE_URL="postgresql://..." \\
  JWT_SECRET="$(openssl rand -hex 32)" \\
  SESSION_REFRESH_SECRET="$(openssl rand -hex 32)" \\
  GENLAYER_RPC_URL="https://studio.genlayer.com/api" \\
  VERDICT_CONTRACT_ADDRESS="<from contract deployment>"
flyctl deploy
```

For genuine "never die" resilience beyond a single machine, scale to two
machines across regions:

```bash
flyctl scale count 2 --region iad,ord
```

## Database

Local dev: `docker compose up -d postgres`, then `npm run db:generate &&
npm run db:migrate` inside `backend/`.

Production: either a managed Postgres attached to the Fly app
(`flyctl postgres create`) or an external managed Postgres — set
`DATABASE_URL` as a Fly secret either way. Run
`npm run db:migrate` against production before the first deploy that needs
the new schema.

## GenLayer contract -> StudioNet

**Deployed by the user, not by Claude** — see `contracts/README.md` for the
full, current deployment walkthrough (prerequisites, `genlayer deploy`
invocation, verification steps, and how to obtain the resulting contract
address). Once you have the address, provide it and I will wire it into:

- `backend/.env` (`VERDICT_CONTRACT_ADDRESS`, `GENLAYER_RPC_URL`)
- `frontend/.env.local` (`NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS`,
  `NEXT_PUBLIC_GENLAYER_RPC_URL`)
- Fly.io secrets (`flyctl secrets set VERDICT_CONTRACT_ADDRESS=...`)
- Vercel environment variables

...and then we'll verify end-to-end: a real view call succeeds, a real
write call (case creation) succeeds, the indexer picks up the resulting
state change, and the frontend reflects it.

## Environment variable reference

See `.env.example` at the project root for the full list with inline
comments. Never commit a filled-in `.env` / `.env.local`.
"""

GENLAYER_MD = """\
# VERDICT — GenLayer Integration

## Contract

`contracts/verdict_contract.py` — one production Intelligent Contract,
~1650 lines, covering the full VERDICT protocol: constitution/governance,
case lifecycle, escrow, evidence submission + independent web-fetch
verification, non-deterministic verdict evaluation, settlement, appeals,
abandonment/timeout recovery, and views. See its in-file table of contents
and `contracts/README.md` for deployment.

## Why GenLayer specifically

VERDICT's core requirement is: real-world claims need *investigation*, not
a popularity vote. GenLayer's Optimistic Democracy consensus — validators
independently run the same non-deterministic (LLM + web-fetch) evaluation
and must agree via an equivalence check — is what lets "did this evidence
establish delivery occurred" be answered with the same integrity guarantees
as a deterministic computation, instead of trusting one party's assertion
or a single oracle.

## Avoiding UNDETERMINED / leader-rotation

This was an explicit, hard requirement. The contract addresses it by:

1. Using `gl.vm.run_nondet_unsafe(leader, validator)` with a **custom
   tolerance-band comparator** (`_verdicts_agree`) instead of exact
   equality — the LLM returns a small structured object (outcome enum +
   basis-point split + confidence + short reasoning), and consensus
   compares only the structured fields within tolerance bands, never raw
   prose.
2. Classifying every error into `[EXPECTED]` / `[EXTERNAL]` / `[TRANSIENT]`
   / `[LLM_ERROR]` prefixes so validators can agree on a failure *class*
   even when exact error text differs slightly between runs.
3. Keeping the non-deterministic surface area to exactly two
   `@gl.public.write` entrypoints (`request_investigation`,
   `render_verdict`) — everything else in the contract is fully
   deterministic, minimizing where consensus even needs to be negotiated.

## Evidence verification

When evidence includes a URL, `_fetch_evidence_independently` re-fetches
the page content at verdict time inside the non-deterministic block (not
trusting the hash committed at submission time as sufficient on its own) —
divergence between the committed hash and the verdict-time fetch is
surfaced explicitly in the verdict reasoning rather than silently ignored.

## Indexer

`backend/src/indexer/` polls the contract's view methods
(`get_case_count`, `get_case`) on a 15-second interval and syncs derived
case status into Postgres (`backend/src/indexer/poll.ts`). This is a
polling design rather than an event-log subscription because the contract
records its own bounded per-case event log internally
(`get_case_events`) rather than emitting Solidity-style logs — polling view
methods is the reliable sync mechanism for this execution model.

## Current status

Contract is written and reviewed; **not yet deployed**. Once you deploy it
to StudioNet and provide the resulting address, we wire it into the
backend indexer and frontend client (`frontend/lib/genlayer.ts`) and verify
end-to-end reads/writes — see `docs/DEPLOYMENT.md`.
"""


def write_if_missing(path: Path, content: str) -> None:
    if path.exists() and path.stat().st_size > 0:
        print(f"SKIP  (already exists): {path.relative_to(PROJECT_ROOT)}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"WROTE {path.relative_to(PROJECT_ROOT)}")


def main() -> None:
    print(f"Step 4: Indexer + docs — project root: {PROJECT_ROOT}\n")
    write_if_missing(BACKEND / "src" / "lib" / "genlayer-client.ts", GENLAYER_CLIENT_TS)
    write_if_missing(BACKEND / "src" / "indexer" / "poll.ts", INDEXER_POLL_TS)
    write_if_missing(BACKEND / "src" / "indexer" / "run.ts", INDEXER_RUN_TS)
    write_if_missing(DOCS / "ARCHITECTURE.md", ARCHITECTURE_MD)
    write_if_missing(DOCS / "SECURITY.md", SECURITY_MD)
    write_if_missing(DOCS / "DEPLOYMENT.md", DEPLOYMENT_MD)
    write_if_missing(DOCS / "GENLAYER.md", GENLAYER_MD)
    print("\nDone.")


if __name__ == "__main__":
    main()
