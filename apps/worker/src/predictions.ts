import { and, asc, eq, gt, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { GAME_CONFIG, predictionResult } from "@stock-arena/game-core";
import {
  rewardReferral,
  hlPredictions,
  hlRuns,
  pointsLedger,
  priceSnapshots,
  tickerHalts,
  tickerStatus,
  users,
} from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";

const config = GAME_CONFIG.higherOrLower;
/** One transaction per round; consistent user -> run -> round lock order. */
export async function settlePredictions(connection: DatabaseConnection, now = new Date()) {
  const ids = await connection.db
    .select({ id: hlPredictions.id })
    .from(hlPredictions)
    .where(and(isNull(hlPredictions.settledAt), isNotNull(hlPredictions.lockedAt)))
    .orderBy(hlPredictions.lockedAt);
  for (const { id } of ids)
    await connection.db.transaction(async (tx) => {
      const [info] = await tx
        .select({ run: hlRuns })
        .from(hlPredictions)
        .innerJoin(hlRuns, eq(hlRuns.id, hlPredictions.runId))
        .where(eq(hlPredictions.id, id));
      if (!info) return;
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, info.run.userId))
        .for("no key update");
      const [run] = await tx.select().from(hlRuns).where(eq(hlRuns.id, info.run.id)).for("update");
      let [round] = await tx
        .select()
        .from(hlPredictions)
        .where(eq(hlPredictions.id, id))
        .for("update");
      if (!round || round.settledAt || !round.lockedAt || !round.direction || !run) return;
      const [status] = await tx
        .select()
        .from(tickerStatus)
        .where(eq(tickerStatus.ticker, round.referenceTicker));
      const tolerance = GAME_CONFIG.prices.staleAfterSeconds * 1000;
      const retry = config.settlementRetryHours * 3_600_000;
      const finish = async (
        state: "won" | "lost" | "equal" | "void",
        end?: typeof priceSnapshots.$inferSelect,
      ) => {
        await tx
          .update(hlPredictions)
          .set({
            state,
            settledAt: now,
            ...(end ? { endPrice: end.priceUsd, endTakenAt: end.takenAt } : {}),
          })
          .where(eq(hlPredictions.id, id));
        const correctCount = run.correctCount + Number(state === "won");
        await tx
          .update(hlRuns)
          .set({
            correctCount,
            lastSettledAt: now,
            endedAt:
              state === "lost" || correctCount >= config.maxCorrectPerRun ? now : run.endedAt,
          })
          .where(eq(hlRuns.id, run.id));
        if (state === "won")
          await tx.insert(pointsLedger).values({
            userId: run.userId,
            amount: config.pointsPerCorrect,
            reason: "higher_lower",
            refId: `hl:${id}`,
            createdAt: now,
          });
        if (state === "won") await rewardReferral(tx, run.userId, now);
      };
      if (!user || user.status !== "active") {
        await finish("void");
        return;
      }
      const boundary = round.scheduledOpenAt ?? round.lockedAt;
      if (!round.startTakenAt) {
        if (
          round.scheduledOpenAt &&
          (!status?.lastOpenedAt ||
            status.lastOpenedAt < round.scheduledOpenAt ||
            status.lastOpenedAt > now)
        ) {
          if (now.getTime() >= boundary.getTime() + retry) await finish("void");
          return;
        }
        const startBoundary = round.scheduledOpenAt ? status!.lastOpenedAt! : round.lockedAt;
        const [start] = await tx
          .select()
          .from(priceSnapshots)
          .where(
            and(
              eq(priceSnapshots.ticker, round.referenceTicker),
              eq(priceSnapshots.source, "xstocks"),
              eq(priceSnapshots.tradable, true),
              round.scheduledOpenAt
                ? gte(priceSnapshots.takenAt, startBoundary)
                : gt(priceSnapshots.takenAt, startBoundary),
              lte(
                priceSnapshots.takenAt,
                new Date(Math.min(now.getTime(), boundary.getTime() + retry)),
              ),
            ),
          )
          .orderBy(asc(priceSnapshots.takenAt))
          .limit(1);
        if (!start) {
          if (now.getTime() >= boundary.getTime() + retry) await finish("void");
          return;
        }
        const targetAt = new Date(start.takenAt.getTime() + config.predictionMinutes * 60_000);
        [round] = await tx
          .update(hlPredictions)
          .set({
            startPrice: start.priceUsd,
            startTakenAt: start.takenAt,
            targetAt,
            state: "pending",
          })
          .where(eq(hlPredictions.id, id))
          .returning();
      }
      if (!round?.startTakenAt || !round.targetAt || !round.startPrice) return;
      const [end] = await tx
        .select()
        .from(priceSnapshots)
        .where(
          and(
            eq(priceSnapshots.ticker, round.referenceTicker),
            eq(priceSnapshots.source, "xstocks"),
            eq(priceSnapshots.tradable, true),
            gte(priceSnapshots.takenAt, round.targetAt),
            lte(
              priceSnapshots.takenAt,
              new Date(Math.min(now.getTime(), round.targetAt.getTime() + tolerance)),
            ),
          ),
        )
        .orderBy(asc(priceSnapshots.takenAt))
        .limit(1);
      const until =
        end?.takenAt ?? new Date(Math.min(now.getTime(), round.targetAt.getTime() + tolerance));
      const [halt] = await tx
        .select()
        .from(tickerHalts)
        .where(
          and(
            eq(tickerHalts.ticker, round.referenceTicker),
            gte(tickerHalts.takenAt, round.startTakenAt),
            lte(tickerHalts.takenAt, until),
          ),
        )
        .limit(1);
      if (halt) {
        await finish("void");
        return;
      }
      if (end) {
        await finish(predictionResult(round.startPrice, end.priceUsd, round.direction!), end);
        return;
      }
      if (now.getTime() >= round.targetAt.getTime() + retry) await finish("void");
    });
  const runs = await connection.db
    .select()
    .from(hlRuns)
    .where(and(eq(hlRuns.model, "prediction"), isNull(hlRuns.endedAt)));
  for (const run of runs)
    await connection.db.transaction(async (tx) => {
      await tx.select().from(users).where(eq(users.id, run.userId)).for("update");
      const [current] = await tx.select().from(hlRuns).where(eq(hlRuns.id, run.id)).for("update");
      if (
        !current ||
        current.endedAt ||
        now.getTime() - (current.lastSettledAt ?? current.createdAt).getTime() <
          config.runExpiryHours * 3_600_000
      )
        return;
      const [pending] = await tx
        .select()
        .from(hlPredictions)
        .where(
          and(
            eq(hlPredictions.runId, run.id),
            isNull(hlPredictions.settledAt),
            isNotNull(hlPredictions.lockedAt),
          ),
        )
        .limit(1);
      if (pending) return;
      await tx.update(hlRuns).set({ endedAt: now }).where(eq(hlRuns.id, run.id));
      await tx
        .update(hlPredictions)
        .set({ state: "void", settledAt: now })
        .where(and(eq(hlPredictions.runId, run.id), isNull(hlPredictions.settledAt)));
    });
  return ids.length;
}
