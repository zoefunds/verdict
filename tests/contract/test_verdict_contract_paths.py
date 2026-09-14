"""
Focused regression tests for the re-audit findings (2026-09-14):

  - Treasury double-payment: settle_case's protocol-fee path and
    resolve_appeal's forfeited-bond path must never credit
    accrued_treasury_wei for an amount they also _send_gen directly, or
    sweep_treasury could pay the same funds out a second time.
  - Abandonment deadline: file_appeal must reset case.evidence_deadline
    so claim_case_abandonment's APPEALED/RE_INVESTIGATION grace-period
    check measures time since the appeal was filed, not since the
    unrelated original evidence window.

Unlike test_verdict_parsing.py (which tests pure module-level functions),
these tests instantiate the real `Verdict` contract class against
genlayer_stub.py's working TreeMap/message-context stub and call its
actual `@gl.public.write` methods — still not a real GenVM (nondet LLM
calls are monkeypatched to a canned response, per-test), but real enough
to exercise the actual storage mutations and _send_gen call sequence
these bugs live in, which pure-function tests cannot reach.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "contracts"))

import genlayer_stub  # noqa: E402

genlayer_stub.install()

import pytest  # noqa: E402
from genlayer import gl  # noqa: E402
import verdict_contract as vc  # noqa: E402

TREASURY = "0xTREASURY"
CLAIMANT = "0xCLAIMANT"
RESPONDENT = "0xRESPONDENT"
OWNER = "0xOWNER"


@pytest.fixture
def instance():
    """A freshly-deployed Verdict instance, owner=OWNER."""
    gl.message.sender_address = OWNER
    gl.message.value = 0
    inst = vc.Verdict(TREASURY, ["Core article one."], 0)
    return inst


@pytest.fixture
def send_gen_spy(monkeypatch):
    """Records every _send_gen(to_address, amount) call without touching
    the real GenVM emission machinery (genlayer_stub.py's gl.evm stub
    can't actually synthesize a working _Recipient proxy)."""
    calls = []
    monkeypatch.setattr(vc, "_send_gen", lambda to_address, amount: calls.append((to_address, int(amount))))
    return calls


def _make_case(instance_, case_id=0, **overrides):
    """Builds and inserts a full Case with sensible defaults + overrides —
    bypasses create_case/fund_respondent_stake entirely so each test can
    set up exactly the state it needs to exercise one specific path."""
    now = instance_._now_ts()
    defaults = dict(
        id=case_id,
        claimant=CLAIMANT,
        respondent=RESPONDENT,
        title="Test case",
        claim_text="A test claim.",
        constitution_version=1,
        status=vc.STATUS_FINAL,
        created_at=now,
        respondent_join_deadline=now,
        evidence_deadline=now,
        appeal_deadline=now,
        required_stake_wei=1_000_000,
        claimant_stake_wei=1_000_000,
        respondent_stake_wei=1_000_000,
        evidence_count=0,
        rule_count=0,
        outcome=vc.OUTCOME_CLAIMANT,
        verdict_split_bps=0,
        confidence_bps=8000,
        reasoning_summary="",
        claim_findings_json="",
        evidence_findings_json="",
        verdict_rendered_at=now,
        verdict_count=1,
        appeal_used=False,
        appeal_bond_wei=0,
        appellant=vc._zero_address(),
        appeal_new_evidence_note="",
        settled=False,
        treasury_credit_wei=0,
    )
    defaults.update(overrides)
    instance_.cases[case_id] = vc.Case(**defaults)
    if case_id >= int(instance_.case_count):
        instance_.case_count = case_id + 1
    return case_id


# ---------------------------------------------------------------------------
# Treasury double-payment (settle_case's protocol fee path)
# ---------------------------------------------------------------------------


def test_settle_case_fee_does_not_double_credit_treasury(instance, send_gen_spy):
    instance.protocol_fee_bps = 1000  # 10% fee on the losing side's forfeited collateral
    case_id = _make_case(
        instance,
        outcome=vc.OUTCOME_CLAIMANT,  # respondent's full stake is forfeited
        claimant_stake_wei=1_000_000,
        respondent_stake_wei=1_000_000,
    )

    instance.settle_case(case_id)

    # The fee must have been sent directly to treasury...
    treasury_sends = [amt for (to, amt) in send_gen_spy if to == TREASURY]
    assert len(treasury_sends) == 1
    assert treasury_sends[0] > 0

    # ...and must NOT also have been credited to accrued_treasury_wei —
    # crediting it here (on top of the direct send above) is exactly what
    # let sweep_treasury pay the same fee out a second time.
    assert int(instance.accrued_treasury_wei) == 0

    # The per-case audit record still reflects the real fee amount —
    # this field is display-only and was never the source of the bug.
    case = instance._get_case(case_id)
    assert int(case.treasury_credit_wei) == treasury_sends[0]


def test_settle_case_inconclusive_never_touches_treasury(instance, send_gen_spy):
    """No fee is owed on a full-refund outcome — nothing should ever be
    sent to or credited toward treasury."""
    instance.protocol_fee_bps = 1000
    case_id = _make_case(instance, outcome=vc.OUTCOME_INCONCLUSIVE)

    instance.settle_case(case_id)

    assert all(to != TREASURY for (to, _amt) in send_gen_spy)
    assert int(instance.accrued_treasury_wei) == 0


def test_sweep_treasury_cannot_pay_out_funds_settle_case_already_sent(instance, send_gen_spy):
    """End-to-end proof, not just an internal-state assertion: after a fee
    is collected via settle_case, the owner immediately trying to sweep
    the same amount must find nothing left to sweep."""
    instance.protocol_fee_bps = 1000
    case_id = _make_case(instance, outcome=vc.OUTCOME_CLAIMANT)
    instance.settle_case(case_id)

    gl.message.sender_address = OWNER
    with pytest.raises(gl.vm.UserError) as exc_info:
        instance.sweep_treasury(1)
    assert "exceeds accrued treasury balance" in exc_info.value.message


# ---------------------------------------------------------------------------
# Treasury double-payment (resolve_appeal's forfeited-bond path)
# ---------------------------------------------------------------------------


def test_resolve_appeal_forfeited_bond_does_not_double_credit_treasury(instance, send_gen_spy, monkeypatch):
    # Respondent appealed a CLAIMANT-favor verdict; the re-verdict comes
    # back unchanged (still CLAIMANT) — the appeal did not improve the
    # respondent-appellant's position, so the bond is forfeited.
    monkeypatch.setattr(
        gl.nondet,
        "exec_prompt",
        lambda prompt, response_format=None: json.dumps(
            {
                "outcome": "CLAIMANT",
                "confidence_bps": 8000,
                "claim_findings": [{"claim": "x", "determination": "SUPPORTED_CLAIMANT", "evidence_ids": []}],
            }
        ),
    )
    case_id = _make_case(
        instance,
        status=vc.STATUS_RE_INVESTIGATION,
        outcome=vc.OUTCOME_CLAIMANT,
        verdict_split_bps=0,
        appeal_used=True,
        appeal_bond_wei=500_000,
        appellant=RESPONDENT,
        evidence_deadline=instance._now_ts() - 10,  # already closed
        verdict_count=1,
    )

    gl.message.sender_address = RESPONDENT
    instance.resolve_appeal(case_id)

    treasury_sends = [amt for (to, amt) in send_gen_spy if to == TREASURY]
    assert treasury_sends == [500_000]
    # Same bug class as settle_case's fee path — must not ALSO be credited
    # to accrued_treasury_wei on top of the direct send above.
    assert int(instance.accrued_treasury_wei) == 0


def test_resolve_appeal_successful_appeal_refunds_bond_to_appellant_not_treasury(instance, send_gen_spy, monkeypatch):
    # Respondent appealed a CLAIMANT-favor verdict; this time the
    # re-verdict comes back RESPONDENT — a genuinely improved position —
    # so the bond must return to the appellant, never touch treasury.
    monkeypatch.setattr(
        gl.nondet,
        "exec_prompt",
        lambda prompt, response_format=None: json.dumps(
            {
                "outcome": "RESPONDENT",
                "confidence_bps": 8000,
                "claim_findings": [{"claim": "x", "determination": "SUPPORTED_RESPONDENT", "evidence_ids": []}],
            }
        ),
    )
    case_id = _make_case(
        instance,
        status=vc.STATUS_RE_INVESTIGATION,
        outcome=vc.OUTCOME_CLAIMANT,
        appeal_used=True,
        appeal_bond_wei=500_000,
        appellant=RESPONDENT,
        evidence_deadline=instance._now_ts() - 10,
        verdict_count=1,
    )

    gl.message.sender_address = RESPONDENT
    instance.resolve_appeal(case_id)

    assert send_gen_spy == [(RESPONDENT, 500_000)]
    assert int(instance.accrued_treasury_wei) == 0


# ---------------------------------------------------------------------------
# Abandonment deadline guard (file_appeal must reset evidence_deadline)
# ---------------------------------------------------------------------------


def test_file_appeal_resets_evidence_deadline_so_abandonment_is_not_immediately_claimable(instance):
    now = instance._now_ts()
    # The ORIGINAL evidence window closed long enough ago that, left
    # unset, the abandonment grace period would already have elapsed —
    # this is exactly the real-world scenario the bug affected: a case
    # that took a while to reach APPEAL_WINDOW/file_appeal.
    stale_evidence_deadline = now - (vc.ABANDONMENT_GRACE_SECONDS + 3600)
    total_pot = 2_000_000
    required_bond = max(1, (total_pot * vc.DEFAULT_APPEAL_BOND_BPS) // vc.BPS_DENOMINATOR)
    case_id = _make_case(
        instance,
        status=vc.STATUS_APPEAL_WINDOW,
        appeal_deadline=now + 3600,
        evidence_deadline=stale_evidence_deadline,
        claimant_stake_wei=total_pot // 2,
        respondent_stake_wei=total_pot // 2,
        appeal_used=False,
    )

    gl.message.sender_address = CLAIMANT
    gl.message.value = required_bond
    instance.file_appeal(case_id, "New evidence justifying review.")

    case = instance._get_case(case_id)
    # evidence_deadline must no longer be the stale pre-verdict value —
    # it must reflect (approximately) the moment the appeal was filed.
    assert abs(int(case.evidence_deadline) - now) <= 5
    assert case.status == vc.STATUS_APPEALED

    # The real proof: abandonment must NOT be immediately claimable right
    # after the appeal was filed — this call must reject, not succeed.
    gl.message.sender_address = RESPONDENT
    with pytest.raises(gl.vm.UserError) as exc_info:
        instance.claim_case_abandonment(case_id)
    assert "has not yet passed" in exc_info.value.message


def test_claim_case_abandonment_still_works_after_a_genuinely_stalled_appeal(instance, send_gen_spy):
    """The fix must not make abandonment recovery unreachable — once the
    grace period genuinely elapses AFTER the appeal was filed (not just
    after the original evidence window), abandonment must still succeed."""
    now = instance._now_ts()
    case_id = _make_case(
        instance,
        status=vc.STATUS_APPEALED,
        outcome=vc.OUTCOME_CLAIMANT,
        appeal_used=True,
        appeal_bond_wei=0,
        appellant=vc._zero_address(),
        # Simulates: file_appeal correctly set this to "now" at filing
        # time, and enough real time has since passed with nobody calling
        # open_appeal_evidence_window.
        evidence_deadline=now - (vc.ABANDONMENT_GRACE_SECONDS + 3600),
        claimant_stake_wei=1_000_000,
        respondent_stake_wei=1_000_000,
    )

    gl.message.sender_address = CLAIMANT
    instance.claim_case_abandonment(case_id)

    case = instance._get_case(case_id)
    assert int(case.claimant_stake_wei) == 0
