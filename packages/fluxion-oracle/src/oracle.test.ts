import { TICKERS } from "@stock-arena/game-core";
import { describe, expect, it, vi } from "vitest";
import { readOracleConfig } from "./config.js";
import { createPriceOracle, evaluateTicker } from "./oracle.js";
import { slot0ToPriceUsd } from "./pools.js";
import type { TradingStatus } from "./xstocks.js";
import type { SpotPrice } from "./index.js";

const now = new Date("2026-10-15T12:00:00Z");
const open: TradingStatus = {
  tradingHoursMode: "TwentyFourFive",
  isTradingHalted: false,
  currentPeriod: "market",
  openNow: true,
  nextChangeAt: null,
};
const allTrading = () =>
  Object.fromEntries(TICKERS.map((ticker) => [ticker, open])) as Record<
    (typeof TICKERS)[number],
    TradingStatus
  >;
const quote = (ticker: (typeof TICKERS)[number]): SpotPrice => ({
  ticker,
  priceUsd: "100",
  takenAt: now,
  source: "xstocks",
  blockNumber: null,
});
const evaluate = (extra: Partial<Parameters<typeof evaluateTicker>[0]> = {}) =>
  evaluateTicker({
    snapshots: [{ priceUsd: 100, takenAt: now }],
    now,
    trading: open,
    divergencePct: 3,
    jumpLimitPct: 5,
    ...extra,
  });

describe("Fluxion slot0 conversion", () => {
  it("matches the AAPL USDC/token0 fixture without converting the square to Number", () => {
    expect(Number(slot0ToPriceUsd(4268565857940899094584234137899180n))).toBeCloseTo(344.5, 2);
  });
  it.each([0n, -1n, 2n ** 160n])("rejects an invalid square-root price %s", (sqrt) => {
    expect(() => slot0ToPriceUsd(sqrt)).toThrow("invalid_response");
  });
});

describe("ticker status", () => {
  it("pauses above the divergence limit and permits its boundary", () => {
    expect(evaluate({ poolPrice: "103.01" }).status).toEqual({
      state: "paused",
      reason: "divergence",
    });
    expect(evaluate({ poolPrice: "103" }).status).toEqual({ state: "live" });
    expect(evaluate({ poolPrice: "96" }).status).toEqual({ state: "paused", reason: "divergence" });
  });
  it("pauses for closed or halted markets", () => {
    expect(evaluate({ trading: { ...open, currentPeriod: "closed" } }).status).toEqual({
      state: "paused",
      reason: "closed",
    });
    expect(evaluate({ trading: { ...open, isTradingHalted: true } }).status).toEqual({
      state: "paused",
      reason: "closed",
    });
  });
  it("keeps manual and unresolved divergence pauses", () => {
    expect(
      evaluate({ poolPrice: "100", previousState: { state: "paused", reason: "manual" } }).status,
    ).toEqual({ state: "paused", reason: "manual" });
    expect(evaluate({ previousState: { state: "paused", reason: "divergence" } }).status).toEqual({
      state: "paused",
      reason: "divergence",
    });
    expect(
      evaluate({ poolPrice: "100", previousState: { state: "paused", reason: "divergence" } })
        .status,
    ).toEqual({ state: "live" });
  });
  it("keeps stale/jump checks and pauses when trading status is unknown", () => {
    expect(evaluate({ now: new Date(now.getTime() + 121_000) }).status).toEqual({
      state: "paused",
      reason: "stale",
    });
    expect(evaluate({ trading: undefined }).status).toEqual({ state: "paused", reason: "stale" });
    expect(
      evaluate({
        snapshots: [
          { priceUsd: 90, takenAt: new Date(now.getTime() - 15_000) },
          { priceUsd: 100, takenAt: now },
        ],
      }).status,
    ).toEqual({ state: "paused", reason: "jump" });
  });
});

describe("oracle configuration", () => {
  it("uses the five known pools and allows an explicit empty override", () => {
    expect(Object.keys(readOracleConfig({}).pools)).toEqual([
      "AAPL",
      "GOOGL",
      "META",
      "NVDA",
      "TSLA",
    ]);
    expect(readOracleConfig({ FLUXION_POOLS_JSON: "{}" }).pools).toEqual({});
  });
  it("rejects malformed or wrongly ordered pool metadata", () => {
    expect(() => readOracleConfig({ FLUXION_POOLS_JSON: '{"AAPL":{"pool":"oops"}}' })).toThrow();
    const pools = readOracleConfig({}).pools;
    const pool = pools.AAPL!;
    expect(() =>
      readOracleConfig({
        FLUXION_POOLS_JSON: JSON.stringify({
          AAPL: { ...pool, base: pool.quote, quote: pool.base },
        }),
      }),
    ).toThrow();
  });
});

describe("polling with partial source failures", () => {
  it("caches trading metadata for five minutes and expires it after refresh failure", async () => {
    let time = now.getTime();
    const client = {
      getPrice: vi.fn(async (ticker: (typeof TICKERS)[number]) => quote(ticker)),
      getTrading: vi
        .fn()
        .mockResolvedValueOnce(allTrading())
        .mockRejectedValue(new Error("offline")),
    };
    const oracle = createPriceOracle({
      config: readOracleConfig({ FLUXION_POOLS_JSON: "{}" }),
      client,
      readPools: async () => [],
      now: () => new Date(time),
      warn: vi.fn(),
    });
    expect(Object.keys((await oracle.poll()).trading)).toHaveLength(7);
    time += 299_000;
    await oracle.poll();
    expect(client.getTrading).toHaveBeenCalledTimes(1);
    time += 1000;
    expect((await oracle.poll()).trading).toEqual({});
    expect(client.getTrading).toHaveBeenCalledTimes(2);
  });
  it("preserves successful quotes when one ticker and the RPC fail", async () => {
    const client = {
      getPrice: vi.fn(async (ticker: (typeof TICKERS)[number]) => {
        if (ticker === "AAPL") throw new Error("unavailable");
        return quote(ticker);
      }),
      getTrading: async () => allTrading(),
    };
    const warn = vi.fn();
    const oracle = createPriceOracle({
      config: readOracleConfig({}),
      client,
      readPools: async () => {
        throw new Error("RPC failed");
      },
      now: () => now,
      warn,
    });
    const poll = await oracle.poll();
    expect(poll.snapshots).toHaveLength(6);
    expect(poll.snapshots.every((snapshot) => snapshot.source === "xstocks")).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
