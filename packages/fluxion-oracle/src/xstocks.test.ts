import { ASSETS, TICKERS } from "@stock-arena/game-core";
import { describe, expect, it, vi } from "vitest";
import { createXStocksClient, parsePrice } from "./xstocks.js";

const trading = {
  tradingHoursMode: "TwentyFourFive",
  isTradingHalted: false,
  currentPeriod: "market",
  openNow: true,
  nextChangeAt: null,
};
const node = (ticker: (typeof TICKERS)[number]) => ({
  symbol: ASSETS[ticker].symbol,
  logo: ASSETS[ticker].logo,
  trading,
});

describe("xStocks public price API", () => {
  it("parses the numeric quote as a decimal string", () => {
    expect(parsePrice({ quote: 344.5 })).toBe("344.5");
  });
  it.each([
    null,
    {},
    { quote: "344.5" },
    { quote: 0 },
    { quote: -1 },
    { quote: Infinity },
    { quote: NaN },
  ])("rejects malformed or nonpositive prices %j", (value) => {
    expect(() => parsePrice(value)).toThrow("invalid_response");
  });
  it("uses the symbol path and tags a quote without inventing a block number", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ quote: 344.5 }));
    const date = new Date("2026-10-15T12:00:00Z");
    const client = createXStocksClient({ fetch: fetcher, now: () => date });
    expect(await client.getPrice("AAPL")).toEqual({
      ticker: "AAPL",
      priceUsd: "344.5",
      blockNumber: null,
      source: "xstocks",
      takenAt: date,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.backed.fi/api/v2/public/assets/AAPLx/price-data",
    );
  });
  it("retries transient API errors with exponential backoff", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(Response.json({ quote: 344.5 }));
    const sleep = vi.fn(async (_ms: number) => {});
    const client = createXStocksClient({ fetch: fetcher, sleep });
    expect((await client.getPrice("AAPL")).priceUsd).toBe("344.5");
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });
  it("honors Retry-After for rate limiting and stops after bounded retries", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(null, { status: 429, headers: { "retry-after": "2" } }),
      );
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(createXStocksClient({ fetch: fetcher, sleep }).getPrice("AAPL")).rejects.toThrow(
      "http",
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 2000]);
  });
  it("does not retry permanent HTTP errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(createXStocksClient({ fetch: fetcher }).getPrice("AAPL")).rejects.toThrow("http");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("fetches only catalog symbols and caches individual metadata", async () => {
    let time = Date.parse("2026-10-15T12:00:00Z");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const ticker = TICKERS.find((ticker) => String(url).endsWith(`/${ASSETS[ticker].symbol}`));
      if (!ticker) throw new Error("Unexpected metadata URL");
      return Response.json(node(ticker));
    });
    const client = createXStocksClient({ fetch: fetcher, now: () => new Date(time) });
    const statuses = await client.getTrading();
    expect(Object.keys(statuses).sort()).toEqual([...TICKERS].sort());
    await client.getTrading();
    expect(fetcher).toHaveBeenCalledTimes(TICKERS.length);
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes("?"))).toBe(true);
    time += 300_000;
    await client.getTrading();
    expect(fetcher).toHaveBeenCalledTimes(TICKERS.length * 2);
  });
  it("omits malformed metadata instead of assuming markets are open", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ nodes: [node("AAPL")], page: { hasNextPage: false } }),
      );
    expect(await createXStocksClient({ fetch: fetcher }).getTrading()).toEqual({});
  });
  it.each([3, 30])("reads a %s-asset catalog without a fixed launch count", async (count) => {
    const catalog = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `TEST_${i}`,
        { ...ASSETS.AAPL, symbol: `TEST_${i}x` },
      ]),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        Response.json({ symbol: String(url).split("/").at(-1), trading }),
      );
    expect(
      Object.keys(await createXStocksClient({ fetch: fetcher, catalog }).getTrading()),
    ).toHaveLength(count);
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it("keeps healthy assets cached when one fails, expires before a market transition and throttles failed refreshes", async () => {
    let time = Date.parse("2026-10-15T12:00:00Z");
    let failing = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith("/AAPLx") && failing) return new Response(null, { status: 404 });
      return Response.json({
        symbol: String(url).split("/").at(-1),
        trading: { ...trading, nextChangeAt: "2026-10-15T12:01:00Z" },
      });
    });
    const client = createXStocksClient({
      fetch: fetcher,
      now: () => new Date(time),
      catalog: { AAPL: ASSETS.AAPL, MSFT: ASSETS.MSFT },
    });
    await Promise.all([client.getTrading(), client.getTrading()]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    time += 60_000;
    failing = true;
    const fresh = await client.getTrading();
    expect(fresh.AAPL).toBeUndefined();
    // A returned transition in the past is also unusable, even on HTTP 200.
    expect(fresh.MSFT).toBeUndefined();
    await client.getTrading();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/AAPLx"))).toHaveLength(2);
  });
});
