import { NEUTRAL_ASSET_COLOR } from "@stock-arena/game-core";
import type { ProviderId, ReferenceCatalog } from "@stock-arena/game-core";
import { z } from "zod";

export const publicAssetSchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1),
  underlyingSymbol: z.string().min(1),
  logo: z.string().url(),
  underlying: z.object({ type: z.string().nullable().optional() }).optional(),
  deployments: z
    .array(
      z.object({
        network: z.string(),
        address: z.string(),
        wrapperAddressV2: z.string().optional(),
      }),
    )
    .default([]),
});
export type PublicCatalogAsset = z.infer<typeof publicAssetSchema>;
export type LogoPalette = Record<string, { logo: string; color: string; sha256?: string }>;
export function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Unclosed CSV field.");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
export function parseConstituents(csv: string): Map<string, string> {
  const [header, ...rows] = csvRows(csv),
    symbol = header?.indexOf("Symbol") ?? -1,
    name = header?.indexOf("Security") ?? -1;
  if (symbol < 0 || name < 0) throw new Error("Invalid constituent headers.");
  const result = new Map<string, string>();
  for (const row of rows) {
    if (row.every((s) => !s.trim())) continue;
    const ticker = row[symbol]?.trim(),
      company = row[name]?.trim();
    if (!ticker || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker) || !company || result.has(ticker))
      throw new Error("Invalid constituent record.");
    result.set(ticker, company);
  }
  if (!result.size) throw new Error("No constituents found.");
  return result;
}
export function buildExtendedCatalog(
  constituents: ReadonlyMap<string, string>,
  nodes: readonly PublicCatalogAsset[],
  palette: LogoPalette,
  provider: ProviderId = "xstocks",
): ReferenceCatalog {
  const selected = new Map<string, PublicCatalogAsset>();
  for (const node of nodes) {
    const ticker = node.underlyingSymbol.replace(/-/g, "."),
      kind = node.underlying?.type?.toLowerCase();
    if (!constituents.has(ticker) || (kind && !/^(stock|equity|share|common stock)$/.test(kind)))
      continue;
    if (/\b(etf|etn|fund|leveraged)\b/i.test(node.name)) continue;
    const logo = new URL(node.logo);
    if (logo.protocol !== "https:" || logo.hostname !== "xstocks-metadata.backed.fi") continue;
    const existing = selected.get(ticker);
    if (!existing || node.symbol.localeCompare(existing.symbol) < 0) selected.set(ticker, node);
  }
  return Object.fromEntries(
    [...selected]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ticker, node]) => {
        const mantle = node.deployments.find((d) => d.network.toLowerCase() === "mantle"),
          address = z.string().regex(/^0x[\da-f]{40}$/i);
        const cached = palette[ticker],
          color =
            cached?.logo === node.logo && /^#[\da-f]{6}$/i.test(cached.color)
              ? cached.color
              : NEUTRAL_ASSET_COLOR;
        return [
          ticker,
          {
            name: constituents.get(ticker)!,
            provider,
            symbol: node.symbol,
            priceSymbol: node.symbol,
            referenceTicker: ticker,
            logo: node.logo,
            tradeUrl: "https://app.fluxion.network/trade",
            primaryColor: color,
            ...(address.safeParse(mantle?.address).success
              ? { token: mantle!.address as `0x${string}` }
              : {}),
            ...(address.safeParse(mantle?.wrapperAddressV2).success
              ? { wrapped: mantle!.wrapperAddressV2 as `0x${string}` }
              : {}),
          },
        ];
      }),
  );
}
