import { z } from "zod";
import { GAME_CONFIG } from "@stock-arena/game-core";
import type { FlyerInput } from "@stock-arena/game-core";
import { assetSchema } from "../checkin/client.js";
import type { PlatformAdapter } from "../platform/types.js";
const instant = z.string().datetime({ offset: true });
const segment = z.object({
  ticker: z.string(),
  asset: assetSchema,
  prices: z.array(z.string()).length(10),
  centers: z.array(z.number().int()).length(10),
  changePct: z.string(),
  fact: z.string().nullable(),
  windowEndsAt: instant.optional(),
  lastSession: z.boolean().optional(),
});
export const courseSchema = z.object({
  version: z.literal(GAME_CONFIG.flyer.version),
  seed: z.number().int().nonnegative(),
  segments: z.array(segment).nonempty(),
});
export const flyerViewSchema = z.object({
  day: z.string(),
  best: z.number().int().nonnegative(),
  pointsToday: z.number().int(),
  dailyCap: z.number().int(),
  maintenance: z.boolean(),
  available: z.boolean(),
  canStart: z.boolean(),
  active: z.object({ id: z.string().uuid(), startedAt: instant, expiresAt: instant }).nullable(),
});
const sessionSchema = z.object({
  id: z.string().uuid(),
  startedAt: instant,
  expiresAt: instant,
  maxTicks: z.number().int().positive(),
  course: courseSchema,
});
const resultSchema = z.object({
  id: z.string().uuid(),
  day: z.string(),
  score: z.number().int().nonnegative(),
  best: z.number().int().nonnegative(),
  pointsAwarded: z.number().int().nonnegative(),
  pointsToday: z.number().int(),
  newBest: z.boolean(),
  course: courseSchema,
});
const row = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  score: z.number().int(),
  rank: z.number().int(),
  reachedAt: instant,
});
const leaderboardSchema = z.object({
  period: z.enum(["day", "week", "season"]),
  entries: z.array(row),
  caller: row.nullable(),
  season: z.object({
    id: z.string(),
    name: z.string(),
    startsAt: instant,
    endsAt: instant.nullable(),
  }),
});
export type FlyerView = z.infer<typeof flyerViewSchema>;
export type FlyerSession = z.infer<typeof sessionSchema>;
export type FlyerResult = z.infer<typeof resultSchema>;
export type FlyerLeaderboard = z.infer<typeof leaderboardSchema>;
export class FlyerClientError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export function createFlyerClient(platform: PlatformAdapter) {
  async function call<Output, Input>(
    path: string,
    schema: z.ZodType<Output, z.ZodTypeDef, Input>,
    body?: object,
  ): Promise<Output> {
    if (!platform.session) throw new FlyerClientError("UNAUTHORIZED");
    let response: Response;
    try {
      response = await fetch(`/api/flyer${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${platform.session.token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new FlyerClientError("NETWORK_ERROR");
    }
    const raw: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(raw);
      throw new FlyerClientError(error.success ? error.data.error.code : "INVALID_RESPONSE");
    }
    const result = schema.safeParse(raw);
    if (!result.success) throw new FlyerClientError("INVALID_RESPONSE");
    return result.data;
  }
  return {
    read: () => call("", flyerViewSchema),
    start: () => call("/start", sessionSchema, {}),
    finish: (id: string, ticks: number, score: number, inputs: FlyerInput[]) =>
      call("/finish", resultSchema, { sessionId: id, ticks, score, inputs }),
    cancel: (id: string) => call("/cancel", z.object({ ok: z.literal(true) }), { sessionId: id }),
    leaderboard: (period: "day" | "week" | "season") =>
      call(`/leaderboard?period=${period}`, leaderboardSchema),
  };
}
