import {
  ASSETS,
  STOCK_FACTS,
  GAME_CONFIG,
  assetTickers,
  checkinAwards,
  nextStreak,
  stockOfTheDay,
  gameDay,
  dayNumber,
  addDays,
} from "@stock-arena/game-core";
import type { AssetCatalog, CheckinView } from "@stock-arena/game-core";
import { checkins, pointsLedger, priceSnapshots, tickerStatus, users } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError } from "./auth/types.js";

export class GameError extends Error {
  readonly statusCode = 409;
  readonly code = "ALREADY_CHECKED_IN";
}
export type CheckinOptions = {
  catalog?: AssetCatalog;
  facts?: Readonly<Record<string, readonly string[] | undefined>>;
};

export function createCheckinStore(
  connection: DatabaseConnection,
  options: CheckinOptions & { now?: () => Date } = {},
) {
  const catalog = options.catalog ?? ASSETS;
  const facts = options.facts ?? STOCK_FACTS;
  const tickers = assetTickers(catalog);
  if (!tickers.length) throw new Error("No assets configured.");

  return async (userId: string, award: boolean): Promise<CheckinView> =>
    connection.db.transaction(async (tx) => {
      // Serialize actions for this player before reading the streak. Unique action
      // and ledger constraints remain the final protection against duplicate awards.
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw new AuthError("UNAUTHORIZED", 401);
      if (user.status !== "active") throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
      const instant = (options.now ?? (() => new Date()))();
      const today = gameDay(instant);
      const [last] = await tx
        .select()
        .from(checkins)
        .where(and(eq(checkins.userId, userId), lte(checkins.day, today)))
        .orderBy(desc(checkins.day))
        .limit(1);
      if (award) {
        if (last?.day === today) throw new GameError();
        const streak = nextStreak(today, last ?? null);
        await tx.insert(checkins).values({ userId, day: today, streak });
        await tx.insert(pointsLedger).values(
          checkinAwards(streak).map((entry) => ({
            ...entry,
            userId,
            refId: `checkin:${today}`,
            createdAt: instant,
          })),
        );
      }
      const [current] = await tx
        .select()
        .from(checkins)
        .where(and(eq(checkins.userId, userId), eq(checkins.day, today)));
      const [balance] = await tx
        .select({ amount: sql<string>`coalesce(sum(${pointsLedger.amount}),0)::text` })
        .from(pointsLedger)
        .where(eq(pointsLedger.userId, userId));
      const total = Number(balance?.amount ?? 0);
      if (!Number.isSafeInteger(total)) throw new Error("Invalid points balance.");
      const awardsToday = await tx
        .select({ amount: pointsLedger.amount, reason: pointsLedger.reason })
        .from(pointsLedger)
        .where(and(eq(pointsLedger.userId, userId), eq(pointsLedger.refId, `checkin:${today}`)));
      const ticker = stockOfTheDay(today, tickers);
      const asset = catalog[ticker];
      if (!asset) throw new Error("Missing catalog asset.");
      const [latest] = await tx
        .select()
        .from(priceSnapshots)
        .where(
          and(
            eq(priceSnapshots.ticker, asset.referenceTicker),
            eq(priceSnapshots.source, "xstocks"),
            lte(priceSnapshots.takenAt, instant),
          ),
        )
        .orderBy(desc(priceSnapshots.takenAt))
        .limit(1);
      const target = new Date(instant.getTime() - 86_400_000);
      const tolerance = GAME_CONFIG.prices.staleAfterSeconds * 1000;
      const [baseline] = await tx
        .select()
        .from(priceSnapshots)
        .where(
          and(
            eq(priceSnapshots.ticker, asset.referenceTicker),
            eq(priceSnapshots.source, "xstocks"),
            lte(priceSnapshots.takenAt, target),
            gte(priceSnapshots.takenAt, new Date(target.getTime() - tolerance)),
          ),
        )
        .orderBy(desc(priceSnapshots.takenAt))
        .limit(1);
      const [status] = await tx
        .select()
        .from(tickerStatus)
        .where(eq(tickerStatus.ticker, asset.referenceTicker));
      const validPrice =
        latest && Number.isFinite(Number(latest.priceUsd)) && Number(latest.priceUsd) > 0;
      const fresh = validPrice && instant.getTime() - latest.takenAt.getTime() <= tolerance;
      const paused = status?.state === "paused";
      const reason = paused ? (status.reason ?? "stale") : !fresh || !status ? "stale" : null;
      const change =
        validPrice && baseline && Number(baseline.priceUsd) > 0
          ? (Number(latest.priceUsd) / Number(baseline.priceUsd) - 1) * 100
          : null;
      const stockFacts = facts[ticker] ?? [];
      return {
        serverTime: instant.toISOString(),
        day: today,
        checkedIn: Boolean(current),
        streak: current?.streak ?? (last?.day === addDays(today, -1) ? last.streak : 0),
        balance: total,
        awardsToday,
        catalog,
        stock: {
          ticker,
          asset,
          fact: stockFacts.length
            ? (stockFacts[
                ((dayNumber(today) % stockFacts.length) + stockFacts.length) % stockFacts.length
              ] ?? null)
            : null,
          price: {
            usd: validPrice ? latest.priceUsd : null,
            change24hPct:
              change !== null && Number.isFinite(change) ? Number(change.toFixed(6)) : null,
            takenAt: validPrice ? latest.takenAt.toISOString() : null,
            state: paused || !fresh || !status ? "paused" : "live",
            reason,
          },
        },
      };
    });
}

export function registerCheckin(
  app: FastifyInstance,
  options: CheckinOptions & { database: () => DatabaseConnection; now?: () => Date },
) {
  let store: ReturnType<typeof createCheckinStore> | undefined;
  const empty = z.object({}).strict();
  for (const method of ["GET", "POST"] as const)
    app.route({
      method,
      url: "/api/checkin",
      handler: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        if (
          !empty.safeParse(request.query).success ||
          (method === "POST" && !empty.safeParse(request.body ?? {}).success)
        )
          throw new AuthError("INVALID_INPUT", 400);
        if (!request.user) throw new AuthError("UNAUTHORIZED", 401);
        store ??= createCheckinStore(options.database(), options);
        const view = await store(request.user.id, method === "POST");
        if (method === "POST") reply.code(201);
        return view;
      },
    });
}
