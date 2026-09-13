/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    // wagmi/connectors ships a Coinbase "base account" connector that
    // transitively imports the optional @x402/* payment packages. This app
    // never uses Coinbase Base Pay (wallets supported: MetaMask via
    // injected(), Rainbow/Zerion/WalletConnect via walletConnect()), and
    // those packages aren't published as regular dependencies, so alias
    // them to false rather than let webpack fail resolving them.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
      // @metamask/sdk (pulled in transitively by wagmi's metaMask()
      // connector) imports this React Native-only storage adapter for
      // cross-platform (mobile app) support — this is a web-only Next.js
      // app, so it's never reached at runtime, but webpack still tries to
      // resolve it at build time since it's a static import. Confirmed
      // safe to alias away: MetaMask's own web SDK build falls back to
      // browser localStorage when this module is unavailable.
      "@react-native-async-storage/async-storage": false,
      // pino-pretty is an OPTIONAL peer dependency of pino, used only to
      // pretty-print logs in a human terminal — @walletconnect/logger pulls
      // in plain pino (for its own internal debug logging, never used by
      // this app's own logging, which uses its own pino instance directly)
      // and pino's own code does a runtime existence-check before ever
      // requiring pino-pretty, so its absence is harmless; only the
      // build-time resolution attempt needs silencing.
      "pino-pretty": false,
    };
    return config;
  },
};

export default nextConfig;
