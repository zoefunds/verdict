# Contract tests

## What's covered

`test_verdict_parsing.py` unit-tests the deterministic, pure-Python logic
in `contracts/verdict_contract.py` — specifically the functions touched by
the 2026-08-25 external audit fixes:

- `_coerce_outcome` — regression tests proving malformed/hallucinated LLM
  output now raises (`ERR_LLM`) instead of silently resolving as
  `INCONCLUSIVE`.
- `_snap_to_settlement_band` / `_parse_verdict` — the discrete
  settlement-band snapping that replaced the old wide raw-bps tolerance.
- `_verdicts_agree` — the leader/validator equivalence check, confirming
  same-band agreement and different-band disagreement.

These run via `tests/contract/genlayer_stub.py`, a minimal stand-in for
the `genlayer` package (just enough for the module to import and these
pure functions to execute) — not a GenVM emulator.

Run with:

```bash
cd /Users/macbook/verdict
python3 -m pytest tests/contract/test_verdict_parsing.py -v
```

## What IS covered by real StudioNet transactions (not this suite — see below)

The nondet/escrow surface this suite explicitly doesn't cover was later
verified for real, against the live deployed v3 contract on StudioNet,
using two dedicated funded test accounts and `genlayer-js` directly (the
CLI's `write` subcommand can't send value with a payable call — see
`contracts/README.md` "Interacting with the deployed contract"). Every
method below reached `FINALIZED`/`MAJORITY_AGREE` consensus with zero
genuine GenVM errors, real GEN moved on settlement, and the resulting case
data was confirmed readable back from the contract:

`create_case` → `fund_respondent_stake` → `submit_evidence` →
`close_evidence_window_early` → `request_investigation` →
`render_verdict` (real LLM verdict, real evidence fetch, real hash
comparison) → `file_appeal` → `open_appeal_evidence_window` →
`resolve_appeal` (a genuinely different second verdict) → `settle_case`
(real fund movement, confirmed via before/after account balances).

Full write-up, including the exact consensus data observed for each call:
`docs/SECURITY.md` → "Live end-to-end lifecycle audit". This is NOT part
of this pytest suite — it was a one-off manual script-driven run against
real infrastructure, not something CI can currently repeat on demand (see
"What's still not automated" below).

## What's still not automated (would need a funded CI wallet / local GenVM)

- **`genvm-lint` static analysis** — the installed CLI version
  (`genlayer` v0.39.2) has no `genvm-lint` subcommand at all (checked
  `genlayer --help`: only `deploy/call/write/schema/code/receipt/trace/
  appeal/...` exist). Nothing to run even if wired into CI.
- **Local multi-validator GenVM simulator** (`genlayer up` / `genlayer
  init`) — this exists and doesn't need a funded StudioNet wallet, but
  does need a real LLM provider API key (OpenAI/Heurist/Gemini/XAI) for
  the validators' own `gl.nondet.exec_prompt` calls, configured during
  `genlayer init`'s interactive provider-selection step. Attempted once;
  blocked at that step with no key available in this environment. This is
  the most promising unclosed gap — it needs one API key, not new tooling.
- **A repeatable CI job** running the real end-to-end lifecycle above on
  every contract change — the one-off run that verified it needed a
  funded StudioNet wallet with real (test) GEN and took real wall-clock
  waiting for the contract's own timing windows (evidence deadlines,
  appeal windows) to close, neither of which fit a typical CI run without
  either a funded CI-dedicated wallet or a local GenVM simulator with
  fast-forwardable time.
- The SSRF guard in `backend/src/lib/safe-fetch.ts` was smoke-tested
  manually (a real public URL, `localhost`, `127.0.0.1`, `::1`, and a
  cloud-metadata address) during development — not yet wired into an
  automated backend test file.

Stated plainly rather than implied as done: the deterministic logic below
is unit-tested and passing, the full real-transaction lifecycle has been
verified live once by hand, but there is no repeatable automated
regression suite covering the nondet/escrow surface yet — a real gap, not
a hidden one.
