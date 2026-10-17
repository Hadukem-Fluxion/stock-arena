import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  createLocalDatabase,
  users,
  identities,
  priceSnapshots,
  tickerStatus,
  pointsLedger,
  hlRuns,
  hlRounds,
} from "@stock-arena/db";
import { ASSETS } from "@stock-arena/game-core";
import type { AssetCatalog, HlView } from "@stock-arena/game-core";
import { buildServer } from "./server.js";
import { createSessions } from "./auth/session.js";

const connection = createLocalDatabase();
const secret = "synthetic-hl-secret-never-used-in-production-48-bytes";
let now = new Date("2026-10-16T23:00:00Z");
beforeAll(async () => {
  await connection.migrate();
}, 30_000);
beforeEach(async () => {
  now = new Date("2026-10-16T23:00:00Z");
  await connection.db.delete(priceSnapshots);
  await connection.db.delete(tickerStatus);
});
afterAll(async () => {
  await connection.close();
});
function catalogFor(count: number): AssetCatalog {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `TEST_${i}`,
      { ...ASSETS.AAPL, symbol: `TEST_${i}x`, referenceTicker: `REF_${i}` },
    ]),
  );
}
async function setup(count = 3) {
  const catalog = catalogFor(count);
  const [user] = await connection.db
    .insert(users)
    .values({ displayName: "Synthetic HL player" })
    .returning();
  if (!user) throw new Error("Missing player");
  const identity = { platform: "discord" as const, platformUserId: user.id };
  await connection.db.insert(identities).values({ ...identity, userId: user.id });
  const session = await createSessions(secret, () => now).issue({ ...user, identity });
  const app = buildServer({
    logger: false,
    auth: { database: connection, env: { SESSION_SECRET: secret }, now: () => now },
    higherLower: { catalog, choose: () => 0 },
  });
  for (let i = 0; i < count; i++) {
    await connection.db.insert(priceSnapshots).values([
      {
        ticker: `REF_${i}`,
        priceUsd: "100",
        source: "xstocks",
        takenAt: new Date(now.getTime() - 86_400_000),
      },
      { ticker: `REF_${i}`, priceUsd: String(101 + i), source: "xstocks", takenAt: now },
      { ticker: `REF_${i}`, priceUsd: "999999", source: "fluxion_pool", takenAt: now },
    ]);
    await connection.db
      .insert(tickerStatus)
      .values({ ticker: `REF_${i}`, state: "live", updatedAt: now })
      .onConflictDoNothing();
  }
  const send = (action = "read", payload: unknown = {}) =>
    app.inject({
      method: action === "read" ? "GET" : "POST",
      url: action === "read" ? "/api/hl" : `/api/hl/${action}`,
      headers: { authorization: `Bearer ${session.token}` },
      ...(action === "read" ? {} : { payload: payload as Record<string, unknown> }),
    });
  const pick = async (view: HlView, correct: boolean) => {
    const [privateRound] = await connection.db
      .select()
      .from(hlRounds)
      .where(eq(hlRounds.id, view.round!.id));
    const ticker = correct
      ? privateRound!.winner
      : view.round!.stocks.find((stock) => stock.ticker !== privateRound!.winner)!.ticker;
    return send("pick", { runId: view.run!.id, roundId: view.round!.id, ticker });
  };
  return { app, user, catalog, send, pick };
}
describe("Higher or Lower", () => {
  it.each([3, 30])(
    "uses %s catalog assets, only primary prices, and hides the frozen key",
    async (count) => {
      const { app, send, pick, user } = await setup(count);
      try {
        const start = await send("start");
        expect(start.statusCode).toBe(200);
        const view = start.json<HlView>();
        expect(view.status).toBe("round");
        expect(view.round!.stocks[0].priceUsd).toBe("101");
        expect(start.body).not.toContain("change24hPct");
        expect(start.body).not.toContain('"winner"');
        // Fixture clock is after the US market close; no regular-session gate exists.
        const result = (await pick(view, true)).json<HlView>();
        expect(result.run!.score).toBe(5);
        expect(result.feedback!.stocks[1].change24hPct).toBeCloseTo(2);
        expect(
          await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
        ).toHaveLength(1);
      } finally {
        await app.close();
      }
    },
    15_000,
  );
  it("ends on the first miss and enforces three runs per UTC day", async () => {
    const { app, send, pick, user } = await setup();
    try {
      for (let i = 1; i <= 3; i++) {
        const view = (await send("start")).json<HlView>();
        expect(view.run!.number).toBe(i);
        expect((await pick(view, false)).json<HlView>().status).toBe("completed");
      }
      expect((await send("start")).json()).toEqual({ error: { code: "HL_DAILY_LIMIT" } });
      expect(
        await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
      ).toHaveLength(0);
      now = new Date("2026-10-17T00:00:00Z");
      expect((await send()).json<HlView>().runsUsed).toBe(0);
    } finally {
      await app.close();
    }
  });
  it("ends after ten correct picks and awards each round exactly once", async () => {
    const { app, send, pick, user } = await setup();
    try {
      let view = (await send("start")).json<HlView>();
      for (let i = 1; i <= 10; i++) {
        const result = (await pick(view, true)).json<HlView>();
        expect(result.run!.score).toBe(i * 5);
        expect(result.status).toBe(i === 10 ? "completed" : "feedback");
        if (i < 10) view = (await send("next")).json<HlView>();
      }
      const rows = await connection.db
        .select()
        .from(pointsLedger)
        .where(eq(pointsLedger.userId, user.id));
      expect(rows).toHaveLength(10);
      expect(new Set(rows.map((row) => row.refId)).size).toBe(10);
    } finally {
      await app.close();
    }
  });
  it("resumes repeated starts and serializes simultaneous picks without double awards", async () => {
    const { app, send, pick, user } = await setup();
    try {
      const starts = await Promise.all([send("start"), send("start")]);
      const view = starts[0]!.json<HlView>();
      expect(starts[1]!.json<HlView>().run!.id).toBe(view.run!.id);
      const replies = await Promise.all([pick(view, true), pick(view, true)]);
      expect(replies.every((reply) => reply.json<HlView>().run!.score === 5)).toBe(true);
      expect(
        await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
      ).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
  it("excludes paused, stale, missing-baseline and nearly tied stocks without consuming a run", async () => {
    const { app, send, user } = await setup();
    try {
      await connection.db
        .update(tickerStatus)
        .set({ state: "paused", reason: "closed" })
        .where(eq(tickerStatus.ticker, "REF_2"));
      await connection.db
        .update(priceSnapshots)
        .set({ priceUsd: "101.05" })
        .where(
          sql`ticker = 'REF_1' AND source = 'xstocks' AND taken_at = ${now.toISOString()}::timestamptz`,
        );
      const paused = (await send("start")).json<HlView>();
      expect(paused.status).toBe("paused");
      expect(paused.runsUsed).toBe(0);
      expect(paused.paused).toContainEqual({ ticker: "TEST_2", reason: "closed" });
      expect(
        await connection.db.select().from(hlRuns).where(eq(hlRuns.userId, user.id)),
      ).toHaveLength(0);
      await connection.db
        .delete(priceSnapshots)
        .where(sql`taken_at < ${now.toISOString()}::timestamptz`);
      expect((await send("start")).json<HlView>().status).toBe("paused");
      now = new Date(now.getTime() + 121_000);
      expect((await send()).json<HlView>().paused).toHaveLength(3);
    } finally {
      await app.close();
    }
  });
  it("blocks paused in-flight pairs and uses the original key after prices change", async () => {
    const { app, send, pick } = await setup();
    try {
      const view = (await send("start")).json<HlView>();
      await connection.db
        .update(tickerStatus)
        .set({ state: "paused", reason: "divergence" })
        .where(eq(tickerStatus.ticker, "REF_1"));
      expect((await pick(view, true)).json<HlView>().status).toBe("paused");
      await connection.db.update(tickerStatus).set({ state: "live", reason: null });
      await connection.db
        .update(priceSnapshots)
        .set({ priceUsd: "140" })
        .where(sql`ticker='REF_0' AND taken_at=${now.toISOString()}::timestamptz`);
      const result = (await pick(view, true)).json<HlView>();
      expect(result.feedback!.correct).toBe(true);
      expect(result.feedback!.stocks[0].change24hPct).toBeCloseTo(1);
    } finally {
      await app.close();
    }
  });
  it("rolls back the answer and run counter if the ledger insert fails", async () => {
    const { app, send, pick, user } = await setup();
    try {
      const view = (await send("start")).json<HlView>();
      await connection.db.insert(pointsLedger).values({
        userId: user.id,
        amount: 5,
        reason: "higher_lower",
        refId: `hl:${view.round!.id}`,
      });
      expect((await pick(view, true)).statusCode).toBe(500);
      const [round] = await connection.db
        .select()
        .from(hlRounds)
        .where(eq(hlRounds.id, view.round!.id));
      expect(round!.choice).toBeNull();
      expect((await send()).json<HlView>().run!.correctCount).toBe(0);
    } finally {
      await app.close();
    }
  });
  it("rejects forged input, cross-user picks and yesterday's round", async () => {
    const first = await setup();
    const second = await setup();
    try {
      const view = (await first.send("start")).json<HlView>();
      expect((await first.send("start", { score: 500 })).statusCode).toBe(400);
      expect(
        (
          await first.send("pick", {
            runId: view.run!.id,
            roundId: view.round!.id,
            ticker: "OTHER",
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await second.send("pick", {
            runId: view.run!.id,
            roundId: view.round!.id,
            ticker: "TEST_0",
          })
        ).statusCode,
      ).toBe(409);
      now = new Date("2026-10-17T00:00:00Z");
      expect((await first.pick(view, true)).json()).toEqual({ error: { code: "HL_DAY_EXPIRED" } });
      expect(
        (await first.app.inject({ method: "POST", url: "/api/hl/start", payload: {} })).statusCode,
      ).toBe(401);
    } finally {
      await first.app.close();
      await second.app.close();
    }
  });
});
