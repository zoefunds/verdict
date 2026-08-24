// Typed, defensive access to NEXT_PUBLIC_ env vars. Values that are still
// the repo's placeholder strings (e.g. "changeme_...") are treated as unset
// so UI code can show an honest "not configured yet" state instead of
// crashing or silently no-opping.

function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  return v.startsWith("changeme");
}

export const env = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000",
  reownProjectId: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "",
  genlayerRpcUrl: isPlaceholder(process.env.NEXT_PUBLIC_GENLAYER_RPC_URL)
    ? null
    : (process.env.NEXT_PUBLIC_GENLAYER_RPC_URL as string),
  verdictContractAddress: isPlaceholder(process.env.NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS)
    ? null
    : (process.env.NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS as string),
  appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
};

export const isContractDeployed = Boolean(env.genlayerRpcUrl && env.verdictContractAddress);
