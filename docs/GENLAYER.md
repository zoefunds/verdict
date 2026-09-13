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

## Why this cannot fairly be centralized

A centralized adjudicator — a backend service with an owner-controlled API
key calling an LLM, or a human reviewer — could technically produce an
answer to "did the delivered work meet the agreed scope" just as GenVM
can. What it cannot do is produce that answer in a way either party has
any structural reason to trust, once real, disputed collateral is on the
line. The concrete failure mode is simple and doesn't require assuming bad
faith, only ordinary incentive: **the operator of a centralized adjudicator
controls both the evidence the model sees and the payout decision it
produces**, with nothing that requires them to show their work, weight
both sides symmetrically, or resist pressure from whichever party has
more influence over the platform. A disgruntled operator, a compromised
API key, a silent prompt change, or simple selective inattention to one
side's evidence are all invisible to the parties and unfalsifiable after
the fact — there is no artifact a losing party can point to and say "the
process itself, not just the outcome, was compromised."

GenLayer's design directly closes each part of that gap, at a real,
accepted cost:

- **Independent re-investigation, not one party's word.** Every validator
  re-fetches evidence and re-runs the judgment themselves
  (`_fetch_evidence_independently`, called from inside every leader AND
  every validator closure) — no single party, including the protocol
  operator, ever gets to be the one whose fetch/reasoning is simply
  trusted.
- **Consensus over the substantive findings, not just the final number.**
  As of this contract's structured-verdict architecture (see
  `contracts/README.md` section 5.7), agreement is required on WHICH
  evidence supports the outcome (`evidence_findings`), not only on the
  outcome label itself — a single centralized process producing a
  plausible-sounding answer has no equivalent check forcing it to show
  independently-reproduced substantive reasoning.
- **The verdict is binding on real escrowed collateral inside the same
  trust boundary that ran the investigation.** A centralized adjudicator
  is architecturally separate from the escrow — someone still has to
  trust that its answer gets faithfully relayed into whatever custodies
  the funds, which is exactly the seam an operator (or a compromised
  relay) could exploit. Here, the contract that holds the funds is the
  same contract that ran the consensus investigation; there is no relay
  step where "the investigation said X" could silently become "the
  payout does Y" instead.
- **The cost is real and is being paid deliberately.** Every verdict costs
  multiple independent LLM calls plus independent web fetches instead of
  one, and takes real wall-clock time for consensus and (on appeal) a real
  re-investigation window (see `docs/SECURITY.md` "Real timing constraints
  discovered" — a genuine ~1 hour minimum, confirmed live, not
  theoretical). That's the price of the process itself being verifiable
  and non-repudiable rather than merely fast — a deliberate trade this
  project accepts rather than routes around by moving judgment to a
  faster centralized path.

This is why `docs/SECURITY.md` and this file are explicit that
investigation and adjudication logic live **only** inside
`contracts/verdict_contract.py` — the backend (`backend/src/indexer/`,
`backend/src/routes/`) only ever reads already-consensus-reached state to
index it for fast browsing, and never independently evaluates evidence or
computes a verdict of its own. If the backend ever gained that capability,
the entire argument above would stop applying to VERDICT.

## Avoiding UNDETERMINED / leader-rotation

This was an explicit, hard requirement. The contract addresses it by:

1. Using `gl.vm.run_nondet_unsafe(leader, validator)` with a **custom
   tolerance-band comparator** (`_verdicts_agree`) instead of exact
   equality — the LLM returns a small structured object (outcome enum +
   basis-point split + confidence + short reasoning) plus a bounded,
   enumerable per-evidence findings map, and consensus compares the
   structured/enumerable fields within tolerance, never raw prose (see
   `contracts/README.md` section 5.7 for the full structured-verdict
   layer breakdown).
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

**Superseded deployment (retired):** `0xD570c9bA2B68b10d0c86EDD9Fc5B384c9ecD7185`
("v3") was deployed, wired in, and verified end-to-end (see "Live
end-to-end lifecycle audit" in `docs/SECURITY.md`) — retired when a fresh
contract address ("v4") was deployed alongside a full database reset for
a clean multi-product testing round. No functional changes between v3 and
v4; `submit_evidence`'s signature and every other method are identical.
The frontend deployment for v3 was verified by locally rebuilding with the
matching `.env.local` and grepping the actual `.next` client bundle for
the new address (found in `layout` and `casebook/page` chunks, old address
absent), then confirming the same address appeared in the live served
bundle at `ver-dict.vercel.app` — not just assumed from the env var being
set, since a prior round's Vercel env var silently held an empty string
despite `vercel env add` reporting success. The same verification method
was repeated for v4.

**Superseded deployment (retired):** `0x2BEe5eBb18c8E0D82E68Fc103fA68dfC0e876E58`
("v4") was deployed, wired in, and CLI-verified the same way v3 was.
Every non-admin read and write method was exercised against it across 4
independent, fully-detailed product-dispute test cases (real
claim/evidence text, not placeholders) — full write-up in
`docs/SECURITY.md` "Multi-product live lifecycle audit". Two
`render_verdict`/`resolve_appeal` calls genuinely hit `MAJORITY_DISAGREE`
after exhausting all leader rotations (a real consensus split, not a bug)
and succeeded on a same-script retry with a fresh leader/validator draw.
The 4 resulting cases (3 settled, 1 cancelled) were, once again, created
by calling the contract directly rather than through the app's normal
`POST /cases` flow — so they needed the same kind of Postgres backfill as
the v3 evidence-visibility gap before appearing on the frontend; see
`backend/src/db/backfill_e2e_test_cases.ts`. Retired in favor of v5 to
pick up the structured-verdict architecture added the same day as v5's
deployment (see below) — v4's source predates it.

**v5 deployed and wired in (current):**
`0xc4650C47245FDF354b1502FE9533BD944087cB88` is the current production
contract, wired into the Fly.io backend (`VERDICT_CONTRACT_ADDRESS`
secret), the indexer, and the Vercel frontend
(`NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS`). Verified against real StudioNet
state via the `genlayer` CLI before any test transaction: `genlayer schema
0xc4650C...` confirmed the contract loads and every method's parameter
list matches checked-in source exactly, `genlayer call 0xc4650C...
get_protocol_config` returned live config, and `get_case_count` returned
`0` (fresh deployment). All prior-contract data was cleared from Postgres
before testing began, per the request that prompted this round.

Every non-admin read and write method was then exercised across 2
independent, fully-detailed product-dispute test cases — full write-up
in `docs/SECURITY.md` "v5 contract: 2-test round". This was the **first
live confirmation the structured-verdict architecture (`claim_findings`/
`evidence_findings`, added the same day) actually works** against a real
model: a real `render_verdict` call produced the required structure
correctly on its first attempt. A real `resolve_appeal` under a 4-item
evidence set hit 7 genuine `MAJORITY_DISAGREE` rounds before reaching
agreement — informative about the new equivalence tolerance under real
conditions, not a bug (no invalid state was ever written by a
disagreeing round). Two real bugs were also found and fixed in this
round's own test tooling (not the contract): the `genlayer` CLI had
silently auto-updated mid-session to a broken release candidate breaking
all reads (fixed by downgrading to `0.39.2`), and the test harness's
success check accepted a `FINALIZED` status without checking the actual
`result_name`, treating a genuine disagreement as false-success and
causing 3 duplicate cases before being caught. Both cases from this
round needed the same Postgres backfill as prior rounds
(`backend/src/db/backfill_e2e_test_cases_v5.ts`).

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
