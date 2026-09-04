// Shannon testnet wiring. Every address here is mirrored from src/Verified.sol
// and docs/VERIFIED.md. Nothing in this file is decorative.
export const SHANNON = {
  chainId: 50312,
  chainIdHex: "0xc488",
  name: "Somnia Shannon",
  rpc: "https://dream-rpc.somnia.network",
  explorer: "https://shannon-explorer.somnia.network",
  indexer: "https://dev.smk.somnia.host/v1/graphql",
  oracleHub: "0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b",
  binaryModule: "0x3ecC694Cef705358864a646142ac17A90E29e388",
  testUsdc: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
  vault: "0xe0e08329A28347568E56e8184DbC7efDE8c7B2d6",
  factory: "0x9b71Ad905083b8b35559c45a39Fc12a7C5ADA91f",
  nativeCurrency: { name: "Somnia", symbol: "STT", decimals: 18 },
};

export const shannonChain = {
  id: SHANNON.chainId,
  name: SHANNON.name,
  nativeCurrency: SHANNON.nativeCurrency,
  rpcUrls: { default: { http: [SHANNON.rpc] } },
  blockExplorers: { default: { name: "Shannon Explorer", url: SHANNON.explorer } },
};

export const txUrl = (hash) => `${SHANNON.explorer}/tx/${hash}`;
export const addressUrl = (address) => `${SHANNON.explorer}/address/${address}`;

// Collateral is test USDC, 6 decimals. All raw amounts in the app are 6dp.
export const USDC_DECIMALS = 6;
