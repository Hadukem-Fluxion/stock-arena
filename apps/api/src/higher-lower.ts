import { randomInt } from "node:crypto";
import { and, desc, eq, isNull, or, gte } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ASSETS, GAME_CONFIG, gameDay, predictionChange } from "@stock-arena/game-core";
import type { AssetCatalog, PredictionView } from "@stock-arena/game-core";
import { hlPredictions, hlRuns, tickerStatus, users } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { AuthError } from "./auth/types.js";
import { readMarket } from "./market.js";

export class HlError extends Error {
  constructor(
    public readonly code:
      "HL_DAILY_LIMIT" | "HL_OUT_OF_ORDER" | "HL_DAY_EXPIRED" | "HL_UNAVAILABLE",
    public readonly statusCode = 409,
  ) {
    super(code);
  }
}
export type HlOptions = { catalog?: AssetCatalog; choose?: (length: number) => number };
type Action =
  | { type: "read" }
  | { type: "start"; requestId: string }
  | { type: "next"; runId: string }
  | { type: "pick"; runId: string; roundId: string; direction: "up" | "down" };
const config = GAME_CONFIG.higherOrLower;
const expiry = (run: typeof hlRuns.$inferSelect) =>
  new Date((run.lastSettledAt ?? run.createdAt).getTime() + config.runExpiryHours * 3_600_000);

export function createHlStore(
  connection: DatabaseConnection,
  options: HlOptions & { now?: () => Date } = {},
) {
  const catalog: AssetCatalog = options.catalog ?? ASSETS;
  return (userId: string, action: Action): Promise<PredictionView> => {
    const receivedAt = (options.now ?? (() => new Date()))();
    return connection.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw new AuthError("UNAUTHORIZED", 401);
      if (user.status !== "active") throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
      const now = receivedAt,
        day = gameDay(now);
      const today = await tx
        .select()
        .from(hlRuns)
        .where(and(eq(hlRuns.userId, userId), eq(hlRuns.day, day)));
      const loadRuns = () =>
        tx
          .select()
          .from(hlRuns)
          .where(
            and(
              eq(hlRuns.userId, userId),
              eq(hlRuns.model, "prediction"),
              or(
                eq(hlRuns.day, day),
                isNull(hlRuns.endedAt),
                gte(hlRuns.lastSettledAt, new Date(now.getTime() - 86_400_000)),
              ),
            ),
          )
          .orderBy(desc(hlRuns.createdAt));
      let runs = await loadRuns();
      const roundFor = async (runId: string) =>
        (
          await tx
            .select()
            .from(hlPredictions)
            .where(eq(hlPredictions.runId, runId))
            .orderBy(desc(hlPredictions.position))
            .limit(1)
        )[0];
      const active = async () => {
        let count = 0;
        for (const run of runs) {
          const round = await roundFor(run.id);
          if (!run.endedAt && ((round?.lockedAt && !round.settledAt) || expiry(run) > now)) count++;
        }
        return count;
      };
      const candidates = async () => {
        const market = await readMarket(tx, catalog, now);
        const statuses = await tx.select().from(tickerStatus);
        return market.filter((price) => {
          const status = statuses.find(
            (row) => row.ticker === catalog[price.ticker]!.referenceTicker,
          );
          if (
            !status ||
            status.tradingHalted !== false ||
            status.updatedAt > now ||
            now.getTime() - status.updatedAt.getTime() > GAME_CONFIG.prices.staleAfterSeconds * 1000
          )
            return false;
          return (
            price.state === "live" ||
            (price.closedForSession && !!status.nextChangeAt && status.nextChangeAt > now)
          );
        });
      };
      const offer = async (runId: string, position: number) => {
        const eligible = await candidates();
        if (!eligible.length) throw new HlError("HL_UNAVAILABLE");
        const stock = eligible[(options.choose ?? randomInt)(eligible.length)];
        if (!stock) throw new HlError("HL_UNAVAILABLE");
        const asset = catalog[stock.ticker]!;
        await tx.insert(hlPredictions).values({
          runId,
          position,
          ticker: stock.ticker,
          referenceTicker: asset.referenceTicker,
          asset,
          offeredAt: now,
        });
      };
      if (action.type === "start") {
        const duplicate = (
          await tx
            .select()
            .from(hlRuns)
            .where(and(eq(hlRuns.userId, userId), eq(hlRuns.requestId, action.requestId)))
        )[0];
        if (!duplicate) {
          if (today.length >= config.runsPerDay || (await active()) >= config.runsPerDay)
            throw new HlError("HL_DAILY_LIMIT");
          const [run] = await tx
            .insert(hlRuns)
            .values({
              userId,
              day,
              model: "prediction",
              runNumber: today.length + 1,
              requestId: action.requestId,
              createdAt: now,
            })
            .returning();
          await offer(run!.id, 0);
          today.push(run!);
        }
      }
      if (action.type === "next" || action.type === "pick") {
        const [run] = await tx
          .select()
          .from(hlRuns)
          .where(
            and(
              eq(hlRuns.userId, userId),
              eq(hlRuns.id, action.runId),
              eq(hlRuns.model, "prediction"),
            ),
          )
          .for("update");
        if (!run) throw new HlError("HL_OUT_OF_ORDER");
        const round = await roundFor(run.id);
        if (!round) throw new HlError("HL_OUT_OF_ORDER");
        if (action.type === "pick" && round.id !== action.roundId)
          throw new HlError("HL_OUT_OF_ORDER");
        if (action.type === "pick" && round.lockedAt) {
          /* Idempotent: preserve the committed choice. */
        } else if (run.endedAt || ((!round.lockedAt || round.settledAt) && expiry(run) <= now))
          throw new HlError("HL_DAY_EXPIRED");
        else if (action.type === "next") {
          if (round.settledAt) await offer(run.id, round.position + 1);
        } else {
          const stock = (await candidates()).find((row) => row.ticker === round.ticker);
          if (!stock) throw new HlError("HL_UNAVAILABLE");
          const [status] = await tx
            .select()
            .from(tickerStatus)
            .where(eq(tickerStatus.ticker, round.referenceTicker));
          const opening = stock.closedForSession ? status!.nextChangeAt : null;
          await tx
            .update(hlPredictions)
            .set({
              direction: action.direction,
              lockedAt: now,
              scheduledOpenAt: opening,
              state: opening ? "waiting_open" : "waiting_start",
            })
            .where(eq(hlPredictions.id, round.id));
        }
      }
      runs = await loadRuns();
      const visible: PredictionView["runs"] = [];
      for (const run of runs) {
        const round = await roundFor(run.id);
        const expired = !run.endedAt && (!round?.lockedAt || round.settledAt) && expiry(run) <= now;
        visible.push({
          id: run.id,
          day: run.day,
          number: run.runNumber,
          correctCount: run.correctCount,
          score: run.correctCount * config.pointsPerCorrect,
          endedAt: run.endedAt?.toISOString() ?? (expired ? expiry(run).toISOString() : null),
          expiresAt: expiry(run).toISOString(),
          round: round
            ? {
                id: round.id,
                ticker: round.ticker,
                asset: round.asset,
                state: round.state,
                direction: round.direction,
                lockedAt: round.lockedAt?.toISOString() ?? null,
                scheduledOpenAt: round.scheduledOpenAt?.toISOString() ?? null,
                startPrice: round.startPrice,
                startTakenAt: round.startTakenAt?.toISOString() ?? null,
                targetAt: round.targetAt?.toISOString() ?? null,
                endPrice: round.endPrice,
                endTakenAt: round.endTakenAt?.toISOString() ?? null,
                settledAt: round.settledAt?.toISOString() ?? null,
                changePct:
                  round.startPrice && round.endPrice
                    ? predictionChange(round.startPrice, round.endPrice)
                    : null,
              }
            : null,
        });
      }
      return {
        day,
        serverTime: now.toISOString(),
        runsUsed: today.length,
        runsLimit: config.runsPerDay,
        maxCorrect: config.maxCorrectPerRun,
        pointsPerCorrect: config.pointsPerCorrect,
        canStart:
          today.length < config.runsPerDay &&
          (await active()) < config.runsPerDay &&
          (await candidates()).length > 0,
        runs: visible,
      };
    });
  };
}
export function registerHl(
  app: FastifyInstance,
  options: HlOptions & { database: () => DatabaseConnection; now?: () => Date },
) {
  let store: ReturnType<typeof createHlStore> | undefined;
  const empty = z.object({}).strict();
  const schemas = {
    read: empty,
    start: z.object({ requestId: z.string().uuid() }).strict(),
    next: z.object({ runId: z.string().uuid() }).strict(),
    pick: z
      .object({
        runId: z.string().uuid(),
        roundId: z.string().uuid(),
        direction: z.enum(["up", "down"]),
      })
      .strict(),
  };
  for (const type of ["read", "start", "next", "pick"] as const)
    app.route({
      method: type === "read" ? "GET" : "POST",
      url: type === "read" ? "/api/hl" : `/api/hl/${type}`,
      handler: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        if (!request.user) throw new AuthError("UNAUTHORIZED", 401);
        if (!empty.safeParse(request.query).success) throw new AuthError("INVALID_INPUT", 400);
        const parsed = schemas[type].safeParse(type === "read" ? {} : request.body);
        if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
        store ??= createHlStore(options.database(), options);
        return store(request.user.id, { type, ...parsed.data } as Action);
      },
    });
}
