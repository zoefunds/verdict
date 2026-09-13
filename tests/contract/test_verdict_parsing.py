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


CLAIM_FINDINGS_JSON = '"claim_findings": [{"claim": "did respondent breach the agreement", "determination": "SUPPORTED_CLAIMANT", "evidence_ids": []}]'


def test_parse_verdict_claimant_full_share():
    result = vc._parse_verdict(
        '{"outcome": "CLAIMANT", "confidence_bps": 8000, "reasoning_summary": "clear evidence", ' + CLAIM_FINDINGS_JSON + "}"
    )
    assert result["outcome"] == vc.OUTCOME_CLAIMANT
    assert result["verdict_split_bps"] == vc.BPS_DENOMINATOR
    assert result["confidence_bps"] == 8000


def test_parse_verdict_respondent_zero_share():
    result = vc._parse_verdict('{"outcome": "RESPONDENT", "confidence_bps": 7000, ' + CLAIM_FINDINGS_JSON + "}")
    assert result["outcome"] == vc.OUTCOME_RESPONDENT
    assert result["verdict_split_bps"] == 0


def test_parse_verdict_partial_snaps_to_band():
    result = vc._parse_verdict(
        '{"outcome": "PARTIAL", "claimant_share_bps": 7420, "confidence_bps": 5500, ' + CLAIM_FINDINGS_JSON + "}"
    )
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
        vc._parse_verdict('{"outcome": "MAYBE_BOTH_IDK", "confidence_bps": 5000, ' + CLAIM_FINDINGS_JSON + "}")


def test_parse_verdict_reasoning_is_truncated():
    long_reasoning = "x" * (vc.MAX_REASONING_STORED + 500)
    result = vc._parse_verdict(
        f'{{"outcome": "INCONCLUSIVE", "reasoning_summary": "{long_reasoning}", ' + CLAIM_FINDINGS_JSON + "}"
    )
    assert len(result["reasoning_summary"]) <= vc.MAX_REASONING_STORED


# ---------------------------------------------------------------------------
# _parse_verdict — structured claim/evidence findings (evidence-linked
# verdict architecture: claim-by-claim findings, cited evidence ids,
# an explicit insufficient-evidence route, malformed structure rejected)
# ---------------------------------------------------------------------------


def test_parse_verdict_missing_claim_findings_raises():
    """A verdict with no claim_findings at all is exactly the 'outcome +
    freeform prose, no structure' shape this architecture replaces — must
    be rejected as malformed, not silently accepted."""
    with pytest.raises(gl.vm.UserError) as exc_info:
        vc._parse_verdict('{"outcome": "CLAIMANT", "confidence_bps": 8000}')
    assert exc_info.value.message.startswith(vc.ERR_LLM)


def test_parse_verdict_empty_claim_findings_array_raises():
    with pytest.raises(gl.vm.UserError):
        vc._parse_verdict('{"outcome": "CLAIMANT", "confidence_bps": 8000, "claim_findings": []}')


def test_parse_verdict_claim_findings_invalid_determination_raises():
    bad = '{"outcome": "CLAIMANT", "confidence_bps": 8000, "claim_findings": [{"claim": "x", "determination": "MAYBE"}]}'
    with pytest.raises(gl.vm.UserError) as exc_info:
        vc._parse_verdict(bad)
    assert exc_info.value.message.startswith(vc.ERR_LLM)


def test_parse_verdict_claim_findings_missing_claim_text_raises():
    bad = '{"outcome": "CLAIMANT", "confidence_bps": 8000, "claim_findings": [{"determination": "SUPPORTED_CLAIMANT"}]}'
    with pytest.raises(gl.vm.UserError):
        vc._parse_verdict(bad)


def test_parse_verdict_insufficient_evidence_is_a_legitimate_claim_finding():
    """The explicit 'insufficient evidence' route — a claim can be
    resolved INSUFFICIENT without that being treated as an error."""
    payload = (
        '{"outcome": "INCONCLUSIVE", "confidence_bps": 4000, '
        '"claim_findings": [{"claim": "was the item defective", "determination": "INSUFFICIENT", "evidence_ids": []}]}'
    )
    result = vc._parse_verdict(payload)
    assert result["claim_findings"][0]["determination"] == vc.CLAIM_FINDING_INSUFFICIENT


def test_parse_verdict_evidence_findings_required_when_evidence_exists():
    """When the case actually has evidence, omitting evidence_findings
    entirely is malformed — the structure must cover real evidence, not
    just claims in the abstract."""
    payload = '{"outcome": "CLAIMANT", "confidence_bps": 8000, ' + CLAIM_FINDINGS_JSON + "}"
    with pytest.raises(gl.vm.UserError) as exc_info:
        vc._parse_verdict(payload, evidence_ids=[1, 2])
    assert exc_info.value.message.startswith(vc.ERR_LLM)


def test_parse_verdict_evidence_findings_must_cover_every_evidence_id():
    """Covering SOME but not all evidence ids is rejected — this is the
    'not merely JSON shape' requirement: a same-shaped-but-incomplete
    findings object is treated as malformed, not accepted because it
    superficially looks right."""
    payload = (
        '{"outcome": "CLAIMANT", "confidence_bps": 8000, '
        + CLAIM_FINDINGS_JSON
        + ', "evidence_findings": {"1": "SUPPORTS_CLAIMANT"}}'
    )
    with pytest.raises(gl.vm.UserError):
        vc._parse_verdict(payload, evidence_ids=[1, 2])


def test_parse_verdict_evidence_findings_rejects_unmappable_determination():
    payload = (
        '{"outcome": "CLAIMANT", "confidence_bps": 8000, '
        + CLAIM_FINDINGS_JSON
        + ', "evidence_findings": {"1": "MAYBE_KINDA"}}'
    )
    with pytest.raises(gl.vm.UserError) as exc_info:
        vc._parse_verdict(payload, evidence_ids=[1])
    assert exc_info.value.message.startswith(vc.ERR_LLM)


def test_parse_verdict_evidence_findings_accepts_full_valid_coverage():
    payload = (
        '{"outcome": "PARTIAL", "claimant_share_bps": 6000, "confidence_bps": 7000, '
        + CLAIM_FINDINGS_JSON
        + ', "evidence_findings": {"1": "SUPPORTS_CLAIMANT", "2": "CONTRADICTS_CLAIMANT", "3": "IRRELEVANT"}}'
    )
    result = vc._parse_verdict(payload, evidence_ids=[1, 2, 3])
    assert result["evidence_findings"] == {
        "1": vc.FINDING_SUPPORTS_CLAIMANT,
        "2": vc.FINDING_CONTRADICTS_CLAIMANT,
        "3": vc.FINDING_IRRELEVANT,
    }


def test_parse_verdict_evidence_findings_accepts_array_shape():
    """LLMs are inconsistent about object-vs-array for id-keyed data —
    both shapes must parse to the same normalized result."""
    payload = (
        '{"outcome": "CLAIMANT", "confidence_bps": 8000, '
        + CLAIM_FINDINGS_JSON
        + ', "evidence_findings": [{"evidence_id": 1, "determination": "SUPPORTS_CLAIMANT"}]}'
    )
    result = vc._parse_verdict(payload, evidence_ids=[1])
    assert result["evidence_findings"] == {"1": vc.FINDING_SUPPORTS_CLAIMANT}


def test_parse_verdict_no_evidence_ids_skips_evidence_findings_requirement():
    """A case with no submitted evidence has nothing to classify —
    evidence_findings should not be required in that situation."""
    payload = '{"outcome": "INCONCLUSIVE", "confidence_bps": 3000, ' + CLAIM_FINDINGS_JSON + "}"
    result = vc._parse_verdict(payload, evidence_ids=[])
    assert result["evidence_findings"] == {}


# ---------------------------------------------------------------------------
# _parse_claim_findings — cited evidence_ids must be real for the case
# (re-audit finding, 2026-09-13: a claim could previously cite a
# fabricated or out-of-case evidence id with no validation at all)
# ---------------------------------------------------------------------------


def test_parse_verdict_claim_findings_rejects_fabricated_evidence_id():
    payload = (
        '{"outcome": "CLAIMANT", "confidence_bps": 8000, '
        '"claim_findings": [{"claim": "x", "determination": "SUPPORTED_CLAIMANT", "evidence_ids": [99]}]}'
    )
    with pytest.raises(gl.vm.UserError) as exc_info:
        vc._parse_verdict(payload, evidence_ids=[1, 2, 3])
    assert exc_info.value.message.startswith(vc.ERR_LLM)
    assert "99" in exc_info.value.message


def test_parse_verdict_claim_findings_accepts_real_evidence_ids():
    payload = (
        '{"outcome": "CLAIMANT", "confidence_bps": 8000, '
        '"claim_findings": [{"claim": "x", "determination": "SUPPORTED_CLAIMANT", "evidence_ids": [1, 3]}], '
        '"evidence_findings": {"1": "SUPPORTS_CLAIMANT", "2": "IRRELEVANT", "3": "SUPPORTS_CLAIMANT"}}'
    )
    result = vc._parse_verdict(payload, evidence_ids=[1, 2, 3])
    assert result["claim_findings"][0]["evidence_ids"] == [1, 3]


def test_parse_verdict_claim_findings_rejects_evidence_id_when_case_has_none():
    """A case with zero submitted evidence has no valid ids to cite at
    all — citing any id is fabrication."""
    payload = (
        '{"outcome": "INCONCLUSIVE", "confidence_bps": 3000, '
        '"claim_findings": [{"claim": "x", "determination": "INSUFFICIENT", "evidence_ids": [0]}]}'
    )
    with pytest.raises(gl.vm.UserError):
        vc._parse_verdict(payload, evidence_ids=[])


def test_parse_verdict_claim_findings_rejects_non_integer_evidence_id():
    payload = (
        '{"outcome": "CLAIMANT", "confidence_bps": 8000, '
        '"claim_findings": [{"claim": "x", "determination": "SUPPORTED_CLAIMANT", "evidence_ids": ["not-an-id"]}]}'
    )
    with pytest.raises(gl.vm.UserError) as exc_info:
        vc._parse_verdict(payload, evidence_ids=[1, 2])
    assert exc_info.value.message.startswith(vc.ERR_LLM)


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


# ---------------------------------------------------------------------------
# _verdicts_agree / _evidence_findings_agree — substantive findings
# equivalence (validators must recompute and compare more than just the
# economic outcome — see the module-level FINDING_* docstring)
# ---------------------------------------------------------------------------


def _base(evidence_findings):
    return {"outcome": vc.OUTCOME_CLAIMANT, "verdict_split_bps": 10000, "confidence_bps": 8000, "evidence_findings": evidence_findings}


def test_verdicts_agree_when_evidence_findings_identical():
    d = _base({"1": vc.FINDING_SUPPORTS_CLAIMANT, "2": vc.FINDING_IRRELEVANT})
    assert _agree(d, dict(d)) is True


def test_verdicts_disagree_same_outcome_but_findings_disagree_on_which_evidence_matters():
    """The critical new behavior: leader and validator agree on the
    economic outcome (CLAIMANT, full share) but disagree about WHY — one
    thinks evidence #1 supports the claimant, the other thinks it
    contradicts them. Same outcome label must NOT be enough for
    consensus here."""
    leader = _base({"1": vc.FINDING_SUPPORTS_CLAIMANT, "2": vc.FINDING_SUPPORTS_CLAIMANT})
    validator = _base({"1": vc.FINDING_CONTRADICTS_CLAIMANT, "2": vc.FINDING_SUPPORTS_CLAIMANT})
    assert _agree(leader, validator) is False


def test_verdicts_agree_tolerates_mismatch_between_two_non_decisive_labels():
    """AUDIT FIX (re-audit, 2026-09-13): the ONLY tolerated mismatch is
    between two non-decisive labels (INSUFFICIENT vs IRRELEVANT) — both
    mean "this item doesn't decide anything," just for different reasons.
    This is a deterministic rule about WHAT the labels mean, not a count-
    based tolerance, so it applies the same way regardless of how many
    evidence items exist."""
    leader = _base({"1": vc.FINDING_SUPPORTS_CLAIMANT, "2": vc.FINDING_IRRELEVANT, "3": vc.FINDING_IRRELEVANT})
    validator = _base({"1": vc.FINDING_SUPPORTS_CLAIMANT, "2": vc.FINDING_INSUFFICIENT, "3": vc.FINDING_IRRELEVANT})
    assert _agree(leader, validator) is True


def test_verdicts_disagree_on_any_decisive_mismatch_no_matter_how_few():
    """A single mismatch on a DECISIVE finding is never tolerated, even
    when every other item agrees — this is the "robust validation" bar:
    no numeric-count tolerance ever lets a decisive disagreement pass."""
    leader = _base(
        {"1": vc.FINDING_SUPPORTS_CLAIMANT, "2": vc.FINDING_SUPPORTS_CLAIMANT, "3": vc.FINDING_IRRELEVANT, "4": vc.FINDING_IRRELEVANT}
    )
    validator = _base(
        {"1": vc.FINDING_SUPPORTS_CLAIMANT, "2": vc.FINDING_INSUFFICIENT, "3": vc.FINDING_IRRELEVANT, "4": vc.FINDING_IRRELEVANT}
    )
    assert _agree(leader, validator) is False  # item 2: SUPPORTS_CLAIMANT vs INSUFFICIENT — decisive mismatch


def test_verdicts_disagree_on_multiple_decisive_mismatches():
    leader = _base({"1": vc.FINDING_SUPPORTS_CLAIMANT, "2": vc.FINDING_SUPPORTS_CLAIMANT, "3": vc.FINDING_IRRELEVANT})
    validator = _base({"1": vc.FINDING_CONTRADICTS_CLAIMANT, "2": vc.FINDING_INSUFFICIENT, "3": vc.FINDING_IRRELEVANT})
    assert _agree(leader, validator) is False


def test_verdicts_disagree_no_tolerance_at_two_items_or_fewer():
    leader = _base({"1": vc.FINDING_SUPPORTS_CLAIMANT, "2": vc.FINDING_SUPPORTS_CLAIMANT})
    validator = _base({"1": vc.FINDING_SUPPORTS_CLAIMANT, "2": vc.FINDING_INSUFFICIENT})
    assert _agree(leader, validator) is False  # item 2 is a decisive-vs-non-decisive mismatch


def test_verdicts_disagree_on_which_evidence_ids_exist():
    leader = _base({"1": vc.FINDING_SUPPORTS_CLAIMANT})
    validator = _base({"2": vc.FINDING_SUPPORTS_CLAIMANT})
    assert _agree(leader, validator) is False


def test_verdicts_agree_with_no_evidence_findings_at_all():
    """A case with no submitted evidence — nothing to compare, must not
    block agreement on the economic outcome."""
    leader = _base({})
    validator = _base({})
    assert _agree(leader, validator) is True


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
