import { createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { env } from "./env";

export const reownProjectId = env.reownProjectId;

// Plain wagmi connectors instead of @reown/appkit's modal SDK — see
// scripts/step7_replace_reown_appkit.py for why. Coverage:
//   - injected(): MetaMask and any other EIP-1193 browser extension wallet
//   - walletConnect(): Rainbow, Zerion, and any other WalletConnect-
//     compatible wallet, via the same Reown Project ID
const connectors = [
  injected(),
  ...(reownProjectId
    ? [
        walletConnect({
          projectId: reownProjectId,
          metadata: {
            name: "VERDICT",
            description: "Put money behind your version of reality.",
            url: typeof window !== "undefined" ? window.location.origin : "https://verdict.app",
            icons: ["/icon.svg"],
          },
          showQrModal: true,
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia],
  connectors,
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true,
});
