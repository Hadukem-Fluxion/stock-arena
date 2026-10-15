import { sql } from "drizzle-orm";
import type { DatabaseConnection } from "@stock-arena/db";

/** Keep all recent samples and the last sample per older UTC hour/ticker/source. */
export async function retainPriceSnapshots(connection: DatabaseConnection, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid retention timestamp.");
  const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  // The table has no primary key. ctid identifies rows within this single atomic
  // statement, including duplicate timestamps; it is never persisted or reused.
  const result = await connection.db.execute<{ deleted: number }>(sql`
    WITH ranked AS (
      SELECT ctid, taken_at, row_number() OVER (
        PARTITION BY ticker, source, date_trunc('hour', taken_at AT TIME ZONE 'UTC')
        ORDER BY taken_at DESC, ctid DESC
      ) AS position
      FROM price_snapshots
    ), deleted AS (
      DELETE FROM price_snapshots AS snapshots USING ranked
      WHERE snapshots.ctid = ranked.ctid
        AND ranked.taken_at < ${cutoff}::timestamptz
        AND ranked.position > 1
      RETURNING 1
    )
    SELECT count(*)::int AS deleted FROM deleted
  `);
  return result.rows[0]?.deleted ?? 0;
}

/** Run on startup and once per UTC day; a failed run stays eligible for retry. */
export function createDailyRetention(
  action: () => Promise<number>,
  onSuccess: (deleted: number) => void,
  onError: () => void,
  now: () => Date = () => new Date(),
) {
  let completedDay: string | undefined;
  let active: Promise<void> | undefined;
  return function run(): Promise<void> {
    if (active) return active;
    const day = now().toISOString().slice(0, 10);
    if (day === completedDay) return Promise.resolve();
    active = (async () => {
      try {
        const deleted = await action();
        completedDay = day;
        onSuccess(deleted);
      } catch {
        onError();
      }
    })().finally(() => {
      active = undefined;
    });
    return active;
  };
}
