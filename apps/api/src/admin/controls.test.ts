import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminActions,
  adminSessions,
  checkins,
  createLocalDatabase,
  gameControls,
  hlPredictions,
  hlRuns,
  identities,
  pointsLedger,
  priceSnapshots,
  quizAttempts,
  quizQuestions,
  quizDailySets,
  seasons,
  staff,
  tickerControls,
  tickerStatus,
  users,
} from "@stock-arena/db";
import { ASSETS } from "@stock-arena/game-core";
import type { AssetCatalog } from "@stock-arena/game-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { createSessions } from "../auth/session.js";
import { digest, hmac, SESSION_COOKIE } from "./security.js";
import { ROLES } from "./permissions.js";
import type { Role } from "./permissions.js";
import { createPriceStore } from "../../../worker/src/prices.js";
import { settlePredictions } from "../../../worker/src/predictions.js";
import { createHlStore } from "../higher-lower.js";

const db = createLocalDatabase(),
  instant = new Date("2026-10-22T12:00:00Z");
const secret = "synthetic-controls-session-secret-only-for-tests",
  origin = "https://arena.example";
let now = instant,
  app: FastifyInstance;
beforeAll(async () => {
  await db.migrate();
}, 30000);
beforeEach(async () => {
  now = instant;
  await db.db.update(gameControls).set({ paused: false, reason: "" });
  await db.db.delete(tickerControls);
  await db.db.delete(tickerStatus);
  await db.db.delete(priceSnapshots);
  await db.db.delete(quizDailySets);
  await db.db.delete(quizQuestions);
  await db.db.delete(seasons);
  await db.db
    .insert(seasons)
    .values({ id: "season-1", name: "Season 1", startsAt: new Date("2026-10-16T00:00:00Z") });
  app = buildServer({
    logger: false,
    auth: {
      database: db,
      env: { SESSION_SECRET: secret, ADMIN_WEB_ORIGIN: origin },
      now: () => now,
    },
  });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.close();
});
async function actor(role: Role = "owner") {
  const [user] = await db.db
    .insert(users)
    .values({ displayName: `Synthetic ${role}` })
    .returning();
  await db.db.insert(staff).values({ userId: user!.id, role, grantedBy: user!.id });
  const token = Buffer.from(randomUUID()).toString("base64url").slice(0, 43);
  await db.db.insert(adminSessions).values({
    tokenHash: digest(token),
    userId: user!.id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 43200000),
  });
  return {
    id: user!.id,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      origin,
      "x-admin-csrf": hmac(secret, `admin-csrf:${token}`),
    },
  };
}
async function player() {
  const [user] = await db.db
    .insert(users)
    .values({ displayName: "Synthetic controls player" })
    .returning();
  const identity = { platform: "discord" as const, platformUserId: randomUUID() };
  await db.db.insert(identities).values({ userId: user!.id, ...identity });
  const session = await createSessions(secret, () => now).issue({ ...user!, identity });
  return { id: user!.id, headers: { authorization: `Bearer ${session.token}` } };
}
async function post(headers: Record<string, string>, path: string, body: unknown) {
  return app.inject({
    method: "POST",
    url: `/api/${path}`,
    headers: { ...headers, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
}
async function audit(id: string) {
  return db.db.select().from(adminActions).where(eq(adminActions.adminId, id));
}
async function bank() {
  await db.db.insert(quizQuestions).values(
    Array.from({ length: 3 }, (_, n) => ({
      slug: `synthetic-${n}`,
      prompt: `Invented marker ${n}?`,
      topic: "Synthetic",
      options: ["A", "B", "C", "D"] as [string, string, string, string],
      answerIndex: 0,
      explanation: "Invented",
    })),
  );
}
async function prices(price = "100") {
  await createPriceStore(db, { divergencePct: 3, jumpLimitPct: 5 }, () => {})({
    takenAt: now,
    snapshots: [
      { ticker: "AAPL", source: "xstocks", priceUsd: price, takenAt: now, blockNumber: null },
    ],
    trading: {
      AAPL: {
        currentPeriod: "market",
        isTradingHalted: false,
        openNow: true,
        nextChangeAt: null,
        tradingHoursMode: "TwentyFourFive",
      },
    },
  });
}
describe("T30 permissions and audits", () => {
  it.each(ROLES)("checks every control route for %s", async (role) => {
    const a = await actor(role),
      allowed = role === "owner" || role === "admin";
    for (const path of ["games", "tickers", "seasons"]) {
      expect((await app.inject({ url: `/api/admin/${path}`, headers: a.headers })).statusCode).toBe(
        allowed ? 200 : 403,
      );
      expect((await post(a.headers, `admin/${path}`, {})).statusCode).toBe(allowed ? 400 : 403);
    }
  });
  it("rechecks revoked sessions inside writes and rejects CSRF/missing reasons", async () => {
    const a = await actor();
    let revoke = false;
    app.addHook("preHandler", async () => {
      if (revoke) await db.db.update(staff).set({ revokedAt: now }).where(eq(staff.userId, a.id));
    });
    expect(
      (
        await post({ cookie: a.headers.cookie }, "admin/games", {
          game: "quiz",
          paused: true,
          reason: "Synthetic",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await post(a.headers, "admin/games", { game: "quiz", paused: true, reason: " " }))
        .statusCode,
    ).toBe(400);
    revoke = true;
    expect(
      (await post(a.headers, "admin/games", { game: "quiz", paused: true, reason: "Synthetic" }))
        .statusCode,
    ).toBe(403);
    expect(await audit(a.id)).toHaveLength(0);
  });
});
describe("T30 maintenance gates", () => {
  it.each(["checkin", "quiz", "higher_lower"] as const)(
    "pauses %s without consuming attempts, runs or points and resumes",
    async (game) => {
      const a = await actor(),
        p = await player();
      await bank();
      await prices();
      expect(
        (
          await post(a.headers, "admin/games", {
            game,
            paused: true,
            reason: "Synthetic maintenance",
          })
        ).statusCode,
      ).toBe(200);
      const path = game === "higher_lower" ? "hl" : game;
      expect(
        (await app.inject({ url: `/api/${path}`, headers: p.headers })).json().maintenance,
      ).toBe(true);
      const action = game === "checkin" ? "checkin" : `${path}/start`;
      const payload = game === "higher_lower" ? { requestId: randomUUID() } : {};
      expect((await post(p.headers, action, payload)).json()).toEqual({
        error: { code: "GAME_PAUSED" },
      });
      for (const table of [checkins, quizAttempts, hlRuns, pointsLedger]) {
        const rows = await db.db.select().from(table).where(eq(table.userId, p.id));
        expect(rows).toHaveLength(0);
      }
      expect(
        (
          await post(a.headers, "admin/games", {
            game,
            paused: false,
            reason: "Synthetic recovery",
          })
        ).statusCode,
      ).toBe(200);
      expect([200, 201]).toContain((await post(p.headers, action, payload)).statusCode);
      expect((await audit(a.id)).map((r) => r.action)).toEqual([
        "game.control_changed",
        "game.control_changed",
      ]);
    },
  );
  it("blocks quiz answers/next without resetting clocks or altering a frozen attempt", async () => {
    const a = await actor(),
      p = await player();
    await bank();
    const started = (await post(p.headers, "quiz/start", {})).json();
    await post(a.headers, "admin/games", { game: "quiz", paused: true, reason: "Synthetic" });
    const before = await db.db.select().from(quizAttempts).where(eq(quizAttempts.userId, p.id));
    const answer = { day: started.day, position: 0, questionId: started.question.id, choice: 0 };
    for (const [path, body] of [
      ["quiz/answer", answer],
      ["quiz/next", {}],
    ] as const)
      expect((await post(p.headers, path, body)).statusCode).toBe(409);
    expect(await db.db.select().from(quizAttempts).where(eq(quizAttempts.userId, p.id))).toEqual(
      before,
    );
  });
  it("keeps pending predictions visible and settling; blocks picks/next and preserves the offer", async () => {
    const a = await actor(),
      p = await player();
    await prices();
    const store = createHlStore(db, {
      catalog: { AAPL: ASSETS.AAPL },
      now: () => now,
      choose: () => 0,
    });
    const offered = await store(p.id, { type: "start", requestId: randomUUID() }),
      run = offered.runs[0]!;
    await store(p.id, { type: "pick", runId: run.id, roundId: run.round!.id, direction: "up" });
    const second = await store(p.id, { type: "start", requestId: randomUUID() });
    await post(a.headers, "admin/games", {
      game: "higher_lower",
      paused: true,
      reason: "Synthetic",
    });
    const before = await db.db
      .select()
      .from(hlPredictions)
      .where(eq(hlPredictions.runId, second.runs[0]!.id));
    for (const [path, body] of [
      ["hl/next", { runId: run.id }],
      ["hl/pick", { runId: run.id, roundId: run.round!.id, direction: "down" }],
    ] as const)
      expect((await post(p.headers, path, body)).statusCode).toBe(409);
    const view = (await app.inject({ url: "/api/hl", headers: p.headers })).json();
    expect(view).toMatchObject({ maintenance: true, canStart: false, runsUsed: 2 });
    expect(view.runs).toHaveLength(2);
    expect(view.runs.every((r: { canPick: boolean }) => !r.canPick)).toBe(true);
    expect(
      await db.db.select().from(hlPredictions).where(eq(hlPredictions.runId, second.runs[0]!.id)),
    ).toEqual(before);
    now = new Date(instant.getTime() + 15000);
    await prices();
    await settlePredictions(db, now);
    now = new Date(now.getTime() + 900000);
    await prices("101");
    await settlePredictions(db, now);
    const awards = await db.db.select().from(pointsLedger).where(eq(pointsLedger.userId, p.id));
    expect(awards).toMatchObject([{ amount: 5, refId: `hl:${run.round!.id}` }]);
  });
});
describe("T30 ticker overrides", () => {
  it("preserves a manual pause through polling, marks samples untradable and resumes safely", async () => {
    const a = await actor();
    await prices();
    expect(
      (
        await post(a.headers, "admin/tickers", {
          ticker: "AAPL",
          paused: true,
          reason: "Synthetic review",
        })
      ).statusCode,
    ).toBe(200);
    now = new Date(now.getTime() + 15000);
    await prices();
    let [state] = await db.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "AAPL"));
    expect(state).toMatchObject({ state: "paused", reason: "manual", oracleState: "live" });
    const [sample] = await db.db
      .select()
      .from(priceSnapshots)
      .where(and(eq(priceSnapshots.ticker, "AAPL"), eq(priceSnapshots.takenAt, now)));
    expect(sample!.tradable).toBe(false);
    expect(
      (
        await post(a.headers, "admin/tickers", {
          ticker: "AAPL",
          paused: false,
          reason: "Synthetic cleared",
        })
      ).statusCode,
    ).toBe(200);
    [state] = await db.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "AAPL"));
    expect(state).toMatchObject({ state: "live", reason: null });
    now = new Date(now.getTime() + 15000);
    await prices();
    expect(
      (await db.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "AAPL")))[0]!.state,
    ).toBe("live");
    expect(await audit(a.id)).toHaveLength(2);
    expect(
      (
        await post(a.headers, "admin/tickers", {
          ticker: "UNKNOWN",
          paused: true,
          reason: "Synthetic",
        })
      ).statusCode,
    ).toBe(400);
  });
  it.each(["closed", "divergence", "jump", "stale"])(
    "resuming cannot override oracle pause %s",
    async (reason) => {
      const a = await actor();
      await prices();
      await db.db
        .update(tickerStatus)
        .set({ oracleState: "paused", oracleReason: reason })
        .where(eq(tickerStatus.ticker, "AAPL"));
      await post(a.headers, "admin/tickers", { ticker: "AAPL", paused: true, reason: "Synthetic" });
      await post(a.headers, "admin/tickers", {
        ticker: "AAPL",
        paused: false,
        reason: "Synthetic resume",
      });
      expect(
        (await db.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "AAPL")))[0],
      ).toMatchObject({ state: "paused", reason });
    },
  );
  it("resuming with missing/stale data never manufactures freshness", async () => {
    const a = await actor();
    await prices();
    now = new Date(now.getTime() + 180000);
    await post(a.headers, "admin/tickers", { ticker: "AAPL", paused: false, reason: "Synthetic" });
    expect(
      (await db.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "AAPL")))[0],
    ).toMatchObject({ state: "paused", reason: "stale", updatedAt: instant });
    await post(a.headers, "admin/tickers", { ticker: "MSFT", paused: false, reason: "Synthetic" });
    expect(
      (await db.db.select().from(tickerStatus).where(eq(tickerStatus.ticker, "MSFT")))[0]!.state,
    ).toBe("paused");
  });
  it.each([3, 30])("reads a %s-asset catalog without hardcoded counts", async (count) => {
    const catalog: AssetCatalog = Object.fromEntries(
      Array.from({ length: count }, (_, n) => [
        `S${n}`,
        { ...ASSETS.AAPL, referenceTicker: `S${n}`, symbol: `S${n}x` },
      ]),
    );
    await app.close();
    app = buildServer({
      logger: false,
      checkin: { catalog },
      auth: {
        database: db,
        env: { SESSION_SECRET: secret, ADMIN_WEB_ORIGIN: origin },
        now: () => now,
      },
    });
    const a = await actor();
    expect(
      (await app.inject({ url: "/api/admin/tickers", headers: a.headers })).json().entries,
    ).toHaveLength(count);
  });
});
describe("T30 seasons and ranking boundaries", () => {
  const save = (id: string, startsAt: string, endsAt: string | null, create = false) => ({
    id,
    name: id,
    startsAt,
    endsAt,
    create,
    reason: "Synthetic season change",
  });
  it("limits past start edits to owner, audits before/after and never changes ledger rows", async () => {
    const a = await actor("admin"),
      owner = await actor(),
      p = await player();
    await db.db.insert(pointsLedger).values({
      userId: p.id,
      amount: 10,
      reason: "synthetic",
      refId: randomUUID(),
      createdAt: now,
    });
    const before = await db.db.select().from(pointsLedger).where(eq(pointsLedger.userId, p.id));
    const input = save("season-1", "2026-10-17T00:00:00Z", null);
    expect((await post(a.headers, "admin/seasons", input)).statusCode).toBe(403);
    expect((await post(owner.headers, "admin/seasons", input)).statusCode).toBe(200);
    expect(await db.db.select().from(pointsLedger).where(eq(pointsLedger.userId, p.id))).toEqual(
      before,
    );
    expect((await audit(owner.id))[0]!.details).toMatchObject({
      before: { startsAt: "2026-10-16T00:00:00.000Z" },
      after: { startsAt: "2026-10-17T00:00:00.000Z" },
    });
    expect(await audit(a.id)).toHaveLength(0);
  });
  it("switches rankings at the exact next-season boundary and reloads edited windows without restart", async () => {
    const a = await actor("admin"),
      p = await player();
    const end = "2026-10-23T00:00:00Z";
    expect(
      (await post(a.headers, "admin/seasons", save("season-2", end, null, true))).statusCode,
    ).toBe(409);
    await post(a.headers, "admin/seasons", save("season-1", "2026-10-16T00:00:00Z", end));
    expect(
      (await post(a.headers, "admin/seasons", save("season-2", end, null, true))).statusCode,
    ).toBe(200);
    await db.db.insert(pointsLedger).values([
      {
        userId: p.id,
        amount: 11,
        reason: "synthetic",
        refId: randomUUID(),
        createdAt: new Date("2026-10-15T23:59:59Z"),
      },
      {
        userId: p.id,
        amount: 7,
        reason: "synthetic",
        refId: randomUUID(),
        createdAt: new Date("2026-10-22T11:00:00Z"),
      },
      {
        userId: p.id,
        amount: 3,
        reason: "synthetic",
        refId: randomUUID(),
        createdAt: new Date(end),
      },
    ]);
    const read = () => app.inject({ url: "/api/leaderboard?period=season", headers: p.headers });
    expect((await read()).json()).toMatchObject({
      season: { id: "season-1", ended: false },
      caller: { score: 7 },
    });
    await post(
      a.headers,
      "admin/seasons",
      save("season-1", "2026-10-16T00:00:00Z", "2026-10-22T10:00:00Z"),
    );
    expect((await read()).json()).toMatchObject({
      season: { id: "season-1", ended: true },
      caller: null,
    });
    now = new Date(end);
    expect((await read()).json()).toMatchObject({
      season: { id: "season-2", ended: false },
      caller: { score: 3 },
    });
    expect(
      await db.db.select().from(pointsLedger).where(eq(pointsLedger.userId, p.id)),
    ).toHaveLength(3);
  });
  it("rejects overlaps, backdated next seasons, invalid dates and duplicate create IDs atomically", async () => {
    const a = await actor();
    expect(
      (await post(a.headers, "admin/seasons", save("season-1", "2026-10-16T00:00:00Z", null, true)))
        .statusCode,
    ).toBe(409);
    expect(
      (await post(a.headers, "admin/seasons", save("past", "2026-10-20T00:00:00Z", null, true)))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await post(
          a.headers,
          "admin/seasons",
          save("season-1", "2026-10-16T00:00:00Z", "2026-10-15T00:00:00Z"),
        )
      ).statusCode,
    ).toBe(400);
    await expect(
      db.db.insert(seasons).values({ id: "raw-overlap", name: "Synthetic", startsAt: now }),
    ).rejects.toThrow();
    expect(await audit(a.id)).toHaveLength(0);
    expect(await db.db.select().from(seasons)).toHaveLength(1);
  });
});
