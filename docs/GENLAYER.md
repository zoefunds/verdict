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
(`get_case_count`, `get_case`) on a **60-second** interval and syncs
derived case status into Postgres (`backend/src/indexer/poll.ts`). This is
a polling design rather than an event-log subscription because the
contract records its own bounded per-case event log internally
(`get_case_events`) rather than emitting Solidity-style logs — polling view
methods is the reliable sync mechanism for this execution model.

## Rate limiting

StudioNet enforces **two independent** caps, confirmed live against a
production deployment, not assumed from docs:
- **30 requests/minute** (short-term burst cap).
- **5,000 requests/day** (sustained-usage cap) — this one is easy to miss
  because nothing about it is visible on a per-minute basis; a client can
  stay well under 30/min and still exhaust it within a few hours of
  sustained polling.

`backend/src/lib/rate-limiter.ts`'s `acquireGenlayerRpcSlot()` coordinates
BOTH caps via Upstash Redis, shared across the backend API process, the
indexer process, and every frontend tab (frontend reads never call
StudioNet directly — they go through `backend/src/routes/genlayer.ts`
`/genlayer/*` so the shared budget is actually shared; only wallet-signed
writes go direct from the browser, and those are user transactions, not
RPC-budget reads):
- Per-minute: capped at 25 (conservative margin under 30).
- Per-day: capped at 4,500 (conservative margin under 5,000), checked ONCE
  per logical call before the per-minute retry loop — incrementing it once
  per retry iteration instead would burn multiple daily-budget slots for
  one actual RPC call.

**Bug found and fixed (2026-08-25, live production audit):** the indexer's
original 15-second poll interval alone made 86,400/15 = 5,760
`get_case_count` calls/day — over the real 5,000/day cap with ZERO user
traffic and before counting any `get_case` calls per open case. The daily
cap didn't exist as a concept anywhere in this codebase before this fix;
only the per-minute cap was ever coordinated. Confirmed live: the deployed
indexer was silently failing almost every poll cycle with `GenLayer RPC
error (gen_call): Rate limit exceeded: 5000 requests per day`, so on-chain
status changes (funded → evidence window → under investigation → verdict
rendered, etc.) never reached Postgres or the frontend for extended
stretches — cases and case status can silently stop updating on the
frontend with no user-visible error if this regresses. Fixed by raising
the poll interval to 60s AND adding the daily budget tracker above, so a
future regression fails loudly (`GenLayer RPC daily budget exhausted`)
instead of silently starving the indexer. Also added exponential backoff
in `backend/src/indexer/run.ts` (60s → 30 minutes on consecutive sync
failures, reset to 60s on the next success) — a blind fixed-interval
retry loop kept hammering the RPC at the same rate even while every call
was being rejected, which risks perpetuating its own exhaustion if
rejected calls still count against the daily counter (plausible, since
StudioNet has to receive and evaluate a request to reject it).

**Confirmed recovering correctly in production, not just in theory:** the
indexer machine that hit this during development recovered entirely on
its own once StudioNet's daily window rolled over — no restart, no manual
intervention. It logged `[indexer] recovered after N consecutive failed
cycle(s)`, and the one case affected during the outage (`VX-5961`) had its
Postgres status jump straight from a stale `awaiting_respondent_stake` to
the real current on-chain `settled` in a single subsequent sync cycle —
confirming `syncOneCase`'s design (overwrite to current on-chain status,
never replay intermediate states) works exactly as intended after an
extended outage, not just for routine polling gaps.

## Current status

**Superseded deployment (retired):** `0x56118ae3ee66b662a9a4CEf3424008c1D1036DbD`
was deployed and exercised end-to-end on StudioNet — real case creation,
respondent funding, evidence submission, a real GenLayer-rendered verdict,
a real appeal, and appeal-evidence resubmission all confirmed working
against it. That address is now **superseded** following an external
audit (2026-08-25) that required contract-level fixes (see
`docs/SECURITY.md` "External audit findings") — most importantly, adding
a `content_hash` parameter to `submit_evidence` that the old contract
never had, so the old and new contracts are not wire-compatible. Any case
data on the old address is a retired test artifact only.

**Superseded deployment (retired):** `0x2be36DaF2FC169310dB7Cc2dAFBAa3Db410aA195`
("v2") was deployed, wired in, and CLI-verified — but its source predates
the byte-truncation hash-canonicalization fix from the second audit round
(see `docs/SECURITY.md` "Second external audit round", finding #1), which
was lost to an external file-sync revert and only reapplied after v2 was
already live. Retired in favor of v3 below rather than left mismatched
with checked-in source.

**v3 deployed and wired in:** `0xD570c9bA2B68b10d0c86EDD9Fc5B384c9ecD7185`
is the current production contract, wired into the Fly.io backend
(`VERDICT_CONTRACT_ADDRESS` secret), the indexer, and the Vercel frontend
(`NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS`). Verified against real StudioNet
state via the `genlayer` CLI (not assumed from source): `genlayer schema
0xD570c9...` confirms the contract loads and `submit_evidence`'s
parameter list matches `[case_id, kind, url, description, tx_reference,
content_hash]`, `genlayer call 0xD570c9... get_protocol_config` returns
live config, and `get_case_count` returns `0` (fresh deployment, no case
data to carry forward or clear this time). The frontend deployment was
verified by locally rebuilding with the matching `.env.local` and
grepping the actual `.next` client bundle for the new address (found in
`layout` and `casebook/page` chunks, old address absent), then confirming
the same address appears in the live served bundle at
`ver-dict.vercel.app` — not just assumed from the env var being set,
since a prior round's Vercel env var silently held an empty string
despite `vercel env add` reporting success.

### SDK version note

`frontend/package.json` pins `genlayer-js` to exact `0.16.0`;
`backend/package.json` pins it to exact `1.1.8` — deliberately NOT the
same version. This was a real gap an external audit caught: the two had
drifted to different major versions with no record of either being
actually verified. Rather than guess that unifying them to one version
works equally well for both wallet-signed writes (frontend) and
server-side reads (backend) without being able to test the wallet-signing
path directly, each is pinned to the exact version already confirmed
working for its actual role: 0.16.0 is what every real transaction listed
above went through on the frontend; 1.1.8 is what the backend's read
proxy (`/genlayer/*` routes) has been serving from since deployment. If
you want to unify on one version, treat it as a deliberate upgrade that
needs the same live-transaction re-verification this pinning documents,
not a routine dependency bump.
