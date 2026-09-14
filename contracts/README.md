# VERDICT — Intelligent Contract

`verdict_contract.py` is a collateralized, evidence-based dispute resolution
protocol built as a GenLayer Intelligent Contract. It is **not** a betting or
prediction-market contract: a claimant and a respondent who already disagree
about a real-world fact each lock GEN collateral behind their own account of
events, submit evidence, and the contract's LLM-backed non-deterministic
logic — reaching consensus via GenLayer's Optimistic Democracy — investigates
that evidence against a versioned "constitution" and renders a verdict. The
loser's stake moves to a protocol treasury, the winner reclaims their own
stake, and partial verdicts split proportionally. Either party may appeal
once, within a 7-day window, by posting an appeal bond; the second verdict is
final.

## Version history

**v1** — `0x56118ae3ee66b662a9a4CEf3424008c1D1036DbD` (retired). First
production deployment, exercised end-to-end on StudioNet (real case
creation, respondent funding, evidence submission, a real
GenLayer-rendered verdict, a real appeal, appeal-evidence resubmission).
Superseded once an external audit found real issues requiring a
wire-incompatible change to `submit_evidence`.

**v2** — `0x2be36DaF2FC169310dB7Cc2dAFBAa3Db410aA195` (retired). Fixed six
issues from the first external audit round (see `docs/SECURITY.md`
"External audit findings"): malformed LLM output silently becoming
`INCONCLUSIVE` instead of raising, a 15%-wide consensus tolerance,
unbounded evidence surface (40 items × 5000 chars), a blanket
`fetch_succeeded = True` marker instead of real per-item results, and —
the change that affects deploy/integration — **`submit_evidence` gained a
required 6th parameter, `content_hash`** (hex sha256 of the evidence's
actual content — for URLs, the fetched page body, never the URL string).
The constructor's signature was unchanged.

**v3** — `0xD570c9bA2B68b10d0c86EDD9Fc5B384c9ecD7185` (retired). Fixed a
canonicalization bug from a second external audit round: v2's evidence
content-hash truncated by *character* count before UTF-8 encoding, while
the backend truncated by *byte* count — for non-ASCII content those could
diverge and produce different hashes for identical content. v3 truncates
the same UTF-8 byte buffer on both sides (see `EVIDENCE_CONTENT_BYTES` in
`verdict_contract.py`, which must stay numerically equal to
`EVIDENCE_HASH_TRUNCATION_BYTES` in `backend/src/lib/safe-fetch.ts`). No
parameter signature changes from v2 — `submit_evidence` is unchanged;
this is a pure internal-logic redeploy. Verified end-to-end with real
signed StudioNet transactions covering the full lifecycle including the
appeal path — see `docs/SECURITY.md` "Live end-to-end lifecycle audit".

**Known residual limitation, by design, not a bug to chase further:** the
content-hash comparison can still legitimately mismatch even after the v3
fix, because the contract's fresh fetch goes through
`gl.nondet.web.render` (GenVM's sandboxed renderer — the only fetch
mechanism available inside a nondet block) while the backend fetches raw
HTTP and reduces it to approximate visible text itself. These are two
structurally different extraction mechanisms with no shared raw-bytes
fetch primitive to unify them against. This is why a hash mismatch has
always been treated as a signal for the verdict LLM to weigh, never
automatic proof of tampering — confirmed live: the real test case's
evidence hash legitimately mismatched, and the LLM correctly reasoned
about it as a weakening (not disqualifying) signal rather than erroring —
and this pattern repeated identically across every v4 test case below, not
just the one v3 case.

**v4** — `0x2BEe5eBb18c8E0D82E68Fc103fA68dfC0e876E58` (retired). No
functional changes from v3 — this redeploy exists because the database was
being reset for a clean multi-product test round (see
`docs/SECURITY.md` "Multi-product live lifecycle audit") and a fresh
contract address was deployed alongside it. `submit_evidence`'s signature
and every other method are unchanged from v3; `genlayer schema` was used
to confirm the deployed bytecode matches checked-in source exactly before
any test transaction was sent. This is the address currently wired into
production (backend, indexer, frontend).

Every non-admin write and read method was exercised against v4 across 4
independent, fully-detailed product-dispute test cases (not placeholder
data) — see `docs/SECURITY.md` for the full write-up, including two
genuine `MAJORITY_DISAGREE` consensus splits (each resolved on retry with
a fresh leader/validator draw) and confirmation that `create_case`,
`fund_respondent_stake`, `submit_evidence` (all three evidence kinds),
`add_case_rule`, `close_evidence_window_early`, `request_investigation`,
`render_verdict`, `file_appeal`, `open_appeal_evidence_window`,
`resolve_appeal`, `settle_case`, and `cancel_case` all work correctly
end to end. `claim_case_abandonment` was the sole method not exercised —
its `ABANDONMENT_GRACE_SECONDS` constant (14 days) makes it infeasible to
trigger for real within a normal testing session; admin/owner-only
methods (`set_*`, `sweep_treasury`, `transfer_ownership`,
`propose_constitution_amendment`) were out of scope per the request that
prompted this round.

**v5** — `0xc4650C47245FDF354b1502FE9533BD944087cB88` (retired). Deployed
to pick up the structured, evidence-linked verdict architecture (see
section 5.7 below) added the same day — no changes to `submit_evidence`
or any other method signature from v4. `genlayer schema` confirmed the
deployed bytecode matches checked-in source exactly, including every
method's parameter list, before any test transaction was sent.

This was the **first live confirmation the structured-verdict
architecture actually works** against a real model, not just the unit
tests in `tests/contract/`: a real `render_verdict` call produced a
genuine `claim_findings` array (citing specific evidence ids per claim)
and `evidence_findings` map on its first successful attempt, and a real
`resolve_appeal` exercised the new equivalence tolerance under a 4-item
evidence set — see `docs/SECURITY.md` "v5 contract: 2-test round" for
the full write-up, including 7 genuine `MAJORITY_DISAGREE` rounds before
that appeal reached agreement (informative about the tolerance under
real conditions, not a bug — no invalid state was ever written by a
disagreeing round). 2 independent, fully-detailed product-dispute test
cases exercised 11 of 12 non-admin write methods (all except
`claim_case_abandonment`, infeasible for the same reason as prior
rounds); admin/owner-only methods were out of scope. Retired after a
re-audit found the equivalence tolerance above (one mismatch allowed
above 2 evidence items) could let a genuinely decisive disagreement pass
as consensus — v6 carries the fix.

**v6** — `0x41e2bD175ce730ec613e5977a069dC5061A271E2`. Deployed
to pick up two re-audit hardening fixes over v5 (see section 5.7 below
for the full detail): `_evidence_findings_agree` now requires **exact**
agreement on every decisive finding, zero tolerance regardless of
evidence count (only two non-decisive labels may ever differ), and every
`claim_findings[].evidence_ids` citation is now validated against the
case's real on-chain evidence set — citing a fabricated or out-of-case id
is rejected as malformed output. No `submit_evidence` or other method
signature changes from v5. `genlayer schema` confirmed the deployed
bytecode matches checked-in source exactly before any test transaction
was sent.

2 more independent, fully-detailed product-dispute test cases exercised
every non-admin method — see `docs/SECURITY.md` "v6 contract: 2-test
round" for the full write-up. The first verdict came back a well-reasoned
`INCONCLUSIVE` at 73% confidence given only uncorroborated
text-statement evidence, and the appeal's `resolve_appeal` needed real
retries under the now-stricter equivalence rule (multiple genuine
`MAJORITY_DISAGREE` rounds) before settling — exactly the validator
behavior expected from tightening zero-tolerance on decisive findings,
confirmed live rather than assumed; no invalid state was ever written by
a disagreeing round. A separate real bug was found and fixed in this
round, outside the contract: the frontend's escrow display derives
"Locked"/"Pending" from a Postgres column every prior backfill script
left null, showing "Pending"/"0 GEN" on fully settled cases — fixed by
deriving real lock timestamps from the contract's own
`CASE_CREATED`/`RESPONDENT_FUNDED` event log instead.

**v7 (current)** — `0xe232251B11bbbf13C848d739914178F27D9F4a56`. Deployed
to pick up the second re-audit's fund-safety fixes (see "Second re-audit:
treasury double-payment, abandonment deadline, missing source file" in
`docs/SECURITY.md`): `settle_case`'s protocol fee and `resolve_appeal`'s
forfeited appeal bond no longer double-credit `accrued_treasury_wei` on
top of their direct `_send_gen` transfer (previously let `sweep_treasury`
pay the same funds out a second time), and `file_appeal` now resets
`evidence_deadline` so the abandonment grace period is measured from the
appeal's filing time, not a stale pre-verdict deadline. No method
signature changes from v6.

Requested explicitly: clear the database of prior claims, run 2 more
entirely different product tests with real detailed data covering every
non-admin method, with zero errors on the explorer. Two live product
tests: **Case 0** — a SaaS integration milestone-payment dispute run
through the full lifecycle (`create_case`, `fund_respondent_stake`,
`submit_evidence` ×4, `close_evidence_window_early`,
`request_investigation`, `render_verdict`, `file_appeal`,
`open_appeal_evidence_window`, `resolve_appeal`, `settle_case`) —
first verdict `PARTIAL` (75% claimant) at 68% confidence, appeal
introduced a bug-tracker record that shifted the second, final verdict
to 60% claimant; settled with a real GEN payout. **Case 4** — a
freelance logo design commission where the claimant cancels before the
respondent ever funds (`add_case_rule`, `cancel_case`), covering the one
non-admin write method Case 0's lifecycle doesn't reach. Together every
non-admin write method is covered except `claim_case_abandonment`
(needs a real 14-day stall, out of scope for a live round, same as every
prior round). Three duplicate `create_case` calls were created and
cleanly retired via `cancel_case` mid-round after a status-parsing bug
in the test harness (fixed: `genlayer-js`'s `waitForTransactionReceipt`
must be given `status: "FINALIZED"` explicitly, or it returns at the
earlier `ACCEPTED` state) — no reverted transactions occurred at any
point. See `review.md` for the full write-up.

## Contents

- [Section-by-section overview](#section-by-section-overview)
- [Deployment to StudioNet](#deployment-to-studionet)
- [Verifying deployment](#verifying-deployment)
- [Interacting with the deployed contract](#interacting-with-the-deployed-contract)

---

## Section-by-section overview

The contract (`class Verdict(gl.Contract)`) is organized into the sections
below, matching the in-file table of contents comment at the top of
`verdict_contract.py`.

### 1–4. Constants, storage dataclasses, escrow primitives, helpers
- Lifecycle status constants for the full case state machine: `DRAFT → OPEN
  → AWAITING_RESPONDENT_STAKE → FUNDED → EVIDENCE_WINDOW →
  UNDER_INVESTIGATION → VERDICT_RENDERED → APPEAL_WINDOW → [APPEALED →
  RE_INVESTIGATION → FINAL] | FINAL → SETTLED`, plus `CANCELLED` and
  `ABANDONED_REFUNDED` terminal states for early-exit / recovery paths.
- `Case`, `ConstitutionVersion`, `CaseRule`, `Evidence`, `CaseEvent` — the
  `@allow_storage @dataclass` storage schema. Money fields are `u256`.
- `_send_gen` — the single GEN emission chokepoint. Every payout anywhere in
  the contract routes through this one function, defined once via
  `gl.evm.contract_interface`.
- Deterministic helpers: JSON-extraction/coercion utilities for LLM output,
  address normalization, validation (`_require`), truncation.

### 5.1–5.3 Storage schema, constructor, internal utilities
Deploy-time arguments: `treasury_address`, `initial_core_articles` (the
genesis constitution's immutable core, e.g. "verdicts must be grounded only
in submitted or independently-verified evidence, never in stake size"), and
an optional `min_stake_wei` floor.

### 5.4 Constitution / governance
`propose_constitution_amendment` (owner-gated) publishes a brand-new,
immutable constitution version — it never edits a prior version's text, and
each case freezes the constitution version active at its own creation time,
so amendments are **never retroactive**. `add_case_rule` lets a case's
claimant layer case-specific rules on top of the immutable core articles,
frozen the moment the evidence window opens.

### 5.5 Case lifecycle
`create_case` (payable) — claimant opens a case and locks their stake;
`gl.message.value` must exactly equal `required_stake_wei`. `fund_respondent_stake`
(payable) — respondent locks matching collateral, opening the evidence
window. `cancel_case` — pre-commitment refund exit for the claimant only,
before the respondent has funded.

### 5.6 Evidence submission
`submit_evidence` — either party submits a URL / text statement / tx record /
document hash. All of it is stored as **untrusted, participant-authored
data** and is never treated as instructions to the verdict LLM (see the
explicit untrusted-data wrapping in `_build_verdict_prompt`, and the
prompt-injection defense described in the docstrings).

### 5.7 Non-deterministic verdict evaluation — structured, evidence-linked
The contract's entire nondeterministic surface area is two `@gl.public.write`
entrypoints: `render_verdict` and `resolve_appeal`, both routing through
`_run_verdict_judgment`. For every `URL`-kind evidence item, the leader *and*
every validator independently re-fetch the live page at verdict time via
`gl.nondet.web.render` — never trusting a cached snapshot from submission
time, so post-submission tampering is detectable.

The verdict itself is **not** an outcome label plus freeform prose — it's a
three-layer structured decision (`_parse_verdict`, `FINDING_*` /
`CLAIM_FINDING_*` constants):

1. **Economic layer** — `outcome` enum (`CLAIMANT`/`RESPONDENT`/`PARTIAL`/
   `INCONCLUSIVE`), `claimant_share_bps`, `confidence_bps`. Unchanged from
   the original design.
2. **Claim layer** (`claim_findings`, required, non-empty) — the LLM must
   enumerate the specific disputed claims it evaluated and, for each, state
   whether it was `SUPPORTED_CLAIMANT`, `SUPPORTED_RESPONDENT`, or
   `INSUFFICIENT` — an explicit, first-class "insufficient evidence" route
   at the claim level, not just at the case-outcome level. Validated for
   well-formedness (malformed entries raise `ERR_LLM`, forcing leader
   rotation, same as a malformed outcome always has) but the claim TEXT
   itself is intentionally excluded from equivalence checking — free-text
   claim decomposition legitimately varies between independent LLM calls,
   the same way `reasoning_summary` prose always has.
3. **Evidence layer** (`evidence_findings`, required to cover every real
   on-chain evidence id for the case) — a bounded, enumerable map
   classifying EVERY submitted evidence item as `SUPPORTS_CLAIMANT`,
   `SUPPORTS_RESPONDENT`, `CONTRADICTS_CLAIMANT`, `CONTRADICTS_RESPONDENT`,
   `INSUFFICIENT`, or `IRRELEVANT`. This is the layer that actually
   participates in leader/validator equivalence beyond the economic
   outcome (see below) — because it's tied to a fixed, deterministic set
   of on-chain evidence ids rather than free text, it's directly and
   substantively comparable between two independent LLM calls. Every
   cited `evidence_ids` entry in `claim_findings` is also checked against
   the case's real evidence id set — a citation to a fabricated or
   out-of-case id is rejected as malformed output (`ERR_LLM`), not
   silently accepted.

**Validator equivalence is no longer outcome-only.** `_verdicts_agree`
requires both: (a) the same economic outcome/split/confidence within the
existing tolerance bands, exactly as before, AND (b) the two
independently-computed `evidence_findings` maps to agree EXACTLY on every
**decisive** finding — `SUPPORTS_CLAIMANT`/`SUPPORTS_RESPONDENT`/
`CONTRADICTS_CLAIMANT`/`CONTRADICTS_RESPONDENT` — with zero tolerance,
regardless of how many evidence items exist (`_evidence_findings_agree`).
Two independent LLM calls that land on the same CLAIMANT/RESPONDENT/
PARTIAL outcome but disagree about *which evidence actually supports it*
are **not** treated as real consensus — this is what makes "validators
independently recompute and compare the substantive findings, not merely
JSON shape or labels" true in code, not just in a docstring. The only
mismatch ever tolerated is between two **non-decisive** labels
(`INSUFFICIENT` vs `IRRELEVANT`) — both mean "this item doesn't decide
anything," just for different reasons (unreliable vs off-topic), so
requiring leader and validator to agree on which of those two applies
would be pedantic, not substantive. This is a deterministic materiality
rule, not a numeric-count backstop — it does not loosen as a case's
evidence count grows, which closes a real gap an external re-audit found
in an earlier count-based tolerance (zero mismatches ≤2 items, one
mismatch otherwise) that could let a genuinely decisive disagreement pass
once a case had 3+ evidence items.

The prompt (`_build_verdict_prompt`) also gives explicit adversarial-
evidence handling instructions: prefer independently-verified/hash-matched
sources over unverified ones when two items conflict; classify a failed
fetch as `INSUFFICIENT`, never as suspicious in itself; and never resolve
a claim in either party's favor purely because one side asserted it more
confidently or at greater length. See the main report to the user for why
the equivalence-tolerance design (here and in `SPLIT_BPS_TOLERANCE`/
`SETTLEMENT_BANDS_BPS`) avoids `UNDETERMINED` consensus / leader rotation.

### 5.8 Settlement
`settle_case` executes payout once a case reaches `FINAL`. Outcome →
payout mapping: `CLAIMANT`/`RESPONDENT` → full pot to the winner;
`PARTIAL` → proportional split by `verdict_split_bps`; `INCONCLUSIVE` → both
parties refunded their own stake. An optional protocol fee
(`protocol_fee_bps`, 0 by default, capped at 10%) is skimmed only from the
losing side's forfeited collateral, never from a winner's own reclaimed
stake, and is sent directly to `treasury_address` at settlement time —
see "Treasury accounting" below for why it must NOT also touch
`accrued_treasury_wei`.

### 5.9 Appeals
`file_appeal` (payable) — either party, once, within the fixed 7-day
`APPEAL_WINDOW`, posts an appeal bond (`appeal_bond_bps` of the total case
stake, exact-match enforced) and a required new-evidence note. Also resets
`evidence_deadline` to the filing timestamp — see the abandonment note
below for why. `open_appeal_evidence_window` briefly reopens evidence
submission. `resolve_appeal` triggers the second, final, independent
re-evaluation; the appeal bond is returned to the appellant if the appeal
improved their position, otherwise it is forfeited to treasury (same
direct-push rule as the settlement fee above). No further appeals are
possible after this.

### 5.10 Abandonment / timeout recovery
`claim_case_abandonment` — covers every lifecycle stage where a counterparty
could go silent (respondent never funds; evidence window closes but nobody
requests investigation or renders a verdict; an appeal is filed but never
carried through to resolution). Each check is `deadline + a grace period`
and only ever releases the caller's **own** deposited funds — this is the
"never permanently stuck" guarantee. **AUDIT FIX (re-audit, 2026-09-14)**:
the APPEALED/RE_INVESTIGATION branch's deadline check reuses
`case.evidence_deadline` — before this fix, `file_appeal` never advanced
that field when moving a case into `APPEALED`, so the check measured time
since the case's ORIGINAL pre-verdict evidence window, not since the
appeal was filed. Since a case must already pass through investigation, a
rendered verdict, and up to 7 more days of appeal window before
`file_appeal` can even succeed, that original deadline plus its grace
period could already be in the past the instant an appeal was filed —
making abandonment immediately claimable against a freshly-filed appeal.
`file_appeal` now resets `evidence_deadline` to the filing timestamp, so
the grace-period clock correctly starts from the appeal, not from an
unrelated earlier stage.

**Treasury accounting**: `sweep_treasury` (owner-gated) pays out
`accrued_treasury_wei`. **AUDIT FIX (re-audit, 2026-09-14)**: this field
used to also get credited by `settle_case`'s fee path and
`resolve_appeal`'s forfeit path, both of which ALSO push the same amount
directly to `treasury_address` via `_send_gen` at the moment it's
released — meaning `sweep_treasury` could pay the exact same fee or bond
out a second time from the accrued balance. Real double-payment, not a
bookkeeping display issue. Fixed by removing the credit from both
direct-push paths; `accrued_treasury_wei` now only exists as a safety
valve for a hypothetical future credit-only path and reads `0` under
normal operation, since every current credit path already pushes
immediately.

### 5.11 Views
`get_case`, `get_case_count`, `get_case_evidence_ids`, `get_evidence`,
`get_case_rules`, `get_constitution` (by version), `get_current_constitution_version`,
`get_case_events` (append-only per-case activity log), `get_protocol_config`,
`get_metrics`.

---

## Internal subsystems and invariants

`Verdict` is one deployed contract by design — a single shared source of
truth for escrow, evidence, and adjudication is the whole point (see the
main report to the user for why splitting adjudication out to a
centralized service would defeat that). Internally, though, it's organized
into clearly separated subsystems, each owning a distinct part of state
and a distinct set of invariants — this is the "advanced code done well"
structure inside one contract, not a monolith with no internal boundaries.

| Subsystem | Owns | Core invariant |
|---|---|---|
| **Governance / constitution** (5.4) | `constitution_versions`, `current_constitution_version` | A published version's `articles_json` is immutable once written; amendments create a NEW version, never edit a prior one. Every case freezes `constitution_version` at creation — amendments are never retroactive to an in-flight case. |
| **Case lifecycle** (5.5) | `Case.status` and the fields gated by it | `status` only ever moves forward through the fixed state machine (`DRAFT → ... → SETTLED`, or one of the early-exit terminal states `CANCELLED`/`ABANDONED_REFUNDED`) — no write path can move it backward or skip a required predecessor state (enforced by `_require(case.status == ...)` guards at the top of every state-changing method). |
| **Evidence / provenance** (5.6) | `Evidence`, `case_evidence_ids` | Once stored, an `Evidence` record's `content_hash` and `submitted_by` never change — only the verdict-time-populated fields (`independently_fetched`, `fetch_succeeded`, `content_hash_matched`) are ever written, and only once, by `_mark_evidence_independently_fetched`, and only from the leader's own actually-observed result (never a blanket marker — see that method's docstring). |
| **Non-deterministic investigation** (5.7) | Nothing in storage directly — reads `Case`/`Evidence`, produces a verdict dict | Every URL fetch and every LLM call happens independently inside `leader()`/`validator()` closures called by `gl.vm.run_nondet_unsafe` — the deterministic caller (`render_verdict`/`resolve_appeal`) never sees raw model output directly, only the already-consensus-reached structured dict. |
| **Equivalence checking** (5.7) | Nothing in storage — pure comparison logic (`_verdicts_agree`, `_evidence_findings_agree`, module-level and unit-testable without a contract instance) | A verdict is only ever accepted into state after BOTH the economic layer and the evidence-findings layer independently agree between leader and validator (see 5.7 above) — there is no code path that writes a `Case`'s outcome fields from a single, unverified LLM response. |
| **Appeal** (5.9) | `Case.appeal_*` fields | `appeal_used` can only transition `False → True`, exactly once per case, enforced before `file_appeal` does anything else — a case cannot be appealed twice regardless of outcome. The appeal bond ledger follows the same zero-then-transfer discipline as every other payout (see "Escrow primitives" above). |
| **Settlement** (5.8) | `Case.settled`, the stake/bond ledger fields | `settle_case` reads a ledger field, zeros it, persists, THEN transfers (see "Escrow primitives" above) — a second call against an already-settled case reads a zeroed field and rejects before any transfer is attempted, so the same deposit cannot structurally be paid out twice. |

Cross-subsystem coupling is intentionally narrow: the investigation
subsystem reads governance (constitution text) and evidence (content +
provenance) but never writes either; settlement reads the verdict produced
by investigation but never re-runs or second-guesses it; only
consensus-reached, already-validated data ever crosses from the
nondeterministic layer into deterministic state.

---

## Deployment to StudioNet

GenLayer Studio / StudioNet is the hosted development network, fee token
**GEN**. Deployment is **your** responsibility — this repository never
invents or hard-codes a contract address; you obtain it from the deployment
result and must supply it to any client/frontend yourself.

### 1. Prerequisites

- Node.js and the GenLayer CLI:
  ```bash
  npm install -g genlayer
  ```
- A GenLayer Studio / StudioNet account funded with test GEN. Fund it via
  the faucet button (💧) in the Studio account selector, or the standalone
  faucet at `https://testnet-faucet.genlayer.foundation` if you are pointed
  at the Bradbury testnet instead of StudioNet.

### 2. Initialize / configure the project

If you don't already have a GenLayer CLI project scaffolded:

```bash
genlayer init
```

Point your network configuration at StudioNet (check `genlayer config` /
your project's network config file for the exact key names in your installed
CLI version — these have changed across CLI releases, so confirm against
`genlayer --help` / `genlayer config --help` for your installed version):

- RPC endpoint: `https://studio.genlayer.com/api`
- Chain ID: `61999`

### 3. Deploy

```bash
genlayer deploy --contract contracts/verdict_contract.py --args \
  "<TREASURY_ADDRESS_HEX>" \
  '["Verdicts must be grounded only in submitted or independently-verified evidence, never in the relative size of either party'\''s stake.", "Every party has the right to submit evidence and to one appeal.", "A verdict must never be influenced by which party submitted more or longer evidence."]' \
  0
```

Positional constructor args, in order:
1. `treasury_address` (str) — hex address to receive losing stakes / fees.
2. `initial_core_articles` (list[str]) — the genesis constitution's
   immutable core articles, as a JSON array.
3. `min_stake_wei` (int) — protocol-wide minimum required stake, in wei
   (0 disables the floor).

Confirm the exact `genlayer deploy` flag names and calldata-encoding
convention against your installed CLI's `--help` output before running this
— the CLI's argument-passing syntax has changed between releases and the
example above is illustrative of the argument **order and types**, not
necessarily the exact current flag spelling.

### 4. Fund your account

Make sure the deploying/calling account has enough test GEN to cover gas and
any stakes you intend to test with. Use the Studio faucet button or the
testnet faucet URL above.

## Verifying deployment succeeded

1. The `genlayer deploy` command's output includes a transaction hash and,
   once the transaction finalizes, a deployed **contract address**. Wait for
   the transaction status to reach a finalized/accepted state (GenLayer
   Studio's UI shows this in the transaction inspector).
2. Call a view method against the deployed address to confirm the bytecode
   is live and schema-readable, e.g.:
   ```bash
   genlayer call <CONTRACT_ADDRESS> get_protocol_config
   ```
   A successful call returning the JSON config object (owner, treasury
   address, fee settings, current constitution version) confirms the
   contract deployed correctly and did **not** produce a "could not load
   contract schema" error.
3. Also sanity-check `get_current_constitution_version` returns `1` and
   `get_constitution` (with no argument, or `version=1`) returns the
   articles you passed at deploy time.

## Obtaining the contract address

The contract address is emitted by the deployment transaction itself — it is
**not** predictable or invented ahead of time. Obtain it from:
- The `genlayer deploy` CLI output, or
- The GenLayer Studio UI's transaction/contract inspector after the deploy
  transaction finalizes.

**You (the user) must supply this address** to any application, script, or
documentation that references the deployed contract. Nothing in this
repository hard-codes or guesses a contract address.

## Interacting with the deployed contract

Reads work fine via the CLI: `genlayer call <address> <method> [--args ...]`.

**Writes to `@gl.public.write.payable` methods (`create_case`,
`fund_respondent_stake`, `file_appeal`) cannot be exercised via `genlayer
write` in CLI v0.39.2** — that subcommand hardcodes `value: 0n` internally
and has no `--value` flag, confirmed by reading the installed CLI's
source. To send a real payable transaction from a script (e.g. for
testing), use `genlayer-js` directly instead of the CLI:

```js
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const account = createAccount(privateKeyHex); // 0x-prefixed private key
const client = createClient({ chain: studionet, account });
const txHash = await client.writeContract({
  address: contractAddress,
  functionName: "create_case",
  args: [respondentAddress, title, claimText, stakeWei, evidenceWindowSeconds, joinWindowSeconds],
  value: stakeWei, // this is the part `genlayer write` can't do
});
const receipt = await client.waitForTransactionReceipt({ hash: txHash, retries: 120, interval: 3000 });
```

This is exactly what `frontend/lib/genlayer.ts` does with a browser wallet
provider, and what the project's real end-to-end lifecycle test did with a
Node-side private-key account instead — same underlying SDK call either
way. A `.json` keystore created via `genlayer account create` can be
decrypted to a raw private key with `ethers`'
`Wallet.fromEncryptedJson(json, password)` if you need to script against
an existing CLI-managed account rather than a fresh one.
