import { z } from "zod";
import { AdminClientError } from "./client.js";
import { destination, historyRow } from "../rewards/client.js";
const instant = z.string().datetime({ offset: true });
const season = z.object({
  id: z.string(),
  name: z.string(),
  startsAt: instant,
  endsAt: instant.nullable(),
});
const event = z.object({
  id: z.string(),
  entryId: z.string(),
  version: z.number(),
  status: z.enum(["pending", "approved", "delivered", "void"]),
  note: z.string(),
  actorId: z.string(),
  createdAt: instant,
});
export const rewardSeason = z.object({
  season,
  locked: z.boolean(),
  snapshot: z
    .object({
      seasonId: z.string(),
      seasonName: z.string(),
      startsAt: instant,
      endsAt: instant,
      topN: z.number(),
      createdAt: instant,
      createdBy: z.string(),
    })
    .nullable(),
  prizes: z.array(
    z.object({ id: z.string(), rankFrom: z.number(), rankTo: z.number(), description: z.string() }),
  ),
  entries: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      rank: z.number(),
      points: z.number(),
      displayName: z.string(),
      identities: z.array(
        z.object({ platform: z.enum(["discord", "telegram"]), platformUserId: z.string() }),
      ),
      eligibility: z.string(),
      prizeDescription: z.string(),
      event,
    }),
  ),
});
export type RewardSeason = z.infer<typeof rewardSeason>;
const player = destination.extend({ id: z.string(), displayName: z.string() });
const players = z.object({ entries: z.array(player), page: z.number(), hasMore: z.boolean() });
export type RewardPlayer = z.infer<typeof player>;
export function createRewardsClient(fetcher: typeof fetch = fetch) {
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    csrf?: string,
    body?: object,
  ): Promise<T> {
    const response = await fetcher(`/api/admin/rewards${path}`, {
      method: csrf ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: csrf
        ? { "Content-Type": "application/json", "X-Admin-CSRF": csrf }
        : { Accept: "application/json" },
      ...(csrf ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const parsed = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(await response.json());
      throw new AdminClientError(parsed.success ? parsed.data.error.code : "INVALID_RESPONSE");
    }
    if (path === "/export") return schema.parse(await response.text());
    const value = schema.safeParse(await response.json());
    if (!value.success) throw new AdminClientError("INVALID_RESPONSE");
    return value.data;
  }
  const ok = z.object({ ok: z.literal(true) });
  return {
    seasons: () => request("", z.object({ seasons: z.array(season) })),
    season: (id: string) =>
      request(`/season?${new URLSearchParams({ seasonId: id })}`, rewardSeason),
    prize: (
      csrf: string,
      body: {
        seasonId: string;
        rankFrom: number;
        rankTo: number;
        description: string;
        reason: string;
      },
    ) => request("/prizes", ok, csrf, body),
    freeze: (csrf: string, seasonId: string, topN: number, reason: string) =>
      request("/freeze", ok, csrf, { seasonId, topN, reason }),
    status: (csrf: string, entryId: string, version: number, status: string, note: string) =>
      request("/status", ok, csrf, { entryId, version, status, note }),
    lock: (csrf: string, seasonId: string, locked: boolean, reason: string) =>
      request("/lock", ok, csrf, { seasonId, locked, reason }),
    export: (csrf: string, seasonId: string) => request("/export", z.string(), csrf, { seasonId }),
    players: (search: string, page: number) =>
      request(`/destinations?${new URLSearchParams({ search, page: String(page) })}`, players),
    history: (id: string) =>
      request(`/destinations/${id}`, z.object({ history: z.array(historyRow) })),
    save: (csrf: string, row: RewardPlayer, reason: string) =>
      request(`/destinations/${row.id}`, ok, csrf, {
        bybitUid: row.bybitUid,
        mantleAddress: row.mantleAddress,
        expectedChangedAt: row.changedAt,
        confirmed: true,
        reason,
      }),
  };
}
