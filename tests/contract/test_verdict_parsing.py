"""
Unit tests for the deterministic, pure-Python verdict-parsing and
equivalence logic in contracts/verdict_contract.py — specifically the
functions touched by the 2026-08-25 external audit fixes:

  - _coerce_outcome:            must now RAISE on unmappable output
                                 instead of silently defaulting to
                                 INCONCLUSIVE (audit finding #1)
  - _snap_to_settlement_band:   discrete payout bands (audit finding #2)
  - _parse_verdict:             end-to-end structured-output parsing,
                                 including the new band-snap
  - _verdicts_agree:            leader/validator equivalence check, now
                                 backed by band-snapped values

These are pure functions with no I/O and no GenVM dependency, so they're
tested directly via genlayer_stub.py rather than requiring a real GenVM
runtime. What this suite does NOT cover (needs the real GenLayer CLI /
StudioNet, not available in this environment): nondet LLM/web-fetch
behavior, the escrow zero-then-transfer payout paths, and full
consensus/leader-rotation behavior end to end. See README.md in this
directory.

Run with:
    cd /Users/macbook/verdict
    python3 -m pytest tests/contract/test_verdict_parsing.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "contracts"))

import genlayer_stub  # noqa: E402

genlayer_stub.install()

import pytest  # noqa: E402
from genlayer import gl  # noqa: E402
import verdict_contract as vc  # noqa: E402


# ---------------------------------------------------------------------------
# _coerce_outcome — audit finding #1 regression tests
# ---------------------------------------------------------------------------


def test_coerce_outcome_accepts_exact_values():
    assert vc._coerce_outcome("CLAIMANT") == vc.OUTCOME_CLAIMANT
    assert vc._coerce_outcome("RESPONDENT") == vc.OUTCOME_RESPONDENT
    assert vc._coerce_outcome("PARTIAL") == vc.OUTCOME_PARTIAL
    assert vc._coerce_outcome("INCONCLUSIVE") == vc.OUTCOME_INCONCLUSIVE


def test_coerce_outcome_accepts_known_aliases_and_casing():
    assert vc._coerce_outcome("claimant wins") == vc.OUTCOME_CLAIMANT
    assert vc._coerce_outcome("Respondent-Prevails") == vc.OUTCOME_RESPONDENT
    assert vc._coerce_outcome("split") == vc.OUTCOME_PARTIAL
    assert vc._coerce_outcome("insufficient evidence") == vc.OUTCOME_INCONCLUSIVE


def test_coerce_outcome_raises_on_unmappable_string():
    """The core audit-fix regression test: a hallucinated/garbage outcome
    must raise ERR_LLM, not silently become INCONCLUSIVE. Before the fix,
    this assertion would have failed (the old code returned
    OUTCOME_INCONCLUSIVE here instead of raising)."""
    with pytest.raises(gl.vm.UserError) as exc_info:
        vc._coerce_outcome("THE_MOON_IS_MADE_OF_CHEESE")
    assert exc_info.value.message.startswith(vc.ERR_LLM)


def test_coerce_outcome_raises_on_non_string():
    with pytest.raises(gl.vm.UserError) as exc_info:
        vc._coerce_outcome(None)
    assert exc_info.value.message.startswith(vc.ERR_LLM)

    with pytest.raises(gl.vm.UserError):
        vc._coerce_outcome(42)


# ---------------------------------------------------------------------------
# _snap_to_settlement_band — audit finding #2
# ---------------------------------------------------------------------------


def test_snap_to_settlement_band_exact_matches():
    for band in vc.SETTLEMENT_BANDS_BPS:
        assert vc._snap_to_settlement_band(band) == band


def test_snap_to_settlement_band_rounds_to_nearest():
    # Halfway between 4000 and 5000 is 4500 — nearest band per min() with
    # ties broken toward the first-encountered minimum, i.e. 4000.
    assert vc._snap_to_settlement_band(4200) == 4000
    assert vc._snap_to_settlement_band(4800) == 5000
    assert vc._snap_to_settlement_band(9800) == 9000
    assert vc._snap_to_settlement_band(600) == 1000


def test_snap_to_settlement_band_two_close_llm_outputs_collapse_together():
    """The whole point of banding: two independent LLM calls that land
    close but not identical (e.g. 7420 vs 7480) must snap to the SAME
    band, making leader/validator agreement exact rather than merely
    within a wide tolerance."""
    assert vc._snap_to_settlement_band(7420) == vc._snap_to_settlement_band(7480) == 7500


# ---------------------------------------------------------------------------
# _parse_verdict — end to end
# ---------------------------------------------------------------------------


def test_parse_verdict_claimant_full_share():
    result = vc._parse_verdict('{"outcome": "CLAIMANT", "confidence_bps": 8000, "reasoning_summary": "clear evidence"}')
    assert result["outcome"] == vc.OUTCOME_CLAIMANT
    assert result["verdict_split_bps"] == vc.BPS_DENOMINATOR
    assert result["confidence_bps"] == 8000


def test_parse_verdict_respondent_zero_share():
    result = vc._parse_verdict('{"outcome": "RESPONDENT", "confidence_bps": 7000}')
    assert result["outcome"] == vc.OUTCOME_RESPONDENT
    assert result["verdict_split_bps"] == 0


def test_parse_verdict_partial_snaps_to_band():
    result = vc._parse_verdict('{"outcome": "PARTIAL", "claimant_share_bps": 7420, "confidence_bps": 5500}')
    assert result["outcome"] == vc.OUTCOME_PARTIAL
    assert result["verdict_split_bps"] == 7500  # snapped, not the raw 7420


def test_parse_verdict_malformed_json_raises():
    with pytest.raises(gl.vm.UserError) as exc_info:
        vc._parse_verdict("this is not json at all {{{")
    assert exc_info.value.message.startswith(vc.ERR_LLM)


def test_parse_verdict_non_object_json_raises():
    with pytest.raises(gl.vm.UserError):
        vc._parse_verdict("[1, 2, 3]")


def test_parse_verdict_hallucinated_outcome_raises_not_silently_inconclusive():
    """Full-pipeline regression test for audit finding #1: valid JSON with
    a nonsense outcome value must raise, not resolve as INCONCLUSIVE."""
    with pytest.raises(gl.vm.UserError):
        vc._parse_verdict('{"outcome": "MAYBE_BOTH_IDK", "confidence_bps": 5000}')


def test_parse_verdict_reasoning_is_truncated():
    long_reasoning = "x" * (vc.MAX_REASONING_STORED + 500)
    result = vc._parse_verdict(f'{{"outcome": "INCONCLUSIVE", "reasoning_summary": "{long_reasoning}"}}')
    assert len(result["reasoning_summary"]) <= vc.MAX_REASONING_STORED


# ---------------------------------------------------------------------------
# _verdicts_agree — leader/validator equivalence
# ---------------------------------------------------------------------------


def _agree(leader, validator):
    # _verdicts_agree doesn't touch `self` at all — safe to call unbound.
    return vc.Verdict._verdicts_agree(None, leader, validator)


def test_verdicts_agree_identical_claimant():
    d = {"outcome": vc.OUTCOME_CLAIMANT, "verdict_split_bps": 10000, "confidence_bps": 8000}
    assert _agree(d, dict(d)) is True


def test_verdicts_disagree_on_different_outcome():
    leader = {"outcome": vc.OUTCOME_CLAIMANT, "verdict_split_bps": 10000, "confidence_bps": 8000}
    validator = {"outcome": vc.OUTCOME_RESPONDENT, "verdict_split_bps": 0, "confidence_bps": 8000}
    assert _agree(leader, validator) is False


def test_verdicts_agree_partial_same_band():
    leader = {"outcome": vc.OUTCOME_PARTIAL, "verdict_split_bps": 7500, "confidence_bps": 5000}
    validator = {"outcome": vc.OUTCOME_PARTIAL, "verdict_split_bps": 7500, "confidence_bps": 5200}
    assert _agree(leader, validator) is True


def test_verdicts_disagree_partial_different_bands_beyond_tolerance():
    """Audit finding #2 regression: bands 4000 vs 7500 are 3500 bps apart
    — far beyond even the OLD 1500 bps tolerance, must disagree."""
    leader = {"outcome": vc.OUTCOME_PARTIAL, "verdict_split_bps": 4000, "confidence_bps": 5000}
    validator = {"outcome": vc.OUTCOME_PARTIAL, "verdict_split_bps": 7500, "confidence_bps": 5000}
    assert _agree(leader, validator) is False


def test_verdicts_disagree_on_confidence_beyond_tolerance():
    leader = {"outcome": vc.OUTCOME_CLAIMANT, "verdict_split_bps": 10000, "confidence_bps": 9000}
    validator = {"outcome": vc.OUTCOME_CLAIMANT, "verdict_split_bps": 10000, "confidence_bps": 1000}
    assert _agree(leader, validator) is False


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
