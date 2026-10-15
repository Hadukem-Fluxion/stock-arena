import { describe, expect, it } from "vitest";
import { ASSETS, assetTickers } from "./assets.js";
import type { AssetCatalog } from "./assets.js";
import { stockOfTheDay } from "./scoring.js";
import { addDays } from "./time.js";
import { TICKERS, COMPANY_NAMES } from "./config.js";

describe("asset-driven catalog", () => {
  it.each([3, 30])("rotates deterministically over every asset in a %s-asset catalog", (count) => {
    const catalog: AssetCatalog = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `STOCK_${index}`,
        {
          ...ASSETS.AAPL,
          name: `Company ${index}`,
          symbol: `STOCK_${index}`,
          referenceTicker: `STOCK_${index}`,
        },
      ]),
    );
    const tickers = assetTickers(catalog);
    const cycle = Array.from({ length: count }, (_, index) =>
      stockOfTheDay(addDays("2026-10-15", index), tickers),
    );
    expect(new Set(cycle)).toEqual(new Set(Object.keys(catalog)));
    expect(stockOfTheDay(addDays("2026-10-15", count), tickers)).toBe(cycle[0]);
  });
  it("derives compatibility exports from assets without another ticker list", () => {
    expect(TICKERS).toEqual(Object.keys(ASSETS));
    for (const ticker of TICKERS) {
      expect(COMPANY_NAMES[ticker]).toBe(ASSETS[ticker].name);
      expect(ASSETS[ticker].provider).toBe("xstocks");
    }
  });
  it("rejects an empty catalog", () => {
    expect(() => assetTickers({})).toThrow("No assets configured");
  });
});
