import { GAME_CONFIG, TICKERS } from "@stock-arena/game-core";
import type { Ticker } from "@stock-arena/game-core";
import { checkTicker } from "./index.js";
import type { Snapshot, SpotPrice, TickerState } from "./index.js";
import { readOracleConfig } from "./config.js";
import { createPoolReader } from "./pools.js";
import { createXStocksClient } from "./xstocks.js";
import type { TradingStatus, XStocksClient } from "./xstocks.js";

export type OraclePoll = {
  snapshots: SpotPrice[];
  trading: Partial<Record<Ticker, TradingStatus>>;
  takenAt: Date;
};

export function evaluateTicker(options: {
  snapshots: Snapshot[];
  now: Date;
  trading?: TradingStatus;
  poolPrice?: string;
  previousState?: TickerState;
  divergencePct: number;
  jumpLimitPct: number;
}): { status: TickerState; divergencePct: number | null } {
  const last = options.snapshots.at(-1);
  const poolPrice = Number(options.poolPrice);
  const divergencePct =
    last && last.priceUsd > 0 && Number.isFinite(poolPrice) && poolPrice > 0
      ? (Math.abs(poolPrice - last.priceUsd) / last.priceUsd) * 100
      : null;
  let status: TickerState;
  if (options.previousState?.state === "paused" && options.previousState.reason === "manual") {
    status = options.previousState;
  } else if (options.trading?.currentPeriod === "closed" || options.trading?.isTradingHalted) {
    status = { state: "paused", reason: "closed" };
  } else if (!options.trading) {
    status = { state: "paused", reason: "stale" };
  } else {
    status = checkTicker(options.snapshots, options.now, {
      staleAfterSeconds: GAME_CONFIG.prices.staleAfterSeconds,
      jumpLimitPct: options.jumpLimitPct,
    });
    if (status.state === "live") {
      if (divergencePct !== null && divergencePct > options.divergencePct) {
        status = { state: "paused", reason: "divergence" };
      } else if (
        divergencePct === null &&
        options.previousState?.state === "paused" &&
        options.previousState.reason === "divergence"
      ) {
        // A failed cross-check cannot silently clear a known divergence pause.
        status = options.previousState;
      }
    }
  }
  return { status, divergencePct };
}

export function createPriceOracle(
  options: {
    config?: ReturnType<typeof readOracleConfig>;
    client?: XStocksClient;
    readPools?: ReturnType<typeof createPoolReader>;
    now?: () => Date;
    warn?: (message: string) => void;
  } = {},
) {
  const config = options.config ?? readOracleConfig();
  const client = options.client ?? createXStocksClient({ apiBase: config.apiBase });
  const readPools = options.readPools ?? createPoolReader(config.rpcUrl);
  const now = options.now ?? (() => new Date());
  const warn = options.warn ?? console.warn;
  let trading: Partial<Record<Ticker, TradingStatus>> = {};
  let expiresAt = 0;
  let nextAttemptAt = 0;

  async function refreshTrading() {
    if (now().getTime() < expiresAt || now().getTime() < nextAttemptAt) return;
    nextAttemptAt = now().getTime() + 30_000;
    try {
      const fresh = await client.getTrading();
      const fetchedAt = now().getTime();
      trading = fresh;
      expiresAt = fetchedAt + 5 * 60_000;
      for (const status of Object.values(fresh)) {
        const changeAt = Date.parse(status.nextChangeAt ?? "");
        if (changeAt > fetchedAt) expiresAt = Math.min(expiresAt, changeAt);
      }
    } catch {
      warn("[oracle] Trading status refresh failed; expired metadata pauses tickers.");
    }
  }

  return {
    config,
    async poll(): Promise<OraclePoll> {
      const [quotes, pools] = await Promise.all([
        Promise.allSettled(TICKERS.map((ticker) => client.getPrice(ticker))),
        readPools(config.pools).catch(() => {
          warn("[oracle] Pool cross-check unavailable.");
          return [];
        }),
        refreshTrading(),
      ]);
      const primary = quotes.flatMap((result, index) => {
        if (result.status === "fulfilled") return [result.value];
        warn(`[oracle] ${TICKERS[index]} quote unavailable; keeping the last stored price.`);
        return [];
      });
      for (const ticker of TICKERS) {
        if (config.pools[ticker] && !pools.some((price) => price.ticker === ticker)) {
          warn(`[oracle] ${ticker} pool cross-check unavailable.`);
        }
      }
      const takenAt = now();
      return {
        snapshots: [...primary, ...pools],
        trading: takenAt.getTime() < expiresAt ? trading : {},
        takenAt,
      };
    },
  };
}
