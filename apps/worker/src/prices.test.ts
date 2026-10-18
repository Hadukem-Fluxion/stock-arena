import { createLocalDatabase, priceSnapshots, tickerStatus } from "@stock-arena/db";
import { TICKERS } from "@stock-arena/game-core";
import type { OraclePoll, SpotPrice, TradingStatus } from "@stock-arena/fluxion-oracle";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPriceStore, startPricePolling } from "./prices.js";

const connection = createLocalDatabase();
const trading: TradingStatus = {
  tradingHoursMode: "TwentyFourFive",
  isTradingHalted: false,
  currentPeriod: "market",
  openNow: true,
  nextChangeAt: null,
};
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 15, 12, 0, seconds));
const quote = (seconds: number, priceUsd = "100"): SpotPrice => ({
  ticker: "AAPL",
  priceUsd,
  blockNumber: null,
  source: "xstocks",
  takenAt: at(seconds),
});
const poll = (seconds: number, snapshots: SpotPrice[], status = trading): OraclePoll => ({
  snapshots,
  takenAt: at(seconds),
  trading: Object.fromEntries(TICKERS.map((ticker) => [ticker, status])),
});
const store = createPriceStore(connection, { divergencePct: 3, jumpLimitPct: 5 }, vi.fn());

beforeAll(async () => {
  await connection.migrate();
}, 30_000);
afterAll(async () => {
  await connection.close();
});

describe("price worker storage", () => {
  it("records a confirmed closing boundary, retains it through the weekend and clears it on reopening", async () => {
    await connection.db.delete(tickerStatus).where(eq(tickerStatus.ticker, "MSFT"));
    const read = async () =>
      (await connection.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "MSFT")))[0]!;
    await store(
      poll(400, [], {
        ...trading,
        currentPeriod: "overnight",
        nextChangeAt: at(420).toISOString(),
      }),
    );
    const closed = {
      ...trading,
      currentPeriod: "closed" as const,
      openNow: false,
      nextChangeAt: at(900).toISOString(),
    };
    await store(poll(425, [], closed));
    expect((await read()).lastClosedAt).toEqual(at(420));
    expect((await read()).tradingHalted).toBe(false);
    await store(poll(450, [], closed));
    expect((await read()).lastClosedAt).toEqual(at(420));
    await store({ ...poll(460, []), trading: {} });
    expect((await read()).tradingPeriod).toBeNull();
    await store(poll(470, [], closed));
    expect((await read()).lastClosedAt).toEqual(at(420));
    await store(poll(480, [], { ...closed, isTradingHalted: true }));
    expect((await read()).tradingHalted).toBe(true);
    await store(poll(900, [], trading));
    expect((await read()).lastClosedAt).toBeNull();
  });

  it("does not invent a close at cold startup, after a missed transition or from a halt", async () => {
    const read = async () =>
      (await connection.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "MSFT")))[0]!;
    const closed = {
      ...trading,
      currentPeriod: "closed" as const,
      openNow: false,
      nextChangeAt: at(1500).toISOString(),
    };
    await connection.db.delete(tickerStatus).where(eq(tickerStatus.ticker, "MSFT"));
    await store(poll(1000, [], closed));
    expect((await read()).lastClosedAt).toBeNull();
    await store(poll(1100, [], { ...trading, nextChangeAt: at(1120).toISOString() }));
    await store(poll(1250, [], closed));
    expect((await read()).lastClosedAt).toBeNull();
    await store(poll(1300, [], { ...trading, nextChangeAt: at(1320).toISOString() }));
    await store(poll(1325, [], { ...closed, isTradingHalted: true }));
    expect((await read()).lastClosedAt).toBeNull();
    await store(poll(1340, [], closed));
    expect((await read()).lastClosedAt).toBeNull();
  });

  it("cannot reuse the prior session when the worker misses an entire reopen/close cycle", async () => {
    const read = async () =>
      (await connection.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "MSFT")))[0]!;
    await store(poll(1600, [], { ...trading, nextChangeAt: at(1620).toISOString() }));
    await store(
      poll(1625, [], { ...trading, currentPeriod: "closed", nextChangeAt: at(2000).toISOString() }),
    );
    expect((await read()).lastClosedAt).toEqual(at(1620));
    await store(
      poll(2500, [], { ...trading, currentPeriod: "closed", nextChangeAt: at(3000).toISOString() }),
    );
    expect((await read()).lastClosedAt).toBeNull();
  });
  it("stores both sources but checks jumps only against primary history", async () => {
    const warning = vi.fn();
    const relaxedStore = createPriceStore(
      connection,
      { divergencePct: 1000, jumpLimitPct: 5 },
      warning,
    );
    await relaxedStore(
      poll(0, [quote(0), { ...quote(0, "200"), source: "fluxion_pool", blockNumber: 123n }]),
    );
    const statuses = await relaxedStore(
      poll(15, [
        quote(15, "101"),
        { ...quote(15, "200"), source: "fluxion_pool", blockNumber: 124n },
      ]),
    );
    expect(statuses.find((status) => status.ticker === "AAPL")?.status).toEqual({ state: "live" });
    const rows = await connection.db.select().from(priceSnapshots);
    expect(
      rows.filter((row) => row.source === "xstocks").every((row) => row.blockNumber === null),
    ).toBe(true);
    expect(
      rows.filter((row) => row.source === "fluxion_pool").map((row) => row.blockNumber),
    ).toEqual([123n, 124n]);
  });
  it("logs divergence and persists the pause; a missing cross-check cannot clear it", async () => {
    const warning = vi.fn();
    const checkedStore = createPriceStore(
      connection,
      { divergencePct: 3, jumpLimitPct: 5 },
      warning,
    );
    await checkedStore(
      poll(30, [quote(30), { ...quote(30, "110"), source: "fluxion_pool", blockNumber: 125n }]),
    );
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("AAPL divergence"));
    const unresolved = await checkedStore(poll(45, [quote(45)]));
    expect(unresolved.find((status) => status.ticker === "AAPL")?.status).toEqual({
      state: "paused",
      reason: "divergence",
    });
  });
  it("resumes after a matching cross-check, then pauses on closed markets", async () => {
    const recovered = await store(
      poll(60, [quote(60), { ...quote(60), source: "fluxion_pool", blockNumber: 126n }]),
    );
    expect(recovered.find((status) => status.ticker === "AAPL")?.status).toEqual({ state: "live" });
    await store(poll(75, [], { ...trading, currentPeriod: "closed", openNow: false }));
    const [state] = await connection.db
      .select()
      .from(tickerStatus)
      .where(eq(tickerStatus.ticker, "AAPL"));
    expect(state).toMatchObject({ state: "paused", reason: "closed" });
    const rows = await connection.db
      .select()
      .from(priceSnapshots)
      .where(eq(priceSnapshots.source, "xstocks"));
    expect(rows.at(-1)?.priceUsd).toBe("100");
  });
  it("pauses stale primary data when refreshes fail and preserves manual pauses", async () => {
    const stale = await store(poll(200, []));
    expect(stale.find((status) => status.ticker === "AAPL")?.status).toEqual({
      state: "paused",
      reason: "stale",
    });
    await connection.db
      .update(tickerStatus)
      .set({ reason: "manual" })
      .where(eq(tickerStatus.ticker, "AAPL"));
    const manual = await store(poll(215, [quote(215)]));
    expect(manual.find((status) => status.ticker === "AAPL")?.status).toEqual({
      state: "paused",
      reason: "manual",
    });
  });
  it("rolls back all snapshots and statuses on a failed write", async () => {
    const before = await connection.db.select().from(priceSnapshots);
    await expect(
      store(poll(230, [quote(230), { ...quote(230), priceUsd: "invalid numeric" }])),
    ).rejects.toThrow();
    expect(await connection.db.select().from(priceSnapshots)).toEqual(before);
  });
  it("persists only a future scheduled reopening and clears it on refresh, halt or expiry", async () => {
    const opening = at(300).toISOString();
    const closed = {
      ...trading,
      currentPeriod: "closed" as const,
      openNow: false,
      nextChangeAt: opening,
    };
    const readStatus = async () =>
      (await connection.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "MSFT")))[0]!;
    await store(poll(240, [], closed));
    expect((await readStatus()).nextChangeAt?.toISOString()).toBe(opening);
    await store({ ...poll(245, []), trading: {} });
    expect((await readStatus()).nextChangeAt).toBeNull();
    await store(poll(250, [], { ...closed, isTradingHalted: true }));
    expect((await readStatus()).nextChangeAt).toBeNull();
    await store(poll(305, [], closed));
    expect((await readStatus()).nextChangeAt).toBeNull();
  });
});

describe("poll scheduler", () => {
  it("continues on the next 15-second tick after an action fails", async () => {
    vi.useFakeTimers();
    const action = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("database offline"))
      .mockResolvedValue(undefined);
    const errors = vi.fn();
    const stop = startPricePolling(action, 15_000, errors);
    try {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(action).toHaveBeenCalledTimes(2);
    } finally {
      await stop();
      vi.useRealTimers();
    }
  });
  it("never overlaps a slow price cycle", async () => {
    vi.useFakeTimers();
    let concurrent = 0;
    let peak = 0;
    const action = vi.fn(async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      concurrent--;
    });
    const stop = startPricePolling(action, 15_000, vi.fn());
    try {
      await vi.advanceTimersByTimeAsync(45_000);
      expect(peak).toBe(1);
      expect(action).toHaveBeenCalledTimes(3);
    } finally {
      const stopping = stop();
      await vi.advanceTimersByTimeAsync(20_000);
      await stopping;
      vi.useRealTimers();
    }
  });
});
