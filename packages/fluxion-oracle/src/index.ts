import type { Ticker } from "@stock-arena/game-core";

/**
 * Fluxion price oracle. The only module allowed to read the chain.
 * Implementation is task T04 (see docs/TASKS.md). Pool addresses and the
 * correct read method come from the Fluxion team (task T01).
 */

export type PoolInfo = {
  /** Fluxion pool address on Mantle (chain id 5000). */
  pool: `0x${string}`;
  /** xStock token address. */
  base: `0x${string}`;
  /** Quote token address (for example USDC or USDT on Mantle). */
  quote: `0x${string}`;
};

export type SpotPrice = {
  ticker: Ticker;
  /** Decimal string, quote units per 1 xStock. */
  priceUsd: string;
  blockNumber: bigint;
  takenAt: Date;
};

export type Snapshot = { priceUsd: number; takenAt: Date };

export type TickerState = { state: "live" } | { state: "paused"; reason: "stale" | "jump" | "manual" };

export function parsePoolsJson(raw: string): Partial<Record<Ticker, PoolInfo>> {
  const parsed: unknown = JSON.parse(raw || "{}");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("FLUXION_POOLS_JSON must be a JSON object");
  }
  return parsed as Partial<Record<Ticker, PoolInfo>>;
}

/**
 * Time-weighted average price over the window ending at `endAt`.
 * Each snapshot's price holds until the next snapshot.
 * Snapshots must be sorted by `takenAt` ascending. Returns null if no data covers the window.
 */
export function twap(snapshots: Snapshot[], endAt: Date, windowMinutes: number): number | null {
  const end = endAt.getTime();
  const start = end - windowMinutes * 60_000;
  let weighted = 0;
  let covered = 0;
  for (let i = 0; i < snapshots.length; i++) {
    const current = snapshots.at(i);
    if (!current) continue;
    const next = snapshots.at(i + 1);
    const from = Math.max(current.takenAt.getTime(), start);
    const to = Math.min(next ? next.takenAt.getTime() : end, end);
    if (to <= from) continue;
    weighted += current.priceUsd * (to - from);
    covered += to - from;
  }
  return covered > 0 ? weighted / covered : null;
}

/** Health check for a ticker from its newest snapshots (sorted ascending). */
export function checkTicker(
  snapshots: Snapshot[],
  now: Date,
  opts: { staleAfterSeconds: number; jumpLimitPct: number },
): TickerState {
  const last = snapshots.at(-1);
  if (!last || (now.getTime() - last.takenAt.getTime()) / 1000 > opts.staleAfterSeconds) {
    return { state: "paused", reason: "stale" };
  }
  const previous = snapshots.at(-2);
  if (previous && previous.priceUsd > 0) {
    const movePct = (Math.abs(last.priceUsd - previous.priceUsd) / previous.priceUsd) * 100;
    if (movePct > opts.jumpLimitPct) return { state: "paused", reason: "jump" };
  }
  return { state: "live" };
}

/** Reads spot prices for all configured pools. Implemented in T04. */
export async function getSpotPrices(
  _pools: Partial<Record<Ticker, PoolInfo>>,
  _rpcUrl: string,
): Promise<SpotPrice[]> {
  throw new Error("getSpotPrices is not implemented yet (task T04)");
}
