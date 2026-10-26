import { expect, it, vi } from "vitest";
import { ASSETS, GAME_CONFIG } from "@stock-arena/game-core";
import { createExtendedOracle, extendedConfig } from "./extended.js";
const trading = {
  tradingHoursMode: "TwentyFourFive",
  isTradingHalted: false,
  currentPeriod: "market",
  openNow: true,
  nextChangeAt: null,
};
it.each([3, 30, 468])(
  "bounds %i-stock batches and keeps price symbols independent of token branding",
  async (count) => {
    const catalog = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `SYN${i}`,
        { ...ASSETS.AAPL, symbol: `SYN${i}m`, priceSymbol: `SYN${i}x` },
      ]),
    );
    let active = 0,
      peak = 0,
      requests = 0;
    const fetcher: typeof fetch = async (input) => {
      active++;
      peak = Math.max(peak, active);
      requests++;
      await Promise.resolve();
      const path = new URL(String(input)).pathname,
        symbol = path.split("/")[5]!;
      active--;
      return Response.json(path.endsWith("price-data") ? { quote: 123 } : { symbol, trading });
    };
    const result = await createExtendedOracle({
      catalog,
      fetch: fetcher,
      batchSize: 4,
      sleep: async () => {},
    }).poll();
    expect(result.observations).toHaveLength(count);
    expect(result.failed).toBe(0);
    expect(peak).toBeLessThanOrEqual(4);
    expect(requests).toBe(count * 2);
    expect(result.observations[0]!.symbol).toBe("SYN0x");
    expect(GAME_CONFIG.prices.pollSeconds).toBe(15);
  },
);
it("preserves closed/halted quotes without calling their price endpoint and isolates an API failure", async () => {
  const catalog = {
    CLOSED: { ...ASSETS.AAPL, symbol: "CLOSEDx" },
    HALT: { ...ASSETS.AAPL, symbol: "HALTx" },
    FAIL: { ...ASSETS.AAPL, symbol: "FAILx" },
  };
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.includes("FAIL")) return new Response("", { status: 404 });
    return Response.json({
      symbol: path.includes("CLOSED") ? "CLOSEDx" : "HALTx",
      trading: {
        ...trading,
        currentPeriod: path.includes("CLOSED") ? "closed" : "market",
        isTradingHalted: path.includes("HALT"),
      },
    });
  };
  const result = await createExtendedOracle({
    catalog,
    fetch: fetcher,
    sleep: async () => {},
  }).poll();
  expect(result.failed).toBe(1);
  expect(result.observations.map((o) => o.priceUsd)).toEqual([null, null]);
  expect(paths.some((p) => p.endsWith("price-data"))).toBe(false);
});
it("reserves rate-limit headroom for core and retries 429 with backoff", async () => {
  let now = new Date("2026-10-26T12:00:00Z"),
    calls = 0;
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
    now = new Date(now.getTime() + ms);
  };
  const fetcher: typeof fetch = async (input) => {
    calls++;
    if (calls === 1) return new Response("", { status: 429, headers: { "retry-after": "2" } });
    return Response.json(
      String(input).endsWith("price-data") ? { quote: 100 } : { symbol: "AAPLx", trading },
      {
        headers:
          calls === 2
            ? { "x-ratelimit-remaining": "40", "x-ratelimit-reset": "2026-10-26T12:01:00Z" }
            : {},
      },
    );
  };
  const result = await createExtendedOracle({
    catalog: { AAPL: ASSETS.AAPL },
    fetch: fetcher,
    now: () => now,
    sleep,
  }).poll();
  expect(result.failed).toBe(0);
  expect(calls).toBe(3);
  expect(waits.some((ms) => ms >= 2000)).toBe(true);
  expect(now.toISOString()).toBe("2026-10-26T12:01:00.000Z");
});
it("validates public collection knobs without changing the core cadence", () => {
  expect(extendedConfig({})).toEqual({ pollSeconds: 300, batchSize: 4, referenceHours: 26 });
  expect(() => extendedConfig({ EXTENDED_BATCH_SIZE: "500" })).toThrow();
  expect(() => extendedConfig({ EXTENDED_POLL_SECONDS: "0" })).toThrow();
  vi.restoreAllMocks();
});
