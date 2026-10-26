import { createPublicClient, http } from "viem";
import { mantle } from "./mantle.js";
import { TICKERS } from "@stock-arena/game-core";
import type { Ticker } from "@stock-arena/game-core";
import { OracleError, retry } from "./retry.js";
import type { PoolInfo, SpotPrice } from "./index.js";

const slot0Abi = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

/** USDC token0 (6 decimals), wrapped xStock token1 (18 decimals), USD per xStock. */
export function slot0ToPriceUsd(sqrtPriceX96: bigint): string {
  if (sqrtPriceX96 <= 0n || sqrtPriceX96 >= 2n ** 160n) throw new OracleError("invalid_response");
  const scale = 10n ** 18n;
  const scaled = (2n ** 192n * 10n ** 12n * scale) / (sqrtPriceX96 * sqrtPriceX96);
  if (scaled <= 0n) throw new OracleError("invalid_response");
  return `${scaled / scale}.${(scaled % scale).toString().padStart(18, "0")}`;
}

/** All configured slot0 reads share one multicall at one block. */
export function createPoolReader(rpcUrl: string) {
  const client = createPublicClient({
    chain: mantle,
    transport: http(rpcUrl, { timeout: 5_000, retryCount: 0 }),
  });
  return async (pools: Partial<Record<Ticker, PoolInfo>>): Promise<SpotPrice[]> => {
    const tickers = TICKERS.filter((ticker) => pools[ticker]);
    if (!tickers.length) return [];
    return retry(async () => {
      try {
        const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
        const results = await client.multicall({
          blockNumber,
          allowFailure: true,
          contracts: tickers.map((ticker) => ({
            address: pools[ticker]!.pool,
            abi: slot0Abi,
            functionName: "slot0" as const,
          })),
        });
        const takenAt = new Date();
        return results.flatMap((result, index): SpotPrice[] => {
          const ticker = tickers[index];
          if (!ticker || result.status !== "success") return [];
          try {
            return [
              {
                ticker,
                priceUsd: slot0ToPriceUsd(result.result[0]),
                blockNumber,
                takenAt,
                source: "fluxion_pool",
              },
            ];
          } catch {
            return [];
          }
        });
      } catch {
        throw new OracleError("pool_read", true);
      }
    });
  };
}
