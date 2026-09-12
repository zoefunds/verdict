# Reproducible StudioNet verification harness

`lifecycle_demo.mjs` runs a real, complete dispute lifecycle against the
deployed VERDICT contract: case creation with real escrowed collateral,
independent evidence submission from both sides with **materially
conflicting accounts**, a real GenVM consensus verdict, a real appeal with
new evidence, a second consensus verdict, and a real settlement that moves
GEN. Nothing here is mocked or simulated.

## Why this isn't part of CI

It needs two real, funded StudioNet private keys, and the contract
enforces a genuine on-chain 1-hour minimum on evidence/re-investigation
windows (see `docs/SECURITY.md` "Real timing constraints discovered") —
this script actually waits that out, it doesn't fake or skip it. Wiring
funded keys into an automated CI run would mean secrets in CI and a
~10-15 minute mandatory wait on every run, neither of which belongs in a
PR gate. Run it by hand, on demand, whenever you want to re-verify the
deployed contract end to end with a fresh, real transaction trail.

## Running it

```bash
cd backend && npm install   # provides genlayer-js
cd ../..
VERDICT_CONTRACT_ADDRESS=0x... \
CLAIMANT_PRIVATE_KEY=0x... \
RESPONDENT_PRIVATE_KEY=0x... \
node scripts/verification/lifecycle_demo.mjs
```

Both keys need real StudioNet test GEN (StudioNet is GenLayer's
development network — GEN there is test currency with no real value, not
mainnet funds). To get a key from an existing `genlayer account create`d
keystore:

```js
import { Wallet } from "ethers";
const wallet = await Wallet.fromEncryptedJson(
  require("fs").readFileSync("~/.genlayer/keystores/<name>.json", "utf8"),
  "<password>",
);
console.log(wallet.privateKey);
```

**Never commit these keys, and never wire them into CI or any automated
pipeline.**

## What a successful run demonstrates

- `create_case` / `fund_respondent_stake` — real escrow, both sides.
- `add_case_rule` — a case-specific rule that reaches the verdict prompt.
- `submit_evidence` — two directly conflicting accounts, one per side.
- `request_investigation` / `render_verdict` — a real GenVM consensus
  verdict, printed in full including the structured `claim_findings` and
  `evidence_findings` (see `docs/SECURITY.md` "Structured, evidence-linked
  verdict architecture") — not just an outcome label.
- `file_appeal` / `open_appeal_evidence_window` — a real appeal with new
  evidence specifically responding to the first verdict's reasoning.
- `resolve_appeal` — a second, independent, final verdict.
- `settle_case` — a real GEN transfer, confirmed via the final case state.

Every write logs its transaction hash and consensus result
(`statusName`/`result_name`) — cross-check any of them directly on the
GenLayer Studio explorer to verify independently of this script's own
output.
