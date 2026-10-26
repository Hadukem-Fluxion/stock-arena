import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { PNG } from "pngjs";
import { ASSETS, NEUTRAL_ASSET_COLOR } from "@stock-arena/game-core";
import { EXTENDED_ASSETS } from "@stock-arena/game-core/catalog";
import { buildExtendedCatalog, parseConstituents, publicAssetSchema } from "./catalog.js";
import type { LogoPalette } from "./catalog.js";
import { logoColor } from "./catalog-color.js";
it("intersects stock underlyings only, excludes ETFs and never invents Mantle addresses", () => {
  const before = JSON.stringify(ASSETS),
    members = parseConstituents('Symbol,Security\nSYN,"Synthetic, Inc."\nXYZ,Synthetic two\n');
  const nodes = [
    {
      name: "Synthetic xStock",
      symbol: "SYNx",
      underlyingSymbol: "SYN",
      logo: "https://xstocks-metadata.backed.fi/logos/SYN.png",
      deployments: [],
    },
    {
      name: "Synthetic ETF",
      symbol: "XYZx",
      underlyingSymbol: "XYZ",
      logo: "https://xstocks-metadata.backed.fi/logos/XYZ.png",
      underlying: { type: "ETF" },
      deployments: [],
    },
    {
      name: "Synthetic outside",
      symbol: "OUTx",
      underlyingSymbol: "OUT",
      logo: "https://xstocks-metadata.backed.fi/logos/OUT.png",
      deployments: [],
    },
  ];
  const result = buildExtendedCatalog(members, nodes, {});
  expect(Object.keys(result)).toEqual(["SYN"]);
  expect(result.SYN).toMatchObject({
    name: "Synthetic, Inc.",
    provider: "xstocks",
    priceSymbol: "SYNx",
    primaryColor: NEUTRAL_ASSET_COLOR,
  });
  expect(result.SYN).not.toHaveProperty("token");
  expect(result.SYN).not.toHaveProperty("wrapped");
  expect(JSON.stringify(ASSETS)).toBe(before);
});
it("extracts a dominant saturated color and safely falls back for monochrome/invalid logos", () => {
  const image = new PNG({ width: 2, height: 2 });
  image.data.set([240, 50, 30, 255, 240, 50, 30, 255, 255, 255, 255, 255, 0, 0, 200, 0]);
  expect(logoColor(PNG.sync.write(image))).toBe("#f0321e");
  image.data.fill(255);
  expect(logoColor(PNG.sync.write(image))).toBe(NEUTRAL_ASSET_COLOR);
  expect(logoColor(new Uint8Array([1, 2, 3]))).toBe(NEUTRAL_ASSET_COLOR);
});
it("rebuilds the versioned public intersection from frozen inputs without a network request", async () => {
  const base = new URL("../../game-core/data/sp500/", import.meta.url);
  const csv = await readFile(new URL("constituents-2026-10-26.csv", base), "utf8"),
    nodes = JSON.parse(await readFile(new URL("xstocks-2026-10-26.json", base), "utf8")),
    colors = JSON.parse(await readFile(new URL("logo-colors.json", base), "utf8")) as LogoPalette;
  const result = buildExtendedCatalog(
    parseConstituents(csv),
    publicAssetSchema.array().parse(nodes),
    colors,
  );
  expect(result).toEqual(EXTENDED_ASSETS);
  expect(Object.keys(result).length).toBeGreaterThan(30);
  for (const asset of Object.values(result)) {
    expect(asset.provider).toBe("xstocks");
    expect(asset.primaryColor).toMatch(/^#[\da-f]{6}$/i);
  }
});
