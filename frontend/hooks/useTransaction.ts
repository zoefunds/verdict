import { useCallback, useState } from "react";

// Shared transaction-lifecycle state machine used by every on-chain-calling
// UI component (stake lock, evidence commit, appeal bond). Never collapse
// this into a bare "success" boolean — the UI must be able to show the user
// exactly where a transaction is (or why it failed) at every step.
export type TransactionState =
  | { status: "idle" }
  | { status: "wallet-confirm" }
  | { status: "submitted"; txHash: string }
  | { status: "pending"; txHash: string }
  | { status: "confirmed"; txHash: string }
  | { status: "failed"; error: string }
  | { status: "rejected" }
  | { status: "wrong-network" }
  | { status: "insufficient-funds" }
  | { status: "wallet-disconnected" }
  | { status: "contract-not-deployed" };

export function useTransaction() {
  const [state, setState] = useState<TransactionState>({ status: "idle" });

  const reset = useCallback(() => setState({ status: "idle" }), []);

  const run = useCallback(async (fn: (helpers: { setSubmitted: (txHash: string) => void; setPending: (txHash: string) => void }) => Promise<string>) => {
    setState({ status: "wallet-confirm" });
    try {
      const txHash = await fn({
        setSubmitted: (txHash) => setState({ status: "submitted", txHash }),
        setPending: (txHash) => setState({ status: "pending", txHash }),
      });
      setState({ status: "confirmed", txHash });
      return txHash;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message === "ContractNotDeployedError" || /not yet deployed/i.test(message)) {
        setState({ status: "contract-not-deployed" });
      } else if (/user rejected|denied/i.test(message)) {
        setState({ status: "rejected" });
      } else if (/insufficient funds/i.test(message)) {
        setState({ status: "insufficient-funds" });
      } else if (/wrong network|chain mismatch/i.test(message)) {
        setState({ status: "wrong-network" });
      } else if (/disconnected/i.test(message)) {
        setState({ status: "wallet-disconnected" });
      } else {
        setState({ status: "failed", error: message });
      }
      throw err;
    }
  }, []);

  return { state, run, reset };
}
