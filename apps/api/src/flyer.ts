import { randomBytes } from "node:crypto";
import {
  EXTENDED_ASSETS,
  EXTENDED_CATALOG_VERSION,
  STOCK_FACTS,
  GAME_CONFIG,
  flyerCourse,
  flyerV2Course,
  gameDay,
  predictionChange,
  replayFlyer,
} from "@stock-arena/game-core";
import type {
  ReferenceCatalog,
  FlyerCourse,
  StoredFlyerCourse,
  FlyerInput,
  FlyerSegment,
} from "@stock-arena/game-core";
import {
  flyerSessions,
  flyerDailyCourses,
  extendedQuotes,
  gamePaused,
  pointsLedger,
  rewardReferral,
  seasons,
  users,
} from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { and, desc, eq, gt, lte, sql, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError } from "./auth/types.js";
import { GameControlError } from "./game-control.js";
import { leaderboardWindow } from "./leaderboard.js";

const c = GAME_CONFIG.flyer;
export type FlyerTx = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];
export class FlyerError extends Error {
  constructor(
    public readonly code:
      | "FLYER_UNAVAILABLE"
      | "FLYER_ACTIVE"
      | "FLYER_EXPIRED"
      | "FLYER_REUSED"
      | "FLYER_INVALID_REPLAY"
      | "FLYER_LIMIT"
      | "FLYER_NOT_FOUND",
    public readonly statusCode = 409,
  ) {
    super(code);
  }
}
export function flyerLimits(env: Record<string, string | undefined>) {
  const result = z
    .object({
      maxFinishes: z.coerce.number().int().positive().safe(),
      seconds: z.coerce
        .number()
        .int()
        .positive()
        .max(c.sessionExpirySeconds - 1),
    })
    .safeParse({
      maxFinishes: env.FLYER_MAX_FINISHES_PER_DAY,
      seconds: env.FLYER_MAX_SESSION_SECONDS,
    });
  return result.success ? result.data : null;
}
export async function flyerDayTotals(tx: FlyerTx, userId: string, day: string) {
  const [best] = await tx
    .select({ score: sql<number>`coalesce(max(${flyerSessions.score}),0)::int` })
    .from(flyerSessions)
    .where(
      and(
        eq(flyerSessions.userId, userId),
        eq(flyerSessions.day, day),
        eq(flyerSessions.state, "finished"),
      ),
    );
  const [paid] = await tx
    .select({ points: sql<number>`coalesce(sum(${pointsLedger.amount}),0)::int` })
    .from(pointsLedger)
    .where(
      and(
        eq(pointsLedger.userId, userId),
        sql`(
    (${pointsLedger.reason}='flyer_best' AND ${pointsLedger.refId} LIKE ${`flyer:${day}:%`}) OR
    (${pointsLedger.reason}='admin_adjustment' AND ${pointsLedger.refId} LIKE ${`flyer-void:${day}:%`}))`,
      ),
    );
  return { best: best?.score ?? 0, pointsToday: paid?.points ?? 0 };
}
export async function legacyFlyerCourseFromPrices(
  tx: FlyerTx,
  catalog: ReferenceCatalog,
  now: Date,
) {
  const refs = [...new Set(Object.values(catalog).map((a) => a.referenceTicker))];
  if (!refs.length) throw new FlyerError("FLYER_UNAVAILABLE", 503);
  // A day's polling budget spans market closures and survives hourly retention.
  const sampleLimit = Math.max(
    c.pipesPerSegment,
    Math.ceil(86400 / GAME_CONFIG.prices.pollSeconds),
  );
  const result = await tx.execute<{
    ticker: string;
    price_usd: string;
    bucket: number;
    window_end: Date | string;
  }>(sql`
    WITH catalog(ticker) AS (VALUES ${sql.join(
      refs.map((r) => sql`(${r}::text)`),
      sql`, `,
    )}),
    recent AS (
      SELECT catalog.ticker,samples.price_usd,samples.taken_at FROM catalog
      CROSS JOIN LATERAL (
        SELECT DISTINCT ON (taken_at) price_usd,taken_at FROM price_snapshots
        WHERE ticker=catalog.ticker AND source='xstocks' AND price_usd>0 AND taken_at<=${now}
        ORDER BY taken_at DESC,price_usd DESC LIMIT ${sampleLimit}
      ) samples
    ), sampled AS (
      SELECT ticker,price_usd,taken_at,
        max(taken_at) OVER (PARTITION BY ticker) AS window_end,
        ntile(${c.pipesPerSegment}) OVER (PARTITION BY ticker ORDER BY taken_at) AS bucket
      FROM recent
    )
    SELECT DISTINCT ON (ticker,bucket) ticker,price_usd::text,bucket,window_end
    FROM sampled ORDER BY ticker,bucket,CASE WHEN bucket=1 THEN taken_at END ASC,taken_at DESC`);
  const segments: FlyerSegment[] = [];
  for (const [ticker, asset] of Object.entries(catalog)) {
    const rows = result.rows.filter((r) => r.ticker === asset.referenceTicker);
    if (rows.length !== c.pipesPerSegment) continue;
    const prices = rows.map((r) => r.price_usd);
    try {
      const facts =
        (STOCK_FACTS as Readonly<Record<string, readonly string[] | undefined>>)[ticker] ?? [];
      const candidate = {
        ticker,
        asset,
        prices,
        centers: [],
        changePct: predictionChange(prices[0]!, prices.at(-1)!),
        fact: facts[0] ?? null,
        windowEndsAt: new Date(rows[0]!.window_end).toISOString(),
        lastSession:
          now.getTime() - new Date(rows[0]!.window_end).getTime() >
          GAME_CONFIG.prices.staleAfterSeconds * 1000,
      };
      // Reject invalid decimals before freezing a course, without exposing provider data.
      flyerCourse(0, [candidate]);
      segments.push(candidate);
    } catch {
      continue;
    }
  }
  if (!segments.length) throw new FlyerError("FLYER_UNAVAILABLE", 503);
  return flyerCourse(randomBytes(4).readUInt32LE(), segments);
}
async function dailyCourse(
  tx: FlyerTx,
  catalog: ReferenceCatalog,
  now: Date,
): Promise<FlyerCourse> {
  const day = gameDay(now),
    [existing] = await tx.select().from(flyerDailyCourses).where(eq(flyerDailyCourses.day, day));
  if (existing) return existing.course;
  const tickers = Object.keys(catalog);
  if (!tickers.length) throw new FlyerError("FLYER_UNAVAILABLE", 503);
  const quotes = await tx
    .select()
    .from(extendedQuotes)
    .where(
      and(
        inArray(extendedQuotes.ticker, tickers),
        lte(extendedQuotes.takenAt, now),
        eq(extendedQuotes.halted, false),
      ),
    );
  const segments: FlyerSegment[] = [];
  for (const q of quotes) {
    const asset = catalog[q.ticker];
    if (
      !asset ||
      q.symbol !== (asset.priceSymbol ?? asset.symbol) ||
      q.referencePrice === null ||
      q.change24hPct === null
    )
      continue;
    const compact = {
      name: asset.name,
      provider: asset.provider,
      symbol: asset.symbol,
      referenceTicker: asset.referenceTicker,
      logo: asset.logo,
      tradeUrl: asset.tradeUrl,
      primaryColor: asset.primaryColor,
    };
    const candidate: FlyerSegment = {
      ticker: q.ticker,
      asset: compact,
      prices: [q.referencePrice, q.priceUsd],
      centers: [],
      changePct: q.change24hPct,
      fact: null,
      windowEndsAt: q.takenAt.toISOString(),
      lastSession:
        q.lastSession ||
        now.getTime() - q.takenAt.getTime() > GAME_CONFIG.extendedPrices.pollSeconds * 2000,
    };
    try {
      flyerV2Course(0, day, EXTENDED_CATALOG_VERSION, [candidate]);
      segments.push(candidate);
    } catch {
      /* A corrupt quote cannot disable the remaining catalog. */
    }
  }
  if (!segments.length) throw new FlyerError("FLYER_UNAVAILABLE", 503);
  segments.sort((a, b) => a.ticker.localeCompare(b.ticker));
  const course = flyerV2Course(
    randomBytes(4).readUInt32LE(),
    day,
    EXTENDED_CATALOG_VERSION,
    segments,
  );
  const [inserted] = await tx
    .insert(flyerDailyCourses)
    .values({ day, course, createdAt: now })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted.course;
  const [winner] = await tx.select().from(flyerDailyCourses).where(eq(flyerDailyCourses.day, day));
  if (!winner) throw new FlyerError("FLYER_UNAVAILABLE", 503);
  return winner.course;
}
async function resolveCourse(tx: FlyerTx, stored: StoredFlyerCourse): Promise<FlyerCourse> {
  if (!("dailyDay" in stored)) return stored;
  const [day] = await tx
    .select()
    .from(flyerDailyCourses)
    .where(eq(flyerDailyCourses.day, stored.dailyDay));
  if (!day || day.course.seed !== stored.seed) throw new FlyerError("FLYER_INVALID_REPLAY", 422);
  return day.course;
}
export type FlyerOptions = {
  catalog?: ReferenceCatalog;
  /** Dependency injection for legacy protocol regression tests, never client input. */
  createCourse?: (tx: FlyerTx, catalog: ReferenceCatalog, now: Date) => Promise<FlyerCourse>;
};
const empty = z.object({}).strict(),
  idBody = z.object({ sessionId: z.string().uuid() }).strict();
const finishBody = idBody
  .extend({
    ticks: z
      .number()
      .int()
      .positive()
      .max(c.sessionExpirySeconds * c.ticksPerSecond),
    score: z.number().int().nonnegative(),
    inputs: z
      .array(
        z
          .object({ tick: z.number().int().nonnegative(), action: z.enum(["press", "release"]) })
          .strict(),
      )
      .max(c.sessionExpirySeconds * c.ticksPerSecond),
  })
  .strict();
export function registerFlyer(
  app: FastifyInstance,
  options: {
    database: () => DatabaseConnection;
    now: () => Date;
    env: Record<string, string | undefined>;
  } & FlyerOptions,
) {
  const db = () => options.database().db,
    catalog = options.catalog ?? EXTENDED_ASSETS;
  async function view(userId: string) {
    return db().transaction(async (tx) => {
      const now = options.now(),
        day = gameDay(now),
        limits = flyerLimits(options.env);
      const totals = await flyerDayTotals(tx, userId, day);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(flyerSessions)
        .where(and(eq(flyerSessions.userId, userId), eq(flyerSessions.day, day)));
      const [active] = await tx
        .select({
          id: flyerSessions.id,
          startedAt: flyerSessions.startedAt,
          expiresAt: flyerSessions.expiresAt,
        })
        .from(flyerSessions)
        .where(
          and(
            eq(flyerSessions.userId, userId),
            eq(flyerSessions.state, "active"),
            gt(flyerSessions.expiresAt, now),
          ),
        );
      const maintenance = await gamePaused(tx, "flyer");
      return {
        ...totals,
        day,
        maintenance,
        available: !!limits,
        canStart: !maintenance && !!limits && !active && (count?.n ?? 0) < limits.maxFinishes,
        active: active ?? null,
        dailyCap: c.dailyPointsCap,
      };
    });
  }
  for (const action of ["read", "start", "finish", "cancel"] as const)
    app.route({
      method: action === "read" ? "GET" : "POST",
      url: action === "read" ? "/api/flyer" : `/api/flyer/${action}`,
      bodyLimit: 2 ** 21,
      handler: async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        if (!req.user) throw new AuthError("UNAUTHORIZED", 401);
        if (!empty.safeParse(req.query).success) throw new AuthError("INVALID_INPUT", 400);
        const userId = req.user.id;
        if (action === "read") return view(userId);
        const parsed = (
          action === "finish" ? finishBody : action === "cancel" ? idBody : empty
        ).safeParse(req.body ?? {});
        if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
        return db().transaction(async (tx) => {
          const [user] = await tx
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .for("no key update");
          if (!user || user.status !== "active") throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
          const now = options.now();
          if (action !== "cancel" && (await gamePaused(tx, "flyer"))) throw new GameControlError();
          const limits = flyerLimits(options.env);
          if (action !== "cancel" && !limits) throw new FlyerError("FLYER_UNAVAILABLE", 503);
          if (action === "start") {
            await tx
              .update(flyerSessions)
              .set({ state: "expired" })
              .where(
                and(
                  eq(flyerSessions.userId, userId),
                  eq(flyerSessions.state, "active"),
                  lte(flyerSessions.expiresAt, now),
                ),
              );
            const [active] = await tx
              .select()
              .from(flyerSessions)
              .where(and(eq(flyerSessions.userId, userId), eq(flyerSessions.state, "active")));
            if (active) throw new FlyerError("FLYER_ACTIVE");
            const [count] = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(flyerSessions)
              .where(and(eq(flyerSessions.userId, userId), eq(flyerSessions.day, gameDay(now))));
            if ((count?.n ?? 0) >= limits!.maxFinishes) throw new FlyerError("FLYER_LIMIT");
            // Use this transaction for a coherent course; no network price calls.
            const course = await (options.createCourse ?? dailyCourse)(tx, catalog, now);
            const [session] = await tx
              .insert(flyerSessions)
              .values({
                userId,
                startedAt: now,
                expiresAt: new Date(now.getTime() + c.sessionExpirySeconds * 1000),
                maxTicks: limits!.seconds * c.ticksPerSecond,
                course:
                  course.version === "flyer-2"
                    ? { version: "flyer-2", dailyDay: course.day!, seed: course.seed }
                    : course,
                dailyCourseDay: course.version === "flyer-2" ? course.day : null,
              })
              .returning();
            return {
              id: session!.id,
              startedAt: now.toISOString(),
              expiresAt: session!.expiresAt.toISOString(),
              maxTicks: session!.maxTicks,
              course,
            };
          }
          const input = parsed.data as { sessionId: string };
          const [session] = await tx
            .select()
            .from(flyerSessions)
            .where(and(eq(flyerSessions.id, input.sessionId), eq(flyerSessions.userId, userId)))
            .for("update");
          if (!session) throw new FlyerError("FLYER_NOT_FOUND", 404);
          if (session.state !== "active") throw new FlyerError("FLYER_REUSED");
          if (action === "cancel") {
            await tx
              .update(flyerSessions)
              .set({ state: "cancelled" })
              .where(eq(flyerSessions.id, session.id));
            return { ok: true };
          }
          if (now >= session.expiresAt) throw new FlyerError("FLYER_EXPIRED");
          const finish = parsed.data as { ticks: number; score: number; inputs: FlyerInput[] };
          const elapsed = now.getTime() - session.startedAt.getTime(),
            simulated = finish.ticks * 1000;
          if (
            elapsed <= 0 ||
            Math.abs(simulated - elapsed * c.ticksPerSecond) * 100 >
              elapsed * c.ticksPerSecond * c.timingTolerancePct
          )
            throw new FlyerError("FLYER_INVALID_REPLAY", 422);
          let result;
          const course = await resolveCourse(tx, session.course);
          try {
            result = replayFlyer(course, finish.inputs, finish.ticks, session.maxTicks);
          } catch {
            throw new FlyerError("FLYER_INVALID_REPLAY", 422);
          }
          if (result.score !== finish.score) throw new FlyerError("FLYER_INVALID_REPLAY", 422);
          const day = gameDay(now);
          const [count] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(flyerSessions)
            .where(and(eq(flyerSessions.userId, userId), eq(flyerSessions.day, day)));
          if ((count?.n ?? 0) >= limits!.maxFinishes) throw new FlyerError("FLYER_LIMIT");
          const before = await flyerDayTotals(tx, userId, day);
          await tx
            .update(flyerSessions)
            .set({
              state: "finished",
              finishedAt: now,
              day,
              score: result.score,
              ticks: result.tick,
              inputs: finish.inputs,
            })
            .where(eq(flyerSessions.id, session.id));
          const best = Math.max(before.best, result.score),
            award = Math.max(
              0,
              Math.min(c.dailyPointsCap, best * c.pointsPerPipe) - before.pointsToday,
            );
          if (award)
            await tx.insert(pointsLedger).values({
              userId,
              amount: award,
              reason: "flyer_best",
              refId: `flyer:${day}:${session.id}`,
              createdAt: now,
            });
          await rewardReferral(tx, userId, now);
          return {
            id: session.id,
            day,
            score: result.score,
            best,
            pointsAwarded: award,
            pointsToday: before.pointsToday + award,
            newBest: result.score > before.best,
            course,
          };
        });
      },
    });
  app.get("/api/flyer/leaderboard", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const input = z
      .object({ period: z.enum(["day", "week", "season"]).default("day") })
      .strict()
      .safeParse(req.query);
    if (!input.success) throw new AuthError("INVALID_INPUT", 400);
    if (!req.user) throw new AuthError("UNAUTHORIZED", 401);
    const now = options.now();
    let [season] = await db()
      .select()
      .from(seasons)
      .where(lte(seasons.startsAt, now))
      .orderBy(desc(seasons.startsAt))
      .limit(1);
    if (!season) [season] = await db().select().from(seasons).orderBy(seasons.startsAt).limit(1);
    if (!season) throw new FlyerError("FLYER_UNAVAILABLE", 503);
    const window = leaderboardWindow(input.data.period, now, {
      id: season.id,
      name: season.name,
      startsAt: season.startsAt.toISOString(),
      endsAt: season.endsAt?.toISOString() ?? null,
    });
    const result = await db().execute<{
      user_id: string;
      display_name: string;
      score: number;
      rank: number;
      reached_at: Date | string;
    }>(sql`
      WITH best AS (SELECT DISTINCT ON(s.user_id) s.user_id,u.display_name,s.score,s.finished_at
        FROM flyer_sessions s JOIN users u ON u.id=s.user_id
        WHERE s.state='finished' AND u.status='active' AND s.finished_at>=${window.startsAt}::timestamptz AND s.finished_at<=${now}
          AND (${window.endsAt}::timestamptz IS NULL OR s.finished_at<${window.endsAt}::timestamptz)
        ORDER BY s.user_id,s.score DESC,s.finished_at,s.id), ranked AS (
        SELECT user_id,display_name,score,finished_at AS reached_at,(row_number() OVER(ORDER BY score DESC,finished_at,user_id))::int AS rank FROM best)
      SELECT * FROM ranked WHERE rank<=100 OR user_id=${req.user.id} ORDER BY rank`);
    const entries = result.rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      score: r.score,
      rank: r.rank,
      reachedAt: new Date(r.reached_at).toISOString(),
    }));
    return {
      period: input.data.period,
      season: {
        id: season.id,
        name: season.name,
        startsAt: season.startsAt,
        endsAt: season.endsAt,
      },
      entries: entries.filter((r) => r.rank <= 100),
      caller: entries.find((r) => r.userId === req.user!.id) ?? null,
    };
  });
}
