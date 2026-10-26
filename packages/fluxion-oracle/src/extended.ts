import { GAME_CONFIG } from "@stock-arena/game-core";
import { EXTENDED_ASSETS } from "@stock-arena/game-core/catalog";
import type { ReferenceCatalog } from "@stock-arena/game-core";
import { z } from "zod";
import { tradingSchema } from "./xstocks.js";
import { OracleError, retry } from "./retry.js";

export type ExtendedObservation = {
  ticker: string;
  symbol: string;
  priceUsd: string | null;
  closed: boolean;
  halted: boolean;
  takenAt: Date;
};
export function extendedConfig(env: Record<string, string | undefined> = {}) {
  return z
    .object({
      pollSeconds: z.coerce.number().int().min(60).max(3600),
      batchSize: z.coerce.number().int().min(1).max(8),
      referenceHours: z.coerce.number().int().min(25).max(48),
    })
    .parse({
      pollSeconds: env.EXTENDED_POLL_SECONDS?.trim() || GAME_CONFIG.extendedPrices.pollSeconds,
      batchSize: env.EXTENDED_BATCH_SIZE?.trim() || GAME_CONFIG.extendedPrices.batchSize,
      referenceHours:
        env.EXTENDED_REFERENCE_HOURS?.trim() || GAME_CONFIG.extendedPrices.referenceHours,
    });
}
export function createExtendedOracle(
  options: {
    catalog?: ReferenceCatalog;
    apiBase?: string;
    fetch?: typeof fetch;
    now?: () => Date;
    sleep?: (ms: number) => Promise<unknown>;
    batchSize?: number;
  } = {},
) {
  const catalog = options.catalog ?? EXTENDED_ASSETS,
    fetcher = options.fetch ?? fetch,
    now = options.now ?? (() => new Date()),
    sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    base = (options.apiBase ?? "https://api.backed.fi/api/v2").replace(/\/$/, "");
  const batchSize = z
    .number()
    .int()
    .min(1)
    .max(8)
    .parse(options.batchSize ?? GAME_CONFIG.extendedPrices.batchSize);
  let resumeAt = 0;
  async function request(path: string): Promise<unknown> {
    return retry(
      async () => {
        if (resumeAt > now().getTime()) await sleep(resumeAt - now().getTime());
        let response: Response;
        try {
          response = await fetcher(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
        } catch {
          throw new OracleError("network", true);
        }
        const remaining = Number(response.headers.get("x-ratelimit-remaining") ?? "NaN"),
          reset = Date.parse(response.headers.get("x-ratelimit-reset") ?? "");
        if (
          Number.isFinite(remaining) &&
          remaining <= GAME_CONFIG.extendedPrices.coreRequestReserve &&
          reset > now().getTime()
        )
          resumeAt = Math.max(resumeAt, reset);
        if (!response.ok) {
          const raw = response.headers.get("retry-after"),
            seconds = Number(raw ?? "NaN"),
            delay = Number.isFinite(seconds)
              ? seconds * 1000
              : Math.max(0, Date.parse(raw ?? "") - now().getTime());
          throw new OracleError(
            "http",
            response.status === 429 || response.status >= 500,
            Number.isFinite(delay) ? delay : 0,
          );
        }
        try {
          return (await response.json()) as unknown;
        } catch {
          throw new OracleError("invalid_response");
        }
      },
      { sleep },
    );
  }
  return {
    async poll(): Promise<{ observations: ExtendedObservation[]; failed: number }> {
      const entries = Object.entries(catalog),
        observations: ExtendedObservation[] = [];
      let failed = 0;
      for (let i = 0; i < entries.length; i += batchSize) {
        const results = await Promise.allSettled(
          entries.slice(i, i + batchSize).map(async ([ticker, asset]) => {
            const symbol = asset.priceSymbol ?? asset.symbol;
            const metadata = z
              .object({ symbol: z.literal(symbol), trading: tradingSchema })
              .parse(await request(`/public/assets/${encodeURIComponent(symbol)}`));
            const closed = metadata.trading.currentPeriod === "closed",
              halted = metadata.trading.isTradingHalted;
            const quote =
              closed || halted
                ? null
                : z
                    .object({ quote: z.number().finite().positive() })
                    .parse(await request(`/public/assets/${encodeURIComponent(symbol)}/price-data`))
                    .quote;
            return {
              ticker,
              symbol,
              priceUsd: quote === null ? null : String(quote),
              closed,
              halted,
              takenAt: now(),
            };
          }),
        );
        for (const r of results)
          if (r.status === "fulfilled") observations.push(r.value);
          else failed++;
        if (i + batchSize < entries.length) await sleep(GAME_CONFIG.extendedPrices.batchDelayMs);
      }
      return { observations, failed };
    },
  };
}
