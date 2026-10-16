import {
  createLocalDatabase,
  checkins,
  identities,
  pointsLedger,
  priceSnapshots,
  tickerStatus,
  users,
} from "@stock-arena/db";
import { ASSETS, assetTickers, stockOfTheDay } from "@stock-arena/game-core";
import type { AssetCatalog, CheckinView } from "@stock-arena/game-core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createSessions } from "./auth/session.js";

const connection = createLocalDatabase();
const secret = "fake-checkin-session-secret-for-tests-only-48-bytes";
let now = new Date("2026-10-15T12:00:00Z");
beforeAll(async () => {
  await connection.migrate();
}, 30_000);
beforeEach(async () => {
  now = new Date("2026-10-15T12:00:00Z");
  await connection.db.execute(sql`DELETE FROM price_snapshots`);
  await connection.db.execute(sql`DELETE FROM ticker_status`);
});
afterAll(async () => {
  await connection.close();
});
async function setup(catalog?: AssetCatalog) {
  const [user] = await connection.db
    .insert(users)
    .values({ displayName: "Checkin test player" })
    .returning();
  if (!user) throw new Error("Missing player");
  const identity = { platform: "discord" as const, platformUserId: user.id };
  await connection.db.insert(identities).values({ userId: user.id, ...identity });
  const session = await createSessions(secret, () => now).issue({
    id: user.id,
    displayName: user.displayName,
    avatarUrl: null,
    identity,
  });
  const app = buildServer({
    auth: { database: connection, env: { SESSION_SECRET: secret }, now: () => now },
    logger: false,
    checkin: catalog ? { catalog } : undefined,
  });
  const send = (method: "GET" | "POST" = "POST", payload: Record<string, unknown> = {}) =>
    app.inject({
      method,
      url: "/api/checkin",
      headers: { authorization: `Bearer ${session.token}` },
      ...(method === "POST" ? { payload } : {}),
    });
  return { app, user, send };
}
describe("daily check-in", () => {
  it.each([
    [null, 0, 1, 10],
    ["2026-10-14", 3, 4, 10],
    ["2026-10-13", 6, 1, 10],
    ["2026-10-14", 6, 7, 60],
    ["2026-10-14", 29, 30, 310],
  ])(
    "last day %s / streak %s produces streak %s and %s points",
    async (day, streak, expected, total) => {
      const { app, user, send } = await setup();
      try {
        if (day)
          await connection.db
            .insert(checkins)
            .values({ userId: user.id, day: day as string, streak: streak as number });
        const response = await send();
        expect(response.statusCode).toBe(201);
        const view = response.json<CheckinView>();
        expect(view).toMatchObject({
          day: "2026-10-15",
          checkedIn: true,
          streak: expected,
          balance: total,
        });
        expect(view.awardsToday.reduce((sum, row) => sum + row.amount, 0)).toBe(total);
        const ledger = await connection.db
          .select()
          .from(pointsLedger)
          .where(eq(pointsLedger.userId, user.id));
        expect(
          ledger.every(
            (row) =>
              row.refId === "checkin:2026-10-15" &&
              row.createdAt.toISOString() === now.toISOString(),
          ),
        ).toBe(true);
        expect(response.headers["cache-control"]).toBe("no-store");
      } finally {
        await app.close();
      }
    },
  );
  it("rejects sequential and simultaneous retries without double awards", async () => {
    const { app, user, send } = await setup();
    try {
      const results = await Promise.all([send(), send(), send()]);
      expect(results.map((result) => result.statusCode).sort()).toEqual([201, 409, 409]);
      expect((await send()).json()).toEqual({ error: { code: "ALREADY_CHECKED_IN" } });
      expect(
        await connection.db.select().from(checkins).where(eq(checkins.userId, user.id)),
      ).toHaveLength(1);
      expect(
        await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
      ).toHaveLength(1);
      const get = await send("GET");
      expect(get.json<CheckinView>()).toMatchObject({ checkedIn: true, balance: 10, streak: 1 });
    } finally {
      await app.close();
    }
  });
  it("uses server UTC dates across midnight, independently of submitted input", async () => {
    now = new Date("2026-10-15T23:59:59Z");
    const { app, send } = await setup();
    try {
      expect((await send()).json<CheckinView>().day).toBe("2026-10-15");
      now = new Date("2026-10-15T21:00:00-03:00");
      expect((await send()).json<CheckinView>()).toMatchObject({
        day: "2026-10-16",
        streak: 2,
        balance: 20,
      });
      expect((await send("POST", { day: "2026-10-17", amount: 999 })).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
  it("rolls back the check-in if any ledger insert fails", async () => {
    const { app, user, send } = await setup();
    try {
      await connection.db
        .insert(pointsLedger)
        .values({ userId: user.id, amount: 10, reason: "checkin", refId: "checkin:2026-10-15" });
      const response = await send();
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: { code: "INTERNAL_ERROR" } });
      expect(
        await connection.db.select().from(checkins).where(eq(checkins.userId, user.id)),
      ).toHaveLength(0);
      expect(
        await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
      ).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
  it("requires a valid active account and rejects unexpected inputs", async () => {
    const { app, user, send } = await setup();
    try {
      expect(
        (await app.inject({ method: "POST", url: "/api/checkin", payload: {} })).statusCode,
      ).toBe(401);
      expect((await send("POST", { ticker: "AAPL", streak: 30 })).statusCode).toBe(400);
      await connection.db.update(users).set({ status: "suspended" }).where(eq(users.id, user.id));
      expect((await send()).statusCode).toBe(403);
      expect(
        await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
      ).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

describe("Stock of the Day from stored reference prices", () => {
  it("shows the last primary price, a 24h comparison and a fact, excluding pool and future prices", async () => {
    const { app, send } = await setup();
    try {
      const ticker = stockOfTheDay("2026-10-15");
      await connection.db.insert(priceSnapshots).values([
        { ticker, source: "xstocks", priceUsd: "100", takenAt: new Date("2026-10-14T12:00:00Z") },
        { ticker, source: "xstocks", priceUsd: "110", takenAt: now },
        { ticker, source: "fluxion_pool", priceUsd: "999", takenAt: now },
        { ticker, source: "xstocks", priceUsd: "999", takenAt: new Date("2026-10-16T00:00:00Z") },
      ]);
      await connection.db.insert(tickerStatus).values({ ticker, state: "live", updatedAt: now });
      const response = await send("GET");
      expect(response.statusCode).toBe(200);
      const view = response.json<CheckinView>();
      expect(view.stock.price).toMatchObject({
        usd: "110",
        change24hPct: 10,
        state: "live",
        reason: null,
      });
      expect(view.stock.fact).toBeTypeOf("string");
      expect(view.stock.asset.tradeUrl).toBe("https://app.fluxion.network/trade");
      expect(view).toMatchObject({ checkedIn: false, balance: 0, streak: 0 });
    } finally {
      await app.close();
    }
  });
  it("keeps check-in available with missing or stale prices and preserves a closed-market reason", async () => {
    const { app, send } = await setup();
    try {
      expect((await send("GET")).json<CheckinView>().stock.price).toMatchObject({
        usd: null,
        change24hPct: null,
        state: "paused",
        reason: "stale",
      });
      const ticker = stockOfTheDay("2026-10-15");
      await connection.db.insert(priceSnapshots).values({
        ticker,
        source: "xstocks",
        priceUsd: "100",
        takenAt: new Date("2026-10-15T11:50:00Z"),
      });
      await connection.db
        .insert(tickerStatus)
        .values({ ticker, state: "paused", reason: "closed", updatedAt: now });
      expect((await send()).json<CheckinView>()).toMatchObject({
        checkedIn: true,
        balance: 10,
        stock: { price: { usd: "100", change24hPct: null, state: "paused", reason: "closed" } },
      });
    } finally {
      await app.close();
    }
  });
  it.each([3, 30])(
    "uses the supplied %s-asset catalog without a separate launch list",
    async (count) => {
      const catalog: AssetCatalog = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `ASSET_${index}`,
          {
            ...ASSETS.AAPL,
            name: `Asset ${index}`,
            symbol: `ASSET_${index}`,
            referenceTicker: `REFERENCE_${index}`,
          },
        ]),
      );
      const { app, send } = await setup(catalog);
      try {
        const view = (await send()).json<CheckinView>();
        expect(Object.keys(view.catalog)).toHaveLength(count);
        expect(view.stock.ticker).toBe(stockOfTheDay(view.day, assetTickers(catalog)));
        expect(view.stock.asset).toEqual(catalog[view.stock.ticker]);
        expect(view.stock.fact).toBeNull();
      } finally {
        await app.close();
      }
    },
  );
});
