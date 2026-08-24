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
    };
    return config;
  },
};

export default nextConfig;
