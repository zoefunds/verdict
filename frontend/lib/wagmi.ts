import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet, sepolia } from "@reown/appkit/networks";
import { env } from "./env";

export const reownProjectId = env.reownProjectId;

const networks = [mainnet, sepolia] as const;

export const wagmiAdapter = new WagmiAdapter({
  projectId: reownProjectId || "missing-project-id",
  networks: [...networks],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

let appKitInitialized = false;

/** Idempotent — call from a client component before rendering the connect button. */
export function ensureAppKit() {
  if (appKitInitialized || typeof window === "undefined") return;
  if (!reownProjectId) return; // no project id configured; wallet connect UI will show a configuration notice instead
  createAppKit({
    adapters: [wagmiAdapter],
    networks: [...networks],
    projectId: reownProjectId,
    metadata: {
      name: "VERDICT",
      description: "Put money behind your version of reality.",
      url: typeof window !== "undefined" ? window.location.origin : "https://verdict.app",
      icons: ["/icon.svg"],
    },
    features: { analytics: false, email: false, socials: [] },
    featuredWalletIds: [
      "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d." /* MetaMask */,
      "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a19" /* Rainbow */,
      "8a0ee50d1f22f6651afcae7eb4253e52a3310b90af5daef78a8c4929a9bb99d8" /* Zerion */,
    ],
  });
  appKitInitialized = true;
}
