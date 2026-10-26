import type { Chain } from "viem";

// Same public definition as viem 2.57.7's Mantle chain; a broad annotation avoids
// loading/inferencing the declarations of every supported network just for 5000.
export const mantle: Chain = {
  id: 5000,
  name: "Mantle",
  nativeCurrency: { decimals: 18, name: "MNT", symbol: "MNT" },
  rpcUrls: { default: { http: ["https://rpc.mantle.xyz"] } },
  blockExplorers: {
    default: {
      name: "Mantle Explorer",
      url: "https://mantlescan.xyz/",
      apiUrl: "https://api.mantlescan.xyz/api",
    },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 304717 },
  },
};
