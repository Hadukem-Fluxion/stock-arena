import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { createLocalDatabase, priceSnapshots, tickerStatus } from "@stock-arena/db";
import type { OraclePoll, TradingStatus } from "@stock-arena/fluxion-oracle";
import { createPriceStore } from "./prices.js";
import { retainPriceSnapshots } from "./retention.js";
const connection = createLocalDatabase();
const close = new Date("2026-10-16T10:30:00Z"),
  before = new Date(close.getTime() - 15_000),
  baseline = new Date(close.getTime() - 86_415_000);
const opening = "2026-10-19T00:00:00Z";
const trading: TradingStatus = {
  tradingHoursMode: "TwentyFourFive",
  currentPeriod: "overnight",
  isTradingHalted: false,
  openNow: true,
  nextChangeAt: close.toISOString(),
};
const closed: TradingStatus = {
  ...trading,
  currentPeriod: "closed",
  openNow: false,
  nextChangeAt: opening,
};
const store = () => createPriceStore(connection, { divergencePct: 3, jumpLimitPct: 5 }, vi.fn());
const poll = (at: Date, status = closed): OraclePoll => ({
  takenAt: at,
  trading: { AAPL: status },
  snapshots: [
    { ticker: "AAPL", priceUsd: "900", source: "xstocks", blockNumber: null, takenAt: at },
  ],
});
const read = async () =>
  (await connection.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "AAPL")))[0]!;
async function seed() {
  await connection.db.insert(priceSnapshots).values([
    { ticker: "AAPL", priceUsd: "100", source: "xstocks", takenAt: baseline },
    {
      ticker: "AAPL",
      priceUsd: "800",
      source: "xstocks",
      takenAt: new Date("2026-10-15T10:59:00Z"),
    },
    { ticker: "AAPL", priceUsd: "101", source: "xstocks", takenAt: before },
    { ticker: "AAPL", priceUsd: "99999", source: "fluxion_pool", takenAt: before },
  ]);
  await store()({ ...poll(before, trading), snapshots: [] });
}
beforeAll(async () => {
  await connection.migrate();
}, 30_000);
beforeEach(async () => {
  await connection.db.delete(priceSnapshots);
  await connection.db.delete(tickerStatus);
});
afterAll(async () => {
  await connection.close();
});
describe("T25 frozen session remains available for display only", () => {
  it("preserves the frozen data through 60h of actual retention without retaining either original sample", async () => {
    await seed();
    const save = store();
    await save(poll(new Date(close.getTime() + 15_000)));
    const frozen = (await read()).lastSession;
    expect(frozen).toMatchObject({
      priceUsd: "101",
      change24hPct: expect.closeTo(1),
      closeTakenAt: before.toISOString(),
      baselineTakenAt: baseline.toISOString(),
    });
    let deleted = 0;
    for (let hour = 1; hour <= 60; hour++) {
      const at = new Date(close.getTime() + hour * 3_600_000);
      deleted += await retainPriceSnapshots(connection, at);
      await save(poll(at));
    }
    expect(deleted).toBeGreaterThan(0);
    expect(
      await connection.db
        .select()
        .from(priceSnapshots)
        .where(
          and(
            eq(priceSnapshots.source, "xstocks"),
            inArray(priceSnapshots.takenAt, [before, baseline]),
          ),
        ),
    ).toHaveLength(0);
    expect((await read()).lastSession).toEqual(frozen);
  }, 30_000);
  it.each(["restart", "metadata failure"])(
    "recovers the frozen display data ten minutes after %s",
    async (failure) => {
      await seed();
      if (failure === "metadata failure")
        await store()({ ...poll(new Date(close.getTime() + 180_000)), trading: {} });
      await store()(poll(new Date(close.getTime() + 600_000)));
      expect((await read()).lastSession?.priceUsd).toBe("101");
    },
  );
  it.each(["close", "baseline", "halt"])(
    "does not create a frozen session without valid %s",
    async (failure) => {
      await seed();
      if (failure !== "halt")
        await connection.db
          .delete(priceSnapshots)
          .where(
            and(
              eq(priceSnapshots.source, "xstocks"),
              eq(priceSnapshots.takenAt, failure === "close" ? before : baseline),
            ),
          );
      await store()(
        poll(new Date(close.getTime() + 600_000), {
          ...closed,
          isTradingHalted: failure === "halt",
        }),
      );
      expect((await read()).lastSession).toBeNull();
    },
  );
});
