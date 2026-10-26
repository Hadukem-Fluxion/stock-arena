import { GAME_CONFIG, predictionChange } from "@stock-arena/game-core";
import { extendedQuotes, extendedPriceReferences, priceSnapshots } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import type { ExtendedObservation } from "@stock-arena/fluxion-oracle";
import { and, eq, inArray, lte, sql, lt } from "drizzle-orm";

/** Keep a durable summary and only the temporary references needed for 24h change. */
export function createExtendedStore(
  connection: DatabaseConnection,
  referenceHours: number = GAME_CONFIG.extendedPrices.referenceHours,
) {
  return async (observations: readonly ExtendedObservation[]) =>
    connection.db.transaction(async (tx) => {
      if (!observations.length) return;
      const now = new Date(Math.max(...observations.map((o) => o.takenAt.getTime()))),
        cutoff = new Date(now.getTime() - 86400000),
        tickers = observations.map((o) => o.ticker);
      const previous = await tx
        .select()
        .from(extendedQuotes)
        .where(inArray(extendedQuotes.ticker, tickers));
      const references = await tx
        .selectDistinctOn([extendedPriceReferences.ticker])
        .from(extendedPriceReferences)
        .where(
          and(
            inArray(extendedPriceReferences.ticker, tickers),
            lte(extendedPriceReferences.takenAt, cutoff),
          ),
        )
        .orderBy(extendedPriceReferences.ticker, sql`${extendedPriceReferences.takenAt} DESC`);
      const core = await tx
        .selectDistinctOn([priceSnapshots.ticker])
        .from(priceSnapshots)
        .where(
          and(
            inArray(priceSnapshots.ticker, tickers),
            eq(priceSnapshots.source, "xstocks"),
            lte(priceSnapshots.takenAt, cutoff),
            sql`${priceSnapshots.priceUsd}>0`,
          ),
        )
        .orderBy(priceSnapshots.ticker, sql`${priceSnapshots.takenAt} DESC`);
      const prior = new Map(previous.map((q) => [q.ticker, q])),
        refs = new Map<string, { priceUsd: string; takenAt: Date }>(core.map((q) => [q.ticker, q]));
      for (const row of references)
        if (!refs.has(row.ticker) || refs.get(row.ticker)!.takenAt < row.takenAt)
          refs.set(row.ticker, row);
      const latest: (typeof extendedQuotes.$inferInsert)[] = [],
        fresh: (typeof extendedPriceReferences.$inferInsert)[] = [];
      for (const o of observations) {
        const old = prior.get(o.ticker);
        if (o.priceUsd === null) {
          if (old)
            latest.push({
              ...old,
              lastSession: o.closed || old.lastSession,
              halted: o.halted,
              updatedAt: o.takenAt,
            });
          continue;
        }
        // Carry the last known pre-boundary quote across closed periods, even after retention.
        const reference =
          refs.get(o.ticker) ??
          (old && old.takenAt <= cutoff
            ? { priceUsd: old.priceUsd, takenAt: old.takenAt }
            : old?.referencePrice && old.referenceAt && old.referenceAt <= cutoff
              ? { priceUsd: old.referencePrice, takenAt: old.referenceAt }
              : null);
        latest.push({
          ticker: o.ticker,
          symbol: o.symbol,
          priceUsd: o.priceUsd,
          referencePrice: reference?.priceUsd ?? null,
          referenceAt: reference?.takenAt ?? null,
          change24hPct: reference ? predictionChange(reference.priceUsd, o.priceUsd) : null,
          takenAt: o.takenAt,
          lastSession: o.closed,
          halted: o.halted,
          updatedAt: o.takenAt,
        });
        fresh.push({ ticker: o.ticker, priceUsd: o.priceUsd, takenAt: o.takenAt });
      }
      if (latest.length)
        await tx
          .insert(extendedQuotes)
          .values(latest)
          .onConflictDoUpdate({
            target: extendedQuotes.ticker,
            set: {
              symbol: sql`excluded.symbol`,
              priceUsd: sql`excluded.price_usd`,
              referencePrice: sql`excluded.reference_price`,
              referenceAt: sql`excluded.reference_at`,
              change24hPct: sql`excluded.change_24h_pct`,
              takenAt: sql`excluded.taken_at`,
              lastSession: sql`excluded.last_session`,
              halted: sql`excluded.halted`,
              updatedAt: sql`excluded.updated_at`,
            },
            setWhere: sql`${extendedQuotes.updatedAt}<=excluded.updated_at`,
          });
      if (fresh.length)
        await tx.insert(extendedPriceReferences).values(fresh).onConflictDoNothing();
      await tx
        .delete(extendedPriceReferences)
        .where(
          lt(extendedPriceReferences.takenAt, new Date(now.getTime() - referenceHours * 3600000)),
        );
    });
}
