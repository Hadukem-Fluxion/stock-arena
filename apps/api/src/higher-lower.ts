import { randomInt } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ASSETS, GAME_CONFIG, gameDay, higherOrLowerWinner } from "@stock-arena/game-core";
import type { AssetCatalog, HlStock, HlView } from "@stock-arena/game-core";
import { hlRounds, hlRuns, pointsLedger, users } from "@stock-arena/db";
import type { DatabaseConnection, HlStockSnapshot } from "@stock-arena/db";
import { AuthError } from "./auth/types.js";
import { readMarket } from "./market.js";

export class HlError extends Error {
  constructor(
    public readonly code: "HL_DAILY_LIMIT" | "HL_OUT_OF_ORDER" | "HL_DAY_EXPIRED",
    public readonly statusCode = 409,
  ) {
    super(code);
  }
}
type Pick = { runId: string; roundId: string; ticker: string };
type Action = { type: "read" | "start" | "next" } | { type: "pick"; pick: Pick };
export type HlOptions = { catalog?: AssetCatalog; choose?: (length: number) => number };

export function createHlStore(
  connection: DatabaseConnection,
  options: HlOptions & { now?: () => Date } = {},
) {
  const catalog: AssetCatalog = options.catalog ?? ASSETS;
  const config = GAME_CONFIG.higherOrLower;
  return async (userId: string, action: Action): Promise<HlView> =>
    connection.db.transaction(async (tx) => {
      // All run transitions and ledger inserts serialize on this player's row.
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw new AuthError("UNAUTHORIZED", 401);
      if (user.status !== "active") throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
      const now = (options.now ?? (() => new Date()))();
      const day = gameDay(now);
      const runs = await tx
        .select()
        .from(hlRuns)
        .where(and(eq(hlRuns.userId, userId), eq(hlRuns.day, day)))
        .orderBy(desc(hlRuns.runNumber));
      let run = runs[0];
      if (action.type === "pick" && action.pick.runId !== run?.id) {
        const [old] = await tx
          .select()
          .from(hlRuns)
          .where(and(eq(hlRuns.id, action.pick.runId), eq(hlRuns.userId, userId)));
        throw new HlError(old && old.day !== day ? "HL_DAY_EXPIRED" : "HL_OUT_OF_ORDER");
      }
      let [round] = run
        ? await tx
            .select()
            .from(hlRounds)
            .where(eq(hlRounds.runId, run.id))
            .orderBy(desc(hlRounds.position))
            .limit(1)
        : [];
      const market = await readMarket(tx, catalog, now);
      const paused = market
        .filter((price) => price.state === "paused")
        .map((price) => ({ ticker: price.ticker, reason: price.reason ?? "stale" }));
      const eligible = market.flatMap((price): HlStockSnapshot[] =>
        price.state === "live" && price.priceUsd && price.change24hPct !== null
          ? [{ ticker: price.ticker, priceUsd: price.priceUsd, change24hPct: price.change24hPct }]
          : [],
      );
      const pairs: { stocks: [HlStockSnapshot, HlStockSnapshot]; winner: string }[] = [];
      for (let i = 0; i < eligible.length; i++)
        for (let j = i + 1; j < eligible.length; j++) {
          const a = eligible[i]!,
            b = eligible[j]!;
          if (catalog[a.ticker]!.referenceTicker === catalog[b.ticker]!.referenceTicker) continue;
          const winner = higherOrLowerWinner(a, b);
          if (winner) pairs.push({ stocks: [a, b], winner });
        }
      const needsNew =
        (action.type === "start" && (!run || run.endedAt)) ||
        (action.type === "next" && run && !run.endedAt && round?.choice);
      let unavailable = false;
      if (needsNew) {
        if (action.type === "start" && runs.length >= config.runsPerDay)
          throw new HlError("HL_DAILY_LIMIT");
        if (!pairs.length) unavailable = true;
        else {
          const pair = pairs[(options.choose ?? randomInt)(pairs.length)];
          if (!pair) throw new Error("Invalid round selection.");
          if (action.type === "start") {
            [run] = await tx
              .insert(hlRuns)
              .values({ userId, day, runNumber: runs.length + 1 })
              .returning();
            if (!run) throw new Error("Missing run.");
            runs.unshift(run);
          }
          if (!run) throw new HlError("HL_OUT_OF_ORDER");
          [round] = await tx
            .insert(hlRounds)
            .values({ runId: run.id, position: run.correctCount, ...pair, servedAt: now })
            .returning();
        }
      }
      const roundPaused =
        round &&
        !round.choice &&
        round.stocks.some(
          (stock) =>
            !market.some((price) => price.ticker === stock.ticker && price.state === "live"),
        );
      if (action.type === "pick") {
        if (!run || !round || round.id !== action.pick.roundId)
          throw new HlError("HL_OUT_OF_ORDER");
        if (!round.stocks.some((stock) => stock.ticker === action.pick.ticker))
          throw new AuthError("INVALID_INPUT", 400);
        if (!round.choice && !run.endedAt && !roundPaused) {
          const correct = action.pick.ticker === round.winner;
          const count = run.correctCount + Number(correct);
          [round] = await tx
            .update(hlRounds)
            .set({ choice: action.pick.ticker, answeredAt: now })
            .where(eq(hlRounds.id, round.id))
            .returning();
          [run] = await tx
            .update(hlRuns)
            .set({
              correctCount: count,
              endedAt: !correct || count >= config.maxCorrectPerRun ? now : null,
            })
            .where(eq(hlRuns.id, run.id))
            .returning();
          if (correct)
            await tx.insert(pointsLedger).values({
              userId,
              amount: config.pointsPerCorrect,
              reason: "higher_lower",
              refId: `hl:${action.pick.roundId}`,
              createdAt: now,
            });
        }
      }
      const publicStock = (stock: HlStockSnapshot): HlStock => {
        const asset = catalog[stock.ticker];
        if (!asset) throw new Error("Round asset missing from catalog.");
        return { ticker: stock.ticker, asset, priceUsd: stock.priceUsd };
      };
      const feedback: HlView["feedback"] = round?.choice
        ? {
            choice: round.choice,
            winner: round.winner,
            correct: round.choice === round.winner,
            stocks: round.stocks.map((stock) => ({
              ...publicStock(stock),
              change24hPct: stock.change24hPct,
            })) as NonNullable<HlView["feedback"]>["stocks"],
          }
        : null;
      return {
        day,
        serverTime: now.toISOString(),
        runsUsed: runs.length,
        runsLimit: config.runsPerDay,
        maxCorrect: config.maxCorrectPerRun,
        pointsPerCorrect: config.pointsPerCorrect,
        status:
          unavailable || roundPaused || (!run && !pairs.length)
            ? "paused"
            : run?.endedAt
              ? "completed"
              : feedback
                ? "feedback"
                : round
                  ? "round"
                  : "ready",
        run: run
          ? {
              id: run.id,
              number: run.runNumber,
              correctCount: run.correctCount,
              score: run.correctCount * config.pointsPerCorrect,
            }
          : null,
        round:
          round && !round.choice
            ? {
                id: round.id,
                position: round.position,
                stocks: [publicStock(round.stocks[0]), publicStock(round.stocks[1])],
              }
            : null,
        feedback,
        paused,
      };
    });
}

export function registerHl(
  app: FastifyInstance,
  options: HlOptions & { database: () => DatabaseConnection; now?: () => Date },
) {
  let store: ReturnType<typeof createHlStore> | undefined;
  const empty = z.object({}).strict();
  const pick = z
    .object({
      runId: z.string().uuid(),
      roundId: z.string().uuid(),
      ticker: z.string().min(1).max(100),
    })
    .strict();
  for (const action of ["read", "start", "next", "pick"] as const)
    app.route({
      method: action === "read" ? "GET" : "POST",
      url: action === "read" ? "/api/hl" : `/api/hl/${action}`,
      handler: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        if (!request.user) throw new AuthError("UNAUTHORIZED", 401);
        if (!empty.safeParse(request.query).success) throw new AuthError("INVALID_INPUT", 400);
        store ??= createHlStore(options.database(), options);
        if (action === "pick") {
          const input = pick.safeParse(request.body);
          if (!input.success) throw new AuthError("INVALID_INPUT", 400);
          return store(request.user.id, { type: "pick", pick: input.data });
        }
        if (action !== "read" && !empty.safeParse(request.body ?? {}).success)
          throw new AuthError("INVALID_INPUT", 400);
        return store(request.user.id, { type: action });
      },
    });
}
