import { ASSETS } from "@stock-arena/game-core";
import type { AssetCatalog, Ticker } from "@stock-arena/game-core";
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
    catalog?: AssetCatalog;
  } = {},
) {
  const base = (options.apiBase ?? "https://api.backed.fi/api/v2").replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;
  const catalog = options.catalog ?? ASSETS;
  const now = options.now ?? (() => new Date());
  const metadata = new Map<string, { status: TradingStatus; expiresAt: number }>();
  const retryAt = new Map<string, number>();
  const pending = new Map<string, Promise<void>>();
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
    async getTrading(): Promise<Partial<Record<string, TradingStatus>>> {
      await Promise.all(
        Object.entries(catalog).map(async ([ticker, asset]) => {
          if ((metadata.get(ticker)?.expiresAt ?? 0) > now().getTime()) return;
          if (pending.has(ticker)) return pending.get(ticker);
          if ((retryAt.get(ticker) ?? 0) > now().getTime()) return;
          const refresh = (async () => {
            try {
              const parsed = z
                .object({ symbol: z.literal(asset.symbol), trading: tradingSchema })
                .safeParse(await request(`/public/assets/${encodeURIComponent(asset.symbol)}`));
              if (!parsed.success) throw new OracleError("invalid_response");
              const expiry = now().getTime() + 5 * 60_000;
              const transition = Date.parse(parsed.data.trading.nextChangeAt ?? "");
              metadata.set(ticker, {
                status: parsed.data.trading,
                expiresAt: Number.isFinite(transition) ? Math.min(expiry, transition) : expiry,
              });
              retryAt.delete(ticker);
            } catch {
              // Keep other assets usable. Expired entries never imply an open market.
              retryAt.set(ticker, now().getTime() + 30_000);
            } finally {
              pending.delete(ticker);
            }
          })();
          pending.set(ticker, refresh);
          await refresh;
        }),
      );
      return Object.fromEntries(
        [...metadata]
          .filter(([, value]) => value.expiresAt > now().getTime())
          .map(([ticker, value]) => [ticker, value.status]),
      );
    },
  };
}

export type XStocksClient = ReturnType<typeof createXStocksClient>;
