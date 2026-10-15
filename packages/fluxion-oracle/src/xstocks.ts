import { ASSETS, TICKERS } from "@stock-arena/game-core";
import type { Ticker } from "@stock-arena/game-core";
import { z } from "zod";
import { OracleError, retry } from "./retry.js";
import type { SpotPrice } from "./index.js";

const quoteSchema = z.object({ quote: z.number().finite().positive() });
export const tradingSchema = z.object({
  tradingHoursMode: z.string(),
  isTradingHalted: z.boolean(),
  currentPeriod: z.enum(["market", "extended", "overnight", "closed"]),
  openNow: z.boolean(),
  nextChangeAt: z.string().datetime({ offset: true }).nullable(),
});
export type TradingStatus = z.infer<typeof tradingSchema>;
const pageSchema = z.object({
  nodes: z.array(z.unknown()),
  page: z.object({ hasNextPage: z.boolean() }),
});

export function parsePrice(value: unknown): string {
  const result = quoteSchema.safeParse(value);
  if (!result.success) throw new OracleError("invalid_response");
  return String(result.data.quote);
}

export function createXStocksClient(
  options: {
    apiBase?: string;
    fetch?: typeof fetch;
    now?: () => Date;
    sleep?: (ms: number) => Promise<unknown>;
  } = {},
) {
  const base = (options.apiBase ?? "https://api.backed.fi/api/v2").replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;
  async function request(path: string): Promise<unknown> {
    return retry(
      async () => {
        let response: Response;
        try {
          response = await fetcher(`${base}${path}`, { signal: AbortSignal.timeout(5_000) });
        } catch {
          throw new OracleError("network", true);
        }
        if (!response.ok) {
          const header = response.headers.get("retry-after");
          const seconds = header ? Number(header) : 0;
          const retryAfter = Number.isFinite(seconds)
            ? seconds * 1000
            : Math.max(0, Date.parse(header ?? "") - Date.now());
          throw new OracleError(
            "http",
            response.status === 429 || response.status >= 500,
            Number.isFinite(retryAfter) ? retryAfter : 0,
          );
        }
        try {
          return (await response.json()) as unknown;
        } catch {
          throw new OracleError("invalid_response");
        }
      },
      { sleep: options.sleep },
    );
  }
  return {
    async getPrice(ticker: Ticker): Promise<SpotPrice> {
      const priceUsd = parsePrice(
        await request(`/public/assets/${ASSETS[ticker].symbol}/price-data`),
      );
      return {
        ticker,
        priceUsd,
        source: "xstocks",
        blockNumber: null,
        takenAt: (options.now ?? (() => new Date()))(),
      };
    },
    async getTrading(): Promise<Record<Ticker, TradingStatus>> {
      const statuses: Partial<Record<Ticker, TradingStatus>> = {};
      for (let page = 1; page <= 100; page++) {
        const parsed = pageSchema.safeParse(
          await request(`/public/assets?page=${page}&pageSize=100`),
        );
        if (!parsed.success) throw new OracleError("invalid_response");
        for (const node of parsed.data.nodes) {
          const symbol = z.object({ symbol: z.string() }).safeParse(node);
          if (!symbol.success) continue;
          const ticker = TICKERS.find((ticker) => ASSETS[ticker].symbol === symbol.data.symbol);
          if (!ticker) continue;
          const asset = z
            .object({ logo: z.string().url(), trading: tradingSchema })
            .safeParse(node);
          if (!asset.success) throw new OracleError("invalid_response");
          statuses[ticker] = asset.data.trading;
        }
        if (TICKERS.every((ticker) => statuses[ticker]))
          return statuses as Record<Ticker, TradingStatus>;
        if (!parsed.data.page.hasNextPage) break;
      }
      throw new OracleError("invalid_response");
    },
  };
}

export type XStocksClient = ReturnType<typeof createXStocksClient>;
