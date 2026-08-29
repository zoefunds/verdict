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

**v4 (current)** — `0x2BEe5eBb18c8E0D82E68Fc103fA68dfC0e876E58`. No
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

### 5.7 Non-deterministic verdict evaluation
The contract's entire nondeterministic surface area is two `@gl.public.write`
entrypoints: `render_verdict` and `resolve_appeal`, both routing through
`_run_verdict_judgment`. For every `URL`-kind evidence item, the leader *and*
every validator independently re-fetch the live page at verdict time via
`gl.nondet.web.render` — never trusting a cached snapshot from submission
time, so post-submission tampering is detectable. The LLM is asked to return
a small **structured** decision object — `outcome` enum (`CLAIMANT` /
`RESPONDENT` / `PARTIAL` / `INCONCLUSIVE`), `claimant_share_bps`,
`confidence_bps`, and a short `reasoning_summary` — and validator consensus
(`_verdicts_agree`) compares only the structured, economically-meaningful
fields with an explicit tolerance band, never exact-string equality on
prose. See the main report to the user for why this avoids `UNDETERMINED`
consensus / leader rotation.

### 5.8 Settlement
`settle_case` executes payout once a case reaches `FINAL`. Outcome →
payout mapping: `CLAIMANT`/`RESPONDENT` → full pot to the winner;
`PARTIAL` → proportional split by `verdict_split_bps`; `INCONCLUSIVE` → both
parties refunded their own stake. An optional protocol fee
(`protocol_fee_bps`, 0 by default, capped at 10%) is skimmed only from the
losing side's forfeited collateral, never from a winner's own reclaimed
stake.

### 5.9 Appeals
`file_appeal` (payable) — either party, once, within the fixed 7-day
`APPEAL_WINDOW`, posts an appeal bond (`appeal_bond_bps` of the total case
stake, exact-match enforced) and a required new-evidence note.
`open_appeal_evidence_window` briefly reopens evidence submission.
`resolve_appeal` triggers the second, final, independent re-evaluation; the
appeal bond is returned to the appellant if the appeal improved their
position, otherwise it is forfeited to treasury. No further appeals are
possible after this.

### 5.10 Abandonment / timeout recovery
`claim_case_abandonment` — covers every lifecycle stage where a counterparty
could go silent (respondent never funds; evidence window closes but nobody
requests investigation or renders a verdict; an appeal is filed but never
carried through to resolution). Each check is `deadline + a grace period`
and only ever releases the caller's **own** deposited funds — this is the
"never permanently stuck" guarantee. `sweep_treasury` (owner-gated) pulls
any residual accrued treasury balance.

### 5.11 Views
`get_case`, `get_case_count`, `get_case_evidence_ids`, `get_evidence`,
`get_case_rules`, `get_constitution` (by version), `get_current_constitution_version`,
`get_case_events` (append-only per-case activity log), `get_protocol_config`,
`get_metrics`.

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
