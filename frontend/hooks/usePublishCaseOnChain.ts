import { useTransaction } from "./useTransaction";
import { genlayerContract } from "@/lib/genlayer";
import { fetchCaseCount, fetchCaseFromContract } from "@/lib/genlayer-proxy";
import { casesApi } from "@/lib/api";
import { env } from "@/lib/env";
import type { Case } from "@/types";

/**
 * Publishes a DRAFT case on-chain: reads the current case count (which
 * becomes the new case's id, since ids are sequential from 0), submits the
 * wallet-signed create_case transaction with the claimant's stake attached,
 * then tells the backend to link that contractCaseId + txHash to the draft
 * row so it leaves DRAFT status. Shared by the Create Case wizard's
 * success screen and the case detail page's draft-state CTA (a claimant
 * who navigated away before completing this can come back and finish it).
 *
 * The count-then-create approach has a known race: if another case is
 * created between the read and this transaction confirming, the assumed
 * id could be wrong. To avoid ever linking a draft to the WRONG on-chain
 * case, this re-reads the resulting case after the transaction confirms
 * and verifies its claimant address matches before calling linkContract —
 * on a mismatch it throws rather than silently mislinking.
 */
export function usePublishCaseOnChain() {
  const { state, run, reset } = useTransaction();

  async function publish(account: `0x${string}`, c: Case): Promise<void> {
    if (!c.respondentAddress) {
      throw new Error("This case has no respondent address on record — cannot publish on-chain.");
    }
    await run(async () => {
      const contractCaseId = await fetchCaseCount(env.apiBaseUrl);
      const { txHash } = await genlayerContract.createCase({
        account,
        respondentAddress: c.respondentAddress as `0x${string}`,
        requiredStakeWei: BigInt(c.stakeAmountWei),
        title: c.title,
        claimText: c.claimText,
        evidenceWindowSeconds: c.evidenceWindowHours * 3600,
      });

      const onChainCase = await fetchCaseFromContract(env.apiBaseUrl, contractCaseId);
      const claimant = String((onChainCase as Record<string, unknown>).claimant ?? "").toLowerCase();
      if (claimant !== account.toLowerCase()) {
        throw new Error(
          `Case id ${contractCaseId} was claimed by another transaction in the meantime — could not safely link. Please retry.`,
        );
      }

      await casesApi.linkContract(c.id, String(contractCaseId), txHash);
      return txHash;
    });
  }

  return { state, publish, reset };
}
