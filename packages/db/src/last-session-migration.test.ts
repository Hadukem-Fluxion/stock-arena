import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createLocalDatabase } from "./client.js";
import { hlRounds, tickerStatus, hlRuns, pointsLedger } from "./schema.js";

describe("T25 last-session migration", () => {
  it("preserves existing rounds as live and leaves legacy closed metadata unknown", async () => {
    const connection = createLocalDatabase();
    try {
      const client = connection.db.$client;
      for (const file of [
        "0000_season-one.sql",
        "0001_immutable-ledger.sql",
        "0002_price-source.sql",
        "0003_quiz-storage.sql",
        "0004_hl-rounds.sql",
        "0005_market-reopening.sql",
      ])
        await client.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
      await client.exec(`
        INSERT INTO users (id, display_name) VALUES ('00000000-0000-4000-8000-000000000001', 'Synthetic migration player');
        INSERT INTO hl_runs (id, user_id, day, run_number) VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '2026-10-16', 1);
        INSERT INTO hl_rounds (run_id, position, stocks, winner, served_at) VALUES (
          '00000000-0000-4000-8000-000000000002', 0,
          '[{"ticker":"TEST_A","priceUsd":"100","change24hPct":1},{"ticker":"TEST_B","priceUsd":"102","change24hPct":2}]',
          'TEST_B', '2026-10-16T20:00:00Z');
        INSERT INTO ticker_status (ticker, state, reason) VALUES ('TEST_A', 'paused', 'closed');
      `);
      await client.exec(
        await readFile(new URL("../drizzle/0006_last-session.sql", import.meta.url), "utf8"),
      );
      await client.exec(
        await readFile(new URL("../drizzle/0007_frozen-last-session.sql", import.meta.url), "utf8"),
      );
      await client.query(
        "INSERT INTO points_ledger(user_id,amount,reason,ref_id) VALUES ('00000000-0000-4000-8000-000000000001',5,'higher_lower','hl:synthetic-classic')",
      );
      await client.exec(
        await readFile(new URL("../drizzle/0008_hl-predictions.sql", import.meta.url), "utf8"),
      );
      expect((await connection.db.select().from(hlRuns))[0]!.endedAt).not.toBeNull();
      expect((await connection.db.select().from(pointsLedger))[0]).toMatchObject({
        amount: 5,
        refId: "hl:synthetic-classic",
      });
      expect((await connection.db.select().from(hlRounds))[0]).toMatchObject({
        mode: "live",
        winner: "TEST_B",
        choice: null,
      });
      // This upgrade stops at 0008; select only columns that existed then.
      expect(
        (
          await connection.db
            .select({
              reason: tickerStatus.reason,
              tradingPeriod: tickerStatus.tradingPeriod,
              tradingHalted: tickerStatus.tradingHalted,
              lastClosedAt: tickerStatus.lastClosedAt,
              lastSession: tickerStatus.lastSession,
            })
            .from(tickerStatus)
        )[0],
      ).toMatchObject({
        reason: "closed",
        tradingPeriod: null,
        tradingHalted: null,
        lastClosedAt: null,
        lastSession: null,
      });
      await expect(client.query("UPDATE hl_rounds SET mode='pool'")).rejects.toMatchObject({
        code: "23514",
      });
      await expect(client.query("DELETE FROM points_ledger")).rejects.toMatchObject({
        code: "55000",
      });
    } finally {
      await connection.close();
    }
  }, 30_000);
});
