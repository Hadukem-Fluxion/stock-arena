import { sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { GAME_CONFIG, addDays, gameDay, weekStart } from "@stock-arena/game-core";
import type {
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardPlatform,
  LeaderboardView,
  Season,
} from "@stock-arena/game-core";
import type { DatabaseConnection } from "@stock-arena/db";
import { AuthError } from "./auth/types.js";

export function leaderboardWindow(period: LeaderboardPeriod, now: Date, season: Season) {
  const day = gameDay(now);
  const start =
    period === "day"
      ? `${day}T00:00:00Z`
      : period === "week"
        ? `${weekStart(day)}T00:00:00Z`
        : season.startsAt;
  const end =
    period === "day"
      ? `${addDays(day, 1)}T00:00:00Z`
      : period === "week"
        ? `${addDays(weekStart(day), 7)}T00:00:00Z`
        : season.endsAt;
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: end ? new Date(end).toISOString() : null,
  };
}
export type LeaderboardOptions = { season?: Season };
export function createLeaderboardStore(
  connection: DatabaseConnection,
  options: LeaderboardOptions & { now?: () => Date } = {},
) {
  const season = options.season ?? GAME_CONFIG.season;
  const now = options.now ?? (() => new Date());
  const cache = new Map<
    string,
    { expiresAt: number; generatedAt: string; rows: LeaderboardEntry[] }
  >();
  const pending = new Map<
    string,
    Promise<{ expiresAt: number; generatedAt: string; rows: LeaderboardEntry[] }>
  >();
  return async (
    userId: string,
    period: LeaderboardPeriod,
    platform: LeaderboardPlatform,
  ): Promise<LeaderboardView> => {
    const instant = now();
    const window = leaderboardWindow(period, instant, season);
    const key = JSON.stringify([period, platform, window.startsAt, window.endsAt]);
    let snapshot = cache.get(key);
    if (!snapshot || snapshot.expiresAt <= instant.getTime()) {
      let query = pending.get(key);
      if (!query) {
        query = (async () => {
          // Windowed sums preserve first attainment of the final score even after
          // zero awards or compensating ledger entries. Never join identities directly.
          const result = await connection.db.execute<{
            user_id: string;
            display_name: string;
            score: string;
            rank: string;
            reached_at: Date | string;
          }>(sql`
            WITH running AS (
              SELECT l.user_id, l.created_at, u.display_name,
                sum(l.amount) OVER (PARTITION BY l.user_id ORDER BY l.created_at,l.id ROWS UNBOUNDED PRECEDING) AS running_score,
                sum(l.amount) OVER (PARTITION BY l.user_id) AS final_score
              FROM points_ledger l JOIN users u ON u.id=l.user_id
              WHERE l.created_at >= ${window.startsAt}::timestamptz
                AND l.created_at <= ${instant.toISOString()}::timestamptz
                ${window.endsAt ? sql`AND l.created_at < ${window.endsAt}::timestamptz` : sql``}
                AND u.status='active'
                ${platform === "all" ? sql`` : sql`AND EXISTS (SELECT 1 FROM identities i WHERE i.user_id=l.user_id AND i.platform=${platform}::platform)`}
            ), scores AS (
              SELECT user_id,display_name,final_score AS score,
                min(created_at) FILTER (WHERE running_score=final_score) AS reached_at
              FROM running GROUP BY user_id,display_name,final_score
            )
            SELECT *, row_number() OVER (ORDER BY score DESC,reached_at ASC,user_id ASC)::text AS rank
            FROM scores ORDER BY score DESC,reached_at ASC,user_id ASC
          `);
          const rows = result.rows.map((row) => {
            const score = Number(row.score),
              rank = Number(row.rank);
            if (!Number.isSafeInteger(score) || !Number.isSafeInteger(rank))
              throw new Error("Invalid leaderboard totals.");
            return {
              userId: row.user_id,
              displayName: row.display_name,
              score,
              rank,
              reachedAt: new Date(row.reached_at).toISOString(),
            };
          });
          const boundary = window.endsAt ? Date.parse(window.endsAt) : Infinity;
          const startBoundary = Date.parse(window.startsAt);
          const nextBoundary = boundary > instant.getTime() ? boundary : Infinity;
          const nextStart = startBoundary > instant.getTime() ? startBoundary : Infinity;
          const value = {
            rows,
            generatedAt: instant.toISOString(),
            expiresAt: Math.min(instant.getTime() + 60_000, nextBoundary, nextStart),
          };
          // At most the current UTC-day/week/season entries for each platform are kept.
          for (const [cacheKey, entry] of cache)
            if (entry.expiresAt <= instant.getTime()) cache.delete(cacheKey);
          cache.set(key, value);
          return value;
        })();
        pending.set(key, query);
      }
      try {
        snapshot = await query;
      } finally {
        if (pending.get(key) === query) pending.delete(key);
      }
    }
    return {
      ...window,
      period,
      platform,
      generatedAt: snapshot.generatedAt,
      season: {
        ...season,
        ended: season.endsAt !== null && instant.getTime() >= Date.parse(season.endsAt),
      },
      top: snapshot.rows.slice(0, 100),
      caller: snapshot.rows.find((row) => row.userId === userId) ?? null,
    };
  };
}
export function registerLeaderboard(
  app: FastifyInstance,
  options: LeaderboardOptions & { database: () => DatabaseConnection; now?: () => Date },
) {
  const query = z
    .object({
      period: z.enum(["day", "week", "season"]).default("day"),
      platform: z.enum(["all", "discord", "telegram"]).default("all"),
    })
    .strict();
  let store: ReturnType<typeof createLeaderboardStore> | undefined;
  app.get("/api/leaderboard", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!request.user) throw new AuthError("UNAUTHORIZED", 401);
    const input = query.safeParse(request.query);
    if (!input.success) throw new AuthError("INVALID_INPUT", 400);
    store ??= createLeaderboardStore(options.database(), options);
    return store(request.user.id, input.data.period, input.data.platform);
  });
}
