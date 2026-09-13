# Contract tests

## What's covered

`test_verdict_parsing.py` unit-tests the deterministic, pure-Python logic
in `contracts/verdict_contract.py` — 37 tests total, covering:

- `_coerce_outcome` — regression tests proving malformed/hallucinated LLM
  output now raises (`ERR_LLM`) instead of silently resolving as
  `INCONCLUSIVE` (2026-08-25 external audit fix).
- `_snap_to_settlement_band` / `_parse_verdict` — the discrete
  settlement-band snapping that replaced the old wide raw-bps tolerance
  (2026-08-25 external audit fix).
- `_verdicts_agree` — the leader/validator equivalence check on the
  economic layer (outcome/split/confidence), confirming same-band
  agreement and different-band disagreement.
- **Structured, evidence-linked verdict layer** (2026-09-12, see
  `contracts/README.md` section 5.7): `claim_findings` and
  `evidence_findings` parsing/validation — missing/empty/malformed claim
  findings raise `ERR_LLM`; incomplete `evidence_findings` coverage
  (omitting a real evidence id) is rejected, not accepted because it
  superficially looks right; both object- and array-shaped
  `evidence_findings` input parse identically (LLMs are inconsistent
  about which); the zero-evidence case requires no findings map at all.
- `_evidence_findings_agree` — the new equivalence layer requiring
  leader/validator agreement on per-evidence-id determinations, not just
  the economic outcome: identical maps agree, disagreeing-on-which-
  evidence-matters correctly fails even with the same economic outcome,
  and the documented one-mismatch-above-two-items tolerance boundary is
  tested in both directions.

These run via `tests/contract/genlayer_stub.py`, a minimal stand-in for
the `genlayer` package (just enough for the module to import and these
pure functions to execute) — not a GenVM emulator. `genvm-lint` (see
below) covers real GenVM-specific structural validation that this stub
cannot.

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
`docs/SECURITY.md` → "Live end-to-end lifecycle audit", "Multi-product
live lifecycle audit", and "v5 contract: 2-test round" — three full live
testing rounds across three contract deployments so far, each covering
every non-admin method with real, detailed dispute scenarios. This is
NOT part of this pytest suite — it's one-off manual script-driven runs
against real infrastructure, not something CI can currently repeat on
demand (see "What's still not automated" below). The most recent round
was also the first live confirmation that the structured, evidence-linked
verdict architecture (`claim_findings`/`evidence_findings` — see
`contracts/README.md` section 5.7) actually works against a real model,
not just the unit tests below.

## What IS automated: `genvm-lint`

Unlike an earlier note in this file claimed, `genvm-lint` is real,
separately installable (`pip install genvm-linter` — a real PyPI package,
distinct from `genlayer-test`), and is wired into
`.github/workflows/ci.yml`, running on every PR alongside this pytest
suite:

```bash
genvm-lint check contracts/verdict_contract.py --json
```

It validates GenVM-specific structural rules this pytest suite's stub
`genlayer` module cannot check — it caught a real one during development:
a contract method declared `@staticmethod` failed lint with "must have
'self' as first parameter," a GenVM-specific convention plain Python
doesn't enforce.

## What's still not automated (would need a funded CI wallet / local GenVM)

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
