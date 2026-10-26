import { expect, it } from "vitest";
import { EXTENDED_ASSETS, EXTENDED_CATALOG_METADATA, EXTENDED_CATALOG_VERSION } from "./index.js";
import { parseCatalog } from "./parse.js";
import * as core from "../index.js";
it("loads the unchanged public catalog behind the server-only boundary", () => {
  expect(Object.keys(EXTENDED_ASSETS)).toHaveLength(EXTENDED_CATALOG_METADATA.matchedStocks);
  expect(EXTENDED_CATALOG_VERSION).toBe("sp500-xstocks-2026-10-26-1b08d904fbe7");
  expect(EXTENDED_ASSETS.AAPL?.provider).toBe("xstocks");
  expect("EXTENDED_ASSETS" in core).toBe(false);
});
it("validates generated data at runtime instead of trusting an unchecked JSON cast", () => {
  const data = {
    version: EXTENDED_CATALOG_VERSION,
    metadata: EXTENDED_CATALOG_METADATA,
    assets: EXTENDED_ASSETS,
  };
  expect(parseCatalog(JSON.parse(JSON.stringify(data)))).toEqual(data);
  expect(() =>
    parseCatalog({ ...data, metadata: { ...data.metadata, matchedStocks: 1 } }),
  ).toThrow();
  expect(() =>
    parseCatalog({
      ...data,
      assets: { ...data.assets, AAPL: { ...data.assets.AAPL, token: "not-an-address" } },
    }),
  ).toThrow();
  expect(() =>
    parseCatalog({
      ...data,
      assets: { ...data.assets, AAPL: { ...data.assets.AAPL, provider: "unconfirmed" } },
    }),
  ).toThrow();
  expect(() =>
    parseCatalog({
      ...data,
      assets: { ...data.assets, AAPL: { ...data.assets.AAPL, referenceTicker: "OTHER" } },
    }),
  ).toThrow();
});
