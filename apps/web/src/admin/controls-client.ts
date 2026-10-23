import { z } from "zod";
import { AdminClientError } from "./client.js";
import { assetSchema } from "../checkin/client.js";
const instant = z.string().datetime({ offset: true });
const game = z.enum(["checkin", "quiz", "higher_lower"]);
const games = z.object({
  entries: z.array(z.object({ game, paused: z.boolean(), reason: z.string(), updatedAt: instant })),
});
const tickers = z.object({
  catalog: z.record(assetSchema),
  entries: z.array(
    z.object({
      ticker: z.string(),
      manualPaused: z.boolean(),
      manualReason: z.string(),
      state: z.enum(["live", "paused"]),
      reason: z.string().nullable(),
      oracleState: z.enum(["live", "paused"]).nullable(),
      oracleReason: z.string().nullable(),
      updatedAt: instant.nullable(),
      priceUsd: z.string().nullable(),
    }),
  ),
});
const season = z.object({
  id: z.string(),
  name: z.string(),
  startsAt: instant,
  endsAt: instant.nullable(),
});
const seasons = z.object({ serverTime: instant, entries: z.array(season) });
export type GameControl = z.infer<typeof games>["entries"][number];
export type TickerControl = z.infer<typeof tickers>["entries"][number];
export type SeasonRow = z.infer<typeof season>;
export function createControlsClient(fetcher: typeof fetch = fetch) {
  async function request<T>(path: string, schema: z.ZodType<T>, csrf?: string, body?: object) {
    let response: Response;
    try {
      response = await fetcher(`/api/admin/${path}`, {
        method: csrf ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: csrf
          ? { "Content-Type": "application/json", "X-Admin-CSRF": csrf }
          : { Accept: "application/json" },
        ...(csrf ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new AdminClientError("NETWORK_ERROR");
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new AdminClientError("INVALID_RESPONSE");
    }
    if (!response.ok) {
      const result = z.object({ error: z.object({ code: z.string() }) }).safeParse(raw);
      throw new AdminClientError(result.success ? result.data.error.code : "INVALID_RESPONSE");
    }
    const value = schema.safeParse(raw);
    if (!value.success) throw new AdminClientError("INVALID_RESPONSE");
    return value.data;
  }
  const ok = z.object({ ok: z.literal(true) });
  return {
    games: () => request("games", games),
    tickers: () => request("tickers", tickers),
    seasons: () => request("seasons", seasons),
    game: (csrf: string, game: GameControl["game"], paused: boolean, reason: string) =>
      request("games", ok, csrf, { game, paused, reason }),
    ticker: (csrf: string, ticker: string, paused: boolean, reason: string) =>
      request("tickers", ok, csrf, { ticker, paused, reason }),
    season: (csrf: string, body: SeasonRow & { reason: string; create: boolean }) =>
      request("seasons", ok, csrf, body),
  };
}
