import { GAME_CONFIG } from "@stock-arena/game-core";
import { priceSnapshots } from "@stock-arena/db";
import type { DatabaseConnection, LastSessionSnapshot } from "@stock-arena/db";
import { and, desc, eq, gte, lt, lte } from "drizzle-orm";

type Transaction = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];

/** Called only when closing is confirmed; later quotes cannot rewrite the session. */
export async function captureLastSession(
  tx: Transaction,
  ticker: string,
  closedAt: Date,
): Promise<LastSessionSnapshot | null> {
  const tolerance = GAME_CONFIG.prices.staleAfterSeconds * 1000;
  const sample = async (target: Date, before: boolean) => {
    const [row] = await tx
      .select()
      .from(priceSnapshots)
      .where(
        and(
          eq(priceSnapshots.ticker, ticker),
          eq(priceSnapshots.source, "xstocks"),
          before ? lt(priceSnapshots.takenAt, target) : lte(priceSnapshots.takenAt, target),
          gte(priceSnapshots.takenAt, new Date(target.getTime() - tolerance)),
        ),
      )
      .orderBy(desc(priceSnapshots.takenAt))
      .limit(1);
    return row;
  };
  const close = await sample(closedAt, true);
  const baseline = await sample(new Date(closedAt.getTime() - 86_400_000), false);
  if (!close || !baseline) return null;
  const price = Number(close.priceUsd),
    base = Number(baseline.priceUsd);
  const change = (price / base - 1) * 100;
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(base) ||
    base <= 0 ||
    !Number.isFinite(change)
  )
    return null;
  return {
    closedAt: closedAt.toISOString(),
    priceUsd: close.priceUsd,
    change24hPct: change,
    closeTakenAt: close.takenAt.toISOString(),
    baselinePriceUsd: baseline.priceUsd,
    baselineTakenAt: baseline.takenAt.toISOString(),
  };
}
