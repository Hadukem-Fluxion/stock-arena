import { ASSETS, GAME_CONFIG, MANTLE_USDC, TICKERS } from "@stock-arena/game-core";
import type { Asset, Ticker } from "@stock-arena/game-core";
import { z } from "zod";
import { parsePoolsJson } from "./index.js";
import type { PoolInfo } from "./index.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const poolSchema = z.object({ pool: address, base: address, quote: address });
const httpUrl = z
  .string()
  .url()
  .refine((url) => ["http:", "https:"].includes(new URL(url).protocol));

export function readOracleConfig(env: Record<string, string | undefined> = process.env) {
  const defaults: Partial<Record<Ticker, PoolInfo>> = {};
  for (const ticker of TICKERS) {
    const asset: Asset = ASSETS[ticker];
    if (asset.pool)
      defaults[ticker] = { pool: asset.pool, base: asset.wrapped, quote: MANTLE_USDC };
  }
  const pools = env.FLUXION_POOLS_JSON ? parsePoolsJson(env.FLUXION_POOLS_JSON) : defaults;
  const validated = z.record(z.enum(TICKERS), poolSchema).parse(pools) as Partial<
    Record<Ticker, PoolInfo>
  >;
  // The slot0 formula is valid only for these known wrapped-xStock/USDC pairs.
  for (const ticker of TICKERS) {
    const pool = validated[ticker];
    if (
      pool &&
      (pool.base.toLowerCase() !== ASSETS[ticker].wrapped ||
        pool.quote.toLowerCase() !== MANTLE_USDC)
    ) {
      throw new Error("Pool metadata must match wrapped xStock and Mantle USDC");
    }
  }
  return {
    apiBase: httpUrl
      .parse(env.XSTOCKS_API_BASE ?? "https://api.backed.fi/api/v2")
      .replace(/\/$/, ""),
    rpcUrl: httpUrl.parse(env.MANTLE_RPC_URL ?? "https://rpc.mantle.xyz"),
    pools: validated,
    divergencePct: z.coerce
      .number()
      .finite()
      .nonnegative()
      .parse(env.PRICE_DIVERGENCE_PCT ?? 3),
    jumpLimitPct: z.coerce
      .number()
      .finite()
      .nonnegative()
      .parse(env.PRICE_JUMP_LIMIT_PCT ?? GAME_CONFIG.prices.defaultJumpLimitPct),
  };
}
