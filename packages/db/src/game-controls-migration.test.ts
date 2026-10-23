import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createLocalDatabase } from "./client.js";
import { gameControls, pointsLedger, seasons, tickerControls, tickerStatus } from "./schema.js";

it("T30 upgrade preserves ledger and legacy manual pauses and seeds the former season unchanged", async () => {
  const connection = createLocalDatabase();
  try {
    const client = connection.db.$client;
    const journal = JSON.parse(
      await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter((r) => r.idx < 11))
      await client.exec(
        await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"),
      );
    await client.exec(`INSERT INTO users (id, display_name) VALUES ('00000000-0000-4000-8000-000000000001', 'Synthetic upgrade player');
      INSERT INTO points_ledger (user_id, amount, reason, ref_id) VALUES ('00000000-0000-4000-8000-000000000001', 17, 'synthetic', 'synthetic:upgrade');
      INSERT INTO ticker_status (ticker, state, reason) VALUES ('TEST_A', 'paused', 'manual'), ('TEST_B', 'paused', 'divergence');`);
    await client.exec(
      await readFile(new URL("../drizzle/0011_admin-game-controls.sql", import.meta.url), "utf8"),
    );
    expect(await connection.db.select().from(pointsLedger)).toMatchObject([
      { amount: 17, refId: "synthetic:upgrade" },
    ]);
    expect(await connection.db.select().from(seasons)).toEqual([
      {
        id: "season-1",
        name: "Season 1",
        startsAt: new Date("2026-10-16T00:00:00Z"),
        endsAt: null,
      },
    ]);
    expect((await connection.db.select().from(gameControls)).map((r) => r.paused)).toEqual([
      false,
      false,
      false,
    ]);
    expect(await connection.db.select().from(tickerControls)).toMatchObject([
      { ticker: "TEST_A", paused: true },
    ]);
    const status = await connection.db.select().from(tickerStatus);
    expect(status.find((r) => r.ticker === "TEST_A")).toMatchObject({
      state: "paused",
      reason: "manual",
      oracleState: "paused",
      oracleReason: "stale",
    });
    expect(status.find((r) => r.ticker === "TEST_B")).toMatchObject({
      state: "paused",
      reason: "divergence",
      oracleReason: "divergence",
    });
    await expect(client.query("UPDATE points_ledger SET amount = 0")).rejects.toMatchObject({
      code: "55000",
    });
  } finally {
    await connection.close();
  }
}, 30000);
