import { and, desc, eq, gte, inArray, lt, lte, or } from "drizzle-orm";
import { GAME_CONFIG } from "@stock-arena/game-core";
import type { AssetCatalog } from "@stock-arena/game-core";
import { priceSnapshots, tickerStatus } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";

export type MarketPrice = {
  ticker: string;
  priceUsd: string | null;
  takenAt: string | null;
  change24hPct: number | null;
  state: "live" | "paused";
  reason: string | null;
  nextChangeAt: string | null;
  closedForSession: boolean;
  lastSession: { priceUsd: string; change24hPct: number } | null;
};
type Transaction = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];

/** Only persisted primary quotes count. A missing 24h baseline never becomes zero. */
export async function readMarket(
  tx: Transaction,
  catalog: AssetCatalog,
  now: Date,
  options: { lastSession?: boolean } = {},
): Promise<MarketPrice[]> {
  const references = [...new Set(Object.values(catalog).map((asset) => asset.referenceTicker))];
  if (!references.length) return [];
  const tolerance = GAME_CONFIG.prices.staleAfterSeconds * 1000;
  const target = new Date(now.getTime() - 86_400_000);
  const latest = await tx
    .selectDistinctOn([priceSnapshots.ticker])
    .from(priceSnapshots)
    .where(
      and(
        inArray(priceSnapshots.ticker, references),
        eq(priceSnapshots.source, "xstocks"),
        lte(priceSnapshots.takenAt, now),
      ),
    )
    .orderBy(priceSnapshots.ticker, desc(priceSnapshots.takenAt));
  const baselines = await tx
    .selectDistinctOn([priceSnapshots.ticker])
    .from(priceSnapshots)
    .where(
      and(
        inArray(priceSnapshots.ticker, references),
        eq(priceSnapshots.source, "xstocks"),
        lte(priceSnapshots.takenAt, target),
        gte(priceSnapshots.takenAt, new Date(target.getTime() - tolerance)),
      ),
    )
    .orderBy(priceSnapshots.ticker, desc(priceSnapshots.takenAt));
  const statuses = await tx
    .select()
    .from(tickerStatus)
    .where(inArray(tickerStatus.ticker, references));
  const closed = statuses.filter(
    (status) =>
      status.state === "paused" &&
      status.reason === "closed" &&
      status.tradingPeriod === "closed" &&
      status.tradingHalted === false &&
      status.updatedAt <= now &&
      now.getTime() - status.updatedAt.getTime() <= tolerance &&
      (!status.periodChangeAt || status.periodChangeAt > now),
  );
  const anchors = options.lastSession
    ? closed.filter((status) => status.lastClosedAt && status.lastClosedAt <= now)
    : [];
  const sessionRows = async (offset: number) =>
    anchors.length
      ? tx
          .selectDistinctOn([priceSnapshots.ticker])
          .from(priceSnapshots)
          .where(
            and(
              eq(priceSnapshots.source, "xstocks"),
              or(
                ...anchors.map((status) => {
                  const end = new Date(status.lastClosedAt!.getTime() - offset);
                  return and(
                    eq(priceSnapshots.ticker, status.ticker),
                    offset === 0
                      ? lt(priceSnapshots.takenAt, end)
                      : lte(priceSnapshots.takenAt, end),
                    gte(priceSnapshots.takenAt, new Date(end.getTime() - tolerance)),
                  );
                }),
              ),
            ),
          )
          .orderBy(priceSnapshots.ticker, desc(priceSnapshots.takenAt))
      : [];
  const sessionCloses = await sessionRows(0);
  const sessionBaselines = await sessionRows(86_400_000);
  return Object.entries(catalog).map(([ticker, asset]) => {
    const last = latest.find((row) => row.ticker === asset.referenceTicker);
    const baseline = baselines.find((row) => row.ticker === asset.referenceTicker);
    const status = statuses.find((row) => row.ticker === asset.referenceTicker);
    const valid = Boolean(
      last && Number.isFinite(Number(last.priceUsd)) && Number(last.priceUsd) > 0,
    );
    const fresh = valid && now.getTime() - last!.takenAt.getTime() <= tolerance;
    const change =
      valid && baseline && Number(baseline.priceUsd) > 0
        ? (Number(last!.priceUsd) / Number(baseline.priceUsd) - 1) * 100
        : null;
    const paused = status?.state === "paused" || !fresh || !status;
    const sessionClose = sessionCloses.find((row) => row.ticker === asset.referenceTicker);
    const sessionBaseline = sessionBaselines.find((row) => row.ticker === asset.referenceTicker);
    const sessionChange =
      sessionClose &&
      sessionBaseline &&
      Number(sessionClose.priceUsd) > 0 &&
      Number(sessionBaseline.priceUsd) > 0
        ? (Number(sessionClose.priceUsd) / Number(sessionBaseline.priceUsd) - 1) * 100
        : null;
    return {
      ticker,
      priceUsd: valid ? last!.priceUsd : null,
      takenAt: valid ? last!.takenAt.toISOString() : null,
      change24hPct: change !== null && Number.isFinite(change) ? change : null,
      state: paused ? "paused" : "live",
      reason: status?.state === "paused" ? (status.reason ?? "stale") : paused ? "stale" : null,
      closedForSession: closed.some((row) => row.ticker === asset.referenceTicker),
      lastSession:
        sessionClose && sessionChange !== null && Number.isFinite(sessionChange)
          ? { priceUsd: sessionClose.priceUsd, change24hPct: sessionChange }
          : null,
      nextChangeAt:
        status?.state === "paused" &&
        status.reason === "closed" &&
        status.nextChangeAt &&
        status.nextChangeAt > now
          ? status.nextChangeAt.toISOString()
          : null,
    };
  });
}
