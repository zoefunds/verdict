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

**Awaiting redeployment of the fixed contract.** Once you deploy the
current `contracts/verdict_contract.py` to StudioNet and provide the
resulting address, it gets wired into the backend indexer and frontend
client (`frontend/lib/genlayer.ts`) and re-verified end-to-end — see
`docs/DEPLOYMENT.md`.

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
