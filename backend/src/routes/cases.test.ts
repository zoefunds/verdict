import { describe, it, expect } from "vitest";
import { verifyCaseLinkage } from "./cases.js";

// Regression tests for a re-audit finding (2026-09-14): PATCH
// /cases/:id/link-contract previously trusted whatever contractCaseId
// the client claimed with no on-chain verification at all — the same
// class of gap evidence.ts's link-contract endpoint had before it was
// fixed. These test the pure verification function directly, same
// pattern as evidence.test.ts's toContractKind.

const VALID_ON_CHAIN = {
  claimant: "0xClaimantAddress",
  respondent: "0xRespondentAddress",
  required_stake_wei: "1000000000000000000",
};

const EXPECTED = {
  claimantWallet: "0xClaimantAddress",
  respondentAddress: "0xRespondentAddress",
  stakeAmountWei: "1000000000000000000",
};

describe("verifyCaseLinkage", () => {
  it("returns no mismatches when every field matches", () => {
    expect(verifyCaseLinkage(VALID_ON_CHAIN, EXPECTED)).toEqual([]);
  });

  it("is case-insensitive for addresses (checksummed vs lowercase)", () => {
    const onChain = { ...VALID_ON_CHAIN, claimant: "0xCLAIMANTADDRESS", respondent: "0xRESPONDENTADDRESS" };
    expect(verifyCaseLinkage(onChain, EXPECTED)).toEqual([]);
  });

  it("flags a claimant mismatch — the core fix: a fabricated case id belonging to someone else's case", () => {
    const onChain = { ...VALID_ON_CHAIN, claimant: "0xSomeoneElse" };
    const mismatches = verifyCaseLinkage(onChain, EXPECTED);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain("claimant");
  });

  it("flags a respondent mismatch", () => {
    const onChain = { ...VALID_ON_CHAIN, respondent: "0xSomeoneElse" };
    const mismatches = verifyCaseLinkage(onChain, EXPECTED);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain("respondent");
  });

  it("flags a stake-amount mismatch", () => {
    const onChain = { ...VALID_ON_CHAIN, required_stake_wei: "500000000000000000" };
    const mismatches = verifyCaseLinkage(onChain, EXPECTED);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain("required_stake_wei");
  });

  it("reports every mismatched field at once, not just the first", () => {
    const onChain = { claimant: "0xWrong1", respondent: "0xWrong2", required_stake_wei: "1" };
    expect(verifyCaseLinkage(onChain, EXPECTED)).toHaveLength(3);
  });

  it("skips the claimant check when no wallet address is available on the request", () => {
    // The JWT payload's walletAddress is optional in this app's types —
    // when absent, this check must not produce a false-positive mismatch
    // it has no real basis to make.
    const onChain = { ...VALID_ON_CHAIN, claimant: "0xAnyoneAtAll" };
    const mismatches = verifyCaseLinkage(onChain, { ...EXPECTED, claimantWallet: undefined });
    expect(mismatches).toEqual([]);
  });
});
