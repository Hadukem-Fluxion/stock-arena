import { z } from "zod";
import type {
  LeaderboardPeriod,
  LeaderboardPlatform,
  LeaderboardView,
} from "@stock-arena/game-core";
import type { Session } from "../platform/types.js";

const entry = z
  .object({
    userId: z.string().uuid(),
    displayName: z.string(),
    rank: z.number().int().positive(),
    score: z.number().int().safe(),
    reachedAt: z.string().datetime(),
  })
  .strict();
export const leaderboardSchema: z.ZodType<LeaderboardView> = z
  .object({
    period: z.enum(["day", "week", "season"]),
    platform: z.enum(["all", "discord", "telegram"]),
    generatedAt: z.string().datetime(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().nullable(),
    season: z
      .object({
        id: z.string(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime().nullable(),
        ended: z.boolean(),
      })
      .strict(),
    top: z.array(entry).max(100),
    caller: entry.nullable(),
  })
  .strict();
export class LeaderboardClientError extends Error {
  constructor(public readonly code: "session" | "network") {
    super(code);
  }
}
export function createLeaderboardClient(
  session: () => Session | null,
  request: typeof fetch = fetch,
) {
  return async (
    period: LeaderboardPeriod,
    platform: LeaderboardPlatform,
    signal?: AbortSignal,
  ): Promise<LeaderboardView> => {
    const current = session();
    if (!current || Date.parse(current.expiresAt) <= Date.now())
      throw new LeaderboardClientError("session");
    try {
      const response = await request(
        `/api/leaderboard?${new URLSearchParams({ period, platform })}`,
        {
          headers: { Authorization: `Bearer ${current.token}` },
          cache: "no-store",
          signal: signal ?? AbortSignal.timeout(15_000),
        },
      );
      if (response.status === 401 || response.status === 403)
        throw new LeaderboardClientError("session");
      if (!response.ok) throw new LeaderboardClientError("network");
      const view = leaderboardSchema.parse(await response.json());
      if (view.period !== period || view.platform !== platform)
        throw new LeaderboardClientError("network");
      return view;
    } catch (error) {
      throw error instanceof LeaderboardClientError ? error : new LeaderboardClientError("network");
    }
  };
}
