import { createLocalDatabase, priceSnapshots } from "@stock-arena/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDailyRetention, retainPriceSnapshots } from "./retention.js";

const connection = createLocalDatabase();
const now = new Date("2026-10-15T12:30:00Z");
const sources = ["xstocks", "fluxion_pool"] as const;
beforeAll(async () => {
  await connection.migrate();
}, 30_000);
beforeEach(async () => {
  await connection.db.execute(sql`DELETE FROM price_snapshots`);
});
afterAll(async () => {
  await connection.close();
});

describe("price retention on PGlite", () => {
  it.each([3, 30])(
    "keeps recent samples and hourly history independently for %s tickers and both sources",
    async (count) => {
      const times = [
        "2026-10-12T23:01:00Z",
        "2026-10-12T23:59:59Z",
        "2026-10-13T00:01:00Z",
        "2026-10-13T00:59:59Z",
        "2026-10-13T12:01:00Z",
        "2026-10-13T12:29:59Z",
        "2026-10-13T12:30:00Z",
        "2026-10-13T12:45:00Z",
        "2026-10-15T12:29:59Z",
        "2026-10-15T12:30:00Z",
      ];
      const expected = [times[1], times[3], ...times.slice(6)].map((value) =>
        new Date(value!).toISOString(),
      );
      const tickers = Array.from({ length: count }, (_, index) => `ASSET_${index}`);
      const rows = tickers.flatMap((ticker) =>
        sources.flatMap((source) =>
          times.map((time, index) => ({
            ticker,
            source,
            priceUsd: String(index + 1),
            blockNumber: source === "fluxion_pool" ? BigInt(index) : null,
            takenAt: new Date(time),
          })),
        ),
      );
      await connection.db.insert(priceSnapshots).values(rows);
      expect(await retainPriceSnapshots(connection, now)).toBe(count * 2 * 4);
      const kept = await connection.db.select().from(priceSnapshots);
      for (const ticker of tickers)
        for (const source of sources) {
          expect(
            kept
              .filter((row) => row.ticker === ticker && row.source === source)
              .map((row) => row.takenAt.toISOString())
              .sort(),
          ).toEqual(expected);
        }
      expect(await retainPriceSnapshots(connection, now)).toBe(0);
    },
  );
  it("uses UTC hours regardless of session timezone and keeps one row on timestamp ties", async () => {
    await connection.db.execute(sql`SET TIME ZONE 'Asia/Kolkata'`);
    try {
      const times = ["2026-10-12T10:45:00Z", "2026-10-12T11:01:00Z", "2026-10-12T11:01:00Z"];
      await connection.db.insert(priceSnapshots).values(
        times.map((time) => ({
          ticker: "TEST",
          source: "xstocks" as const,
          priceUsd: "10",
          takenAt: new Date(time),
        })),
      );
      expect(await retainPriceSnapshots(connection, now)).toBe(1);
      const kept = await connection.db.select().from(priceSnapshots);
      expect(kept.map((row) => row.takenAt.toISOString()).sort()).toEqual([
        "2026-10-12T10:45:00.000Z",
        "2026-10-12T11:01:00.000Z",
      ]);
    } finally {
      await connection.db.execute(sql`SET TIME ZONE 'UTC'`);
    }
  });
  it("preserves all equal-timestamp recent rows and future rows", async () => {
    const takenAt = new Date("2026-10-15T12:45:00Z");
    const rows = [1, 2].map((value) => ({
      ticker: "TEST",
      source: "xstocks" as const,
      priceUsd: String(value),
      takenAt,
    }));
    await connection.db.insert(priceSnapshots).values(rows);
    expect(await retainPriceSnapshots(connection, now)).toBe(0);
    expect(await connection.db.select().from(priceSnapshots)).toHaveLength(2);
  });
});

describe("daily retention scheduling", () => {
  it("runs at startup, deduplicates simultaneous requests, then waits for the next UTC day", async () => {
    let time = new Date("2026-10-15T23:59:59Z");
    let finish: (deleted: number) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const success = vi.fn();
    const error = vi.fn();
    const run = createDailyRetention(action, success, error, () => time);
    const first = run();
    const duplicate = run();
    expect(action).toHaveBeenCalledTimes(1);
    finish(5);
    await Promise.all([first, duplicate]);
    await run();
    expect(action).toHaveBeenCalledTimes(1);
    time = new Date("2026-10-16T00:00:00Z");
    const next = run();
    expect(action).toHaveBeenCalledTimes(2);
    finish(2);
    await next;
    expect(success.mock.calls).toEqual([[5], [2]]);
    expect(error).not.toHaveBeenCalled();
  });
  it("retries after failure without rejecting the price worker cycle", async () => {
    const action = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("private DB error"))
      .mockResolvedValue(1);
    const error = vi.fn();
    const success = vi.fn();
    const run = createDailyRetention(action, success, error, () => now);
    await run();
    expect(error).toHaveBeenCalledTimes(1);
    await run();
    await run();
    expect(action).toHaveBeenCalledTimes(2);
    expect(success).toHaveBeenCalledWith(1);
  });
});
