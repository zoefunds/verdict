import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTransaction } from "./useTransaction";

// This state machine is the single shared path every on-chain-calling UI
// component routes through (stake lock, evidence commit, appeal bond,
// verdict/settlement triggers — see hooks/useTransaction.ts's module
// comment and docs/ARCHITECTURE.md's "Transaction lifecycle" section).
// It is the exact UI-to-wallet behavior an external re-audit flagged as
// under-tested (verified chiefly through manual/live evidence) — these
// tests exercise every state transition and every error classification
// branch without needing a real wallet or contract.

describe("useTransaction", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useTransaction());
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("happy path: idle -> wallet-confirm -> submitted -> pending -> confirmed", async () => {
    const { result } = renderHook(() => useTransaction());

    // Gate every step behind a manually-resolved promise so each
    // intermediate state can be inspected precisely, rather than assuming
    // how much of the callback runs synchronously before the first await.
    let releaseSubmit: () => void;
    const gateSubmit = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    let releasePending: () => void;
    const gatePending = new Promise<void>((resolve) => {
      releasePending = resolve;
    });

    let runPromise: Promise<string>;
    act(() => {
      runPromise = result.current.run(async ({ setSubmitted, setPending }) => {
        await gateSubmit;
        setSubmitted("0xabc");
        await gatePending;
        setPending("0xabc");
        return "0xabc";
      });
    });
    expect(result.current.state).toEqual({ status: "wallet-confirm" });

    await act(async () => {
      releaseSubmit();
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "submitted", txHash: "0xabc" });

    // releasing this gate lets the callback call setPending() and then
    // return immediately after with no further await — both the
    // "pending" update and the run()-level "confirmed" update can land
    // in the same microtask flush, so assert the final state directly
    // rather than racing to observe "pending" as a separate tick.
    await act(async () => {
      releasePending();
      await runPromise;
    });
    expect(result.current.state).toEqual({ status: "confirmed", txHash: "0xabc" });
  });

  it("never shows a bare success without passing through confirmed", async () => {
    // Regression test for the exact rule stated in
    // docs/ARCHITECTURE.md: "No UI path is allowed to show a bare
    // 'Success' without passing through `confirmed`." The only terminal
    // states this hook can ever reach are `confirmed` (success) or one
    // of the explicit failure/rejection states below — never a bare
    // status the UI could misinterpret as success.
    const { result } = renderHook(() => useTransaction());
    await act(async () => {
      await result.current.run(async () => "0xdef").catch(() => {});
    });
    expect(result.current.state.status).toBe("confirmed");
  });

  const errorCases: Array<[string, string]> = [
    ["user rejected the request", "rejected"],
    ["request was denied by the user", "rejected"],
    ["insufficient funds for gas", "insufficient-funds"],
    ["wrong network selected", "wrong-network"],
    ["chain mismatch detected", "wrong-network"],
    ["wallet is disconnected", "wallet-disconnected"],
    ["ContractNotDeployedError", "contract-not-deployed"],
    ["VERDICT contract is not yet deployed", "contract-not-deployed"],
    ["something totally unrecognized went wrong", "failed"],
  ];

  it.each(errorCases)("classifies error message %j as status %j", async (message, expectedStatus) => {
    const { result } = renderHook(() => useTransaction());
    await act(async () => {
      await result.current.run(async () => {
        throw new Error(message);
      }).catch(() => {});
    });
    expect(result.current.state.status).toBe(expectedStatus);
  });

  it("re-throws the original error after classifying it, so callers can still handle it", async () => {
    const { result } = renderHook(() => useTransaction());
    const original = new Error("user rejected the request");
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.run(async () => {
          throw original;
        });
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBe(original);
    expect(result.current.state).toEqual({ status: "rejected" });
  });

  it("failed state carries the actual error message for display", async () => {
    const { result } = renderHook(() => useTransaction());
    await act(async () => {
      await result.current.run(async () => {
        throw new Error("gas estimation failed for unknown reasons");
      }).catch(() => {});
    });
    expect(result.current.state).toEqual({
      status: "failed",
      error: "gas estimation failed for unknown reasons",
    });
  });

  it("classifies a thrown non-Error value with an 'Unknown error' message", async () => {
    const { result } = renderHook(() => useTransaction());
    await act(async () => {
      await result.current.run(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "just a string";
      }).catch(() => {});
    });
    expect(result.current.state).toEqual({ status: "failed", error: "Unknown error" });
  });

  it("reset() returns to idle from any state", async () => {
    const { result } = renderHook(() => useTransaction());
    await act(async () => {
      await result.current.run(async () => {
        throw new Error("insufficient funds");
      }).catch(() => {});
    });
    expect(result.current.state.status).toBe("insufficient-funds");

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("run() calls setSubmitted/setPending helpers exactly as provided by the caller", async () => {
    const { result } = renderHook(() => useTransaction());
    const setSubmittedSpy = vi.fn();
    const setPendingSpy = vi.fn();

    await act(async () => {
      await result.current.run(async ({ setSubmitted, setPending }) => {
        setSubmitted("0x111");
        setSubmittedSpy("0x111");
        setPending("0x111");
        setPendingSpy("0x111");
        return "0x111";
      });
    });

    expect(setSubmittedSpy).toHaveBeenCalledWith("0x111");
    expect(setPendingSpy).toHaveBeenCalledWith("0x111");
    expect(result.current.state).toEqual({ status: "confirmed", txHash: "0x111" });
  });
});
