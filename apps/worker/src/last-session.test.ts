import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  createLocalDatabase,
  hlRounds,
  priceSnapshots,
  tickerStatus,
  users,
} from "@stock-arena/db";
import { ASSETS } from "@stock-arena/game-core";
import type { AssetCatalog } from "@stock-arena/game-core";
import type { OraclePoll, TradingStatus } from "@stock-arena/fluxion-oracle";
import { createHlStore } from "../../api/src/higher-lower.js";
import { createPriceStore } from "./prices.js";
import { retainPriceSnapshots } from "./retention.js";

const connection = createLocalDatabase();
const catalog: AssetCatalog = Object.fromEntries(Object.entries(ASSETS).slice(0, 3));
const tickers = Object.keys(catalog);
// Synthetic source schedule, independent of any exchange calendar.
const close = new Date("2026-10-16T10:30:00Z");
const before = new Date(close.getTime() - 15_000);
const target = new Date(close.getTime() - 86_400_000);
const baseline = new Date(target.getTime() - 15_000);
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
function poll(at: Date, status: TradingStatus, prices = false): OraclePoll {
  return {
    takenAt: at,
    trading: Object.fromEntries(tickers.map((ticker) => [ticker, status])),
    snapshots: prices
      ? tickers.map((ticker) => ({
          ticker: ticker as keyof typeof ASSETS,
          source: "xstocks",
          priceUsd: "900",
          takenAt: at,
          blockNumber: null,
        }))
      : [],
  };
}
async function seed() {
  await connection.db.insert(priceSnapshots).values(
    tickers.flatMap((ticker, i) => [
      { ticker, priceUsd: "100", source: "xstocks" as const, takenAt: baseline },
      // Retention will keep this later, out-of-window sample instead of the baseline.
      {
        ticker,
        priceUsd: "800",
        source: "xstocks" as const,
        takenAt: new Date("2026-10-15T10:59:00Z"),
      },
      { ticker, priceUsd: String(101 + i), source: "xstocks" as const, takenAt: before },
      { ticker, priceUsd: "99999", source: "fluxion_pool" as const, takenAt: before },
      { ticker, priceUsd: "99999", source: "fluxion_pool" as const, takenAt: baseline },
    ]),
  );
  await store()(poll(before, trading));
}
async function game(now: Date) {
  const [user] = await connection.db
    .insert(users)
    .values({ displayName: "Synthetic session player" })
    .returning();
  return {
    user: user!,
    play: createHlStore(connection, { catalog, now: () => now, choose: () => 0 }),
  };
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

describe("durable last session through worker, retention and HL", () => {
  it("keeps HL available on Sunday night after 60 hours and deletion of both original samples", async () => {
    await seed();
    const save = store();
    await save(poll(new Date(close.getTime() + 15_000), closed, true));
    const read = async () =>
      (
        await connection.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, tickers[0]!))
      )[0]!;
    const frozen = (await read()).lastSession;
    expect(frozen).toMatchObject({
      closedAt: close.toISOString(),
      priceUsd: "101",
      change24hPct: expect.closeTo(1),
      closeTakenAt: before.toISOString(),
      baselinePriceUsd: "100",
      baselineTakenAt: baseline.toISOString(),
    });
    let removed = 0;
    for (let hour = 1; hour <= 60; hour++) {
      const at = new Date(close.getTime() + hour * 3_600_000);
      removed += await retainPriceSnapshots(connection, at);
      await save(poll(at, closed, true));
    }
    expect(removed).toBeGreaterThan(0);
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
    const now = new Date("2026-10-18T22:30:00Z");
    const { user, play } = await game(now);
    expect((await play(user.id, { type: "read" })).status).toBe("ready");
    const view = await play(user.id, { type: "start" });
    expect(view.mode).toBe("last_session");
    expect(view.status).toBe("round");
    expect(view.round!.stocks.map((stock) => stock.priceUsd)).toEqual(["101", "102"]);
    const result = await play(user.id, {
      type: "pick",
      pick: { runId: view.run!.id, roundId: view.round!.id, ticker: tickers[1]! },
    });
    expect(result.run!.score).toBe(5);
    expect(result.feedback!.stocks[1].change24hPct).toBeCloseTo(2);
  }, 30_000);

  it.each(["restart", "metadata failure"])(
    "recovers a close ten minutes late after %s",
    async (failure) => {
      await seed();
      if (failure === "metadata failure") {
        await store()({ ...poll(new Date(close.getTime() + 180_000), closed), trading: {} });
        const [status] = await connection.db
          .select()
          .from(tickerStatus)
          .where(eq(tickerStatus.ticker, tickers[0]!));
        expect(status).toMatchObject({
          tradingPeriod: "overnight",
          periodChangeAt: close,
          state: "paused",
          reason: "stale",
        });
      }
      const now = new Date(close.getTime() + 600_000);
      // A fresh store simulates a worker restart; the boundary lives in the database.
      await store()(poll(now, closed, true));
      const [status] = await connection.db
        .select()
        .from(tickerStatus)
        .where(eq(tickerStatus.ticker, tickers[0]!));
      expect(status!.lastClosedAt).toEqual(close);
      expect(status!.lastSession?.priceUsd).toBe("101");
      const { user, play } = await game(now);
      const view = await play(user.id, { type: "start" });
      expect(view.status).toBe("round");
      expect(view.mode).toBe("last_session");
    },
  );

  it.each([
    "missing close",
    "old close",
    "missing baseline",
    "old baseline",
    "future baseline",
    "halt",
  ])("remains ineligible after delayed detection with %s", async (failure) => {
    await seed();
    if (failure === "missing close")
      await connection.db
        .delete(priceSnapshots)
        .where(and(eq(priceSnapshots.source, "xstocks"), eq(priceSnapshots.takenAt, before)));
    if (failure === "old close")
      await connection.db
        .update(priceSnapshots)
        .set({ takenAt: new Date(close.getTime() - 121_000) })
        .where(and(eq(priceSnapshots.source, "xstocks"), eq(priceSnapshots.takenAt, before)));
    if (failure === "missing baseline")
      await connection.db
        .delete(priceSnapshots)
        .where(and(eq(priceSnapshots.source, "xstocks"), eq(priceSnapshots.takenAt, baseline)));
    if (failure === "old baseline" || failure === "future baseline")
      await connection.db
        .update(priceSnapshots)
        .set({
          takenAt: new Date(target.getTime() + (failure === "old baseline" ? -121_000 : 1_000)),
        })
        .where(and(eq(priceSnapshots.source, "xstocks"), eq(priceSnapshots.takenAt, baseline)));
    const now = new Date(close.getTime() + 600_000);
    await store()(poll(now, { ...closed, isTradingHalted: failure === "halt" }, true));
    const { user, play } = await game(now);
    const result = await play(user.id, { type: "start" });
    expect(result.status).toBe("paused");
    expect(result.runsUsed).toBe(0);
    expect(
      (
        await connection.db.select().from(tickerStatus).where(inArray(tickerStatus.ticker, tickers))
      ).every((status) => status.lastSession === null),
    ).toBe(true);
  });

  it("keeps the frozen result through a halt, then clears the session on reopening", async () => {
    await seed();
    const now = new Date(close.getTime() + 15_000),
      save = store();
    await save(poll(now, closed));
    const { user, play } = await game(now);
    const view = await play(user.id, { type: "start" });
    const frozen = await connection.db
      .select()
      .from(hlRounds)
      .where(eq(hlRounds.id, view.round!.id));
    await save(poll(now, { ...closed, isTradingHalted: true }));
    expect((await play(user.id, { type: "read" })).status).toBe("paused");
    await save(poll(now, closed));
    expect((await play(user.id, { type: "read" })).status).toBe("round");
    await save(
      poll(new Date(opening), { ...trading, currentPeriod: "market", nextChangeAt: null }),
    );
    expect(
      (
        await connection.db.select().from(tickerStatus).where(inArray(tickerStatus.ticker, tickers))
      ).every((status) => status.lastClosedAt === null && status.lastSession === null),
    ).toBe(true);
    expect(
      await connection.db.select().from(hlRounds).where(eq(hlRounds.id, view.round!.id)),
    ).toEqual(frozen);
  });
});
