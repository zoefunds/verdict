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

## What's NOT covered here (needs the real GenLayer CLI / StudioNet)

- `genvm-lint` static analysis of the contract.
- Any nondet code path: `gl.nondet.exec_prompt`, `gl.nondet.web.render`,
  `gl.vm.run_nondet_unsafe` leader/validator execution against a real
  GenVM runner.
- The escrow zero-then-transfer payout paths (`create_case`,
  `fund_respondent_stake`, `settle_case`, `resolve_appeal`,
  `claim_case_abandonment`) — these need `gl.message.value` /
  `gl.message.sender_address` and real GEN transfers, which only exist
  inside a real GenVM execution context.
- Full appeal-lifecycle and abandonment-recovery integration tests against
  a live or local StudioNet-equivalent node.
- The SSRF guard in `backend/src/lib/safe-fetch.ts` was smoke-tested
  manually (a real public URL, `localhost`, and a cloud-metadata address)
  during development — not yet wired into an automated backend test file.

The GenLayer CLI (`genlayer`, `genvm-lint`) is not installed in this
development environment. Before treating this contract as fully verified,
run against the real tooling:

```bash
genvm-lint check contracts/verdict_contract.py --json
# and whatever direct/integration test workflow `genlayer` provides for
# your installed CLI version — check `genlayer --help` for the current
# subcommand, since this has changed across CLI releases (see
# contracts/README.md's existing caveat about not guessing exact CLI
# flags).
```

This is stated plainly rather than implied as done: the audit that
prompted these fixes specifically called out "no recorded genvm-lint or
genlayer-test results" as a gap, and that gap is only partially closed —
the deterministic logic is now unit-tested and passing; the GenVM-specific
surface still needs to be run through the real tooling by whoever has it
installed.
