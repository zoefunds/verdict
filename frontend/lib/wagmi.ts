import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { studionet } from "genlayer-js/chains";
import { env } from "./env";

// GenLayer StudioNet is the only network VERDICT targets — every case,
// stake, and settlement lives on the deployed contract there. Wallets are
// prompted to switch to (or add) this network on connect; there is no
// mainnet/testnet-Ethereum fallback because a VERDICT wallet transaction
// signed against any other chain would silently fail against the contract.
export const genlayerStudionet = studionet;

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
  chains: [genlayerStudionet],
  connectors,
  transports: {
    [genlayerStudionet.id]: http(genlayerStudionet.rpcUrls.default.http[0]),
  },
  ssr: true,
});
