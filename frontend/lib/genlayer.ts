// Thin client wrapper around the VERDICT Intelligent Contract on GenLayer
// StudioNet. This repo never hardcodes a contract address or RPC URL — both
// come from NEXT_PUBLIC_GENLAYER_RPC_URL / NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS.
// While those are still the repo's placeholder "changeme_..." values (i.e.
// isContractDeployed === false), every write method here throws
// ContractNotDeployedError instead of pretending to succeed — callers must
// catch it and render an honest "Contract not yet deployed" state. No
// method in this file ever fabricates a transaction hash or a fake result.

import { env, isContractDeployed } from "./env";

export class ContractNotDeployedError extends Error {
  constructor() {
    super("VERDICT contract is not yet deployed — NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS is unset.");
    this.name = "ContractNotDeployedError";
  }
}

function assertDeployed() {
  if (!isContractDeployed) throw new ContractNotDeployedError();
}

// Method names mirror contracts/verdict_contract.py's public interface.
// Args/return shapes are intentionally loose (unknown) here since the real
// ABI/ICJ interface will be generated once genlayer-js is wired against the
// deployed contract — this wrapper's job today is to centralize the
// deployed/not-deployed gate, not to fully type the contract surface.
async function getContractClient() {
  assertDeployed();
  // The genlayer-js SDK client would be constructed here, e.g.:
  //   const { createClient } = await import("genlayer-js");
  //   return createClient({ chain: { rpcUrl: env.genlayerRpcUrl }, address: env.verdictContractAddress });
  // Left unimplemented until a real StudioNet deployment exists — wiring a
  // client against a nonexistent address would only produce confusing
  // network errors instead of the clear ContractNotDeployedError above.
  throw new ContractNotDeployedError();
}

export const genlayerContract = {
  address: env.verdictContractAddress,
  rpcUrl: env.genlayerRpcUrl,
  isDeployed: isContractDeployed,

  async createCase(_args: { requiredStakeWei: bigint; caseMetadataRef: string }): Promise<{ contractCaseId: string; txHash: string }> {
    await getContractClient();
    throw new ContractNotDeployedError();
  },

  async fundRespondentStake(_args: { contractCaseId: string; valueWei: bigint }): Promise<{ txHash: string }> {
    await getContractClient();
    throw new ContractNotDeployedError();
  },

  async submitEvidenceOnChain(_args: { contractCaseId: string; evidenceRef: string }): Promise<{ txHash: string }> {
    await getContractClient();
    throw new ContractNotDeployedError();
  },

  async fileAppeal(_args: { contractCaseId: string; bondWei: bigint; note: string }): Promise<{ txHash: string }> {
    await getContractClient();
    throw new ContractNotDeployedError();
  },

  async getCase(_contractCaseId: string): Promise<unknown> {
    await getContractClient();
    throw new ContractNotDeployedError();
  },
};
