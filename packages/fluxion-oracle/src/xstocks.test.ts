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
  it("paginates metadata until all seven symbols are found", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ nodes: [{ symbol: "OTHERx" }, node("AAPL")], page: { hasNextPage: true } }),
      )
      .mockResolvedValueOnce(
        Response.json({ nodes: TICKERS.slice(1).map(node), page: { hasNextPage: true } }),
      );
    const statuses = await createXStocksClient({ fetch: fetcher }).getTrading();
    expect(Object.keys(statuses).sort()).toEqual([...TICKERS].sort());
    expect(fetcher.mock.calls[1]?.[0]).toContain("page=2&pageSize=100");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects incomplete or malformed metadata instead of assuming markets are open", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ nodes: [node("AAPL")], page: { hasNextPage: false } }),
      );
    await expect(createXStocksClient({ fetch: fetcher }).getTrading()).rejects.toThrow(
      "invalid_response",
    );
  });
});
