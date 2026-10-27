import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  createLocalDatabase,
  users,
  identities,
  extendedQuotes,
  extendedPriceReferences,
  flyerSessions,
  flyerV3DailyCourses,
  flyerV3Results,
  pointsLedger,
} from "@stock-arena/db";
import type { FlyerCourse, ReferenceCatalog } from "@stock-arena/game-core";
import {
  syntheticV3Course,
  syntheticFlaps,
} from "../../../packages/game-core/src/testing/flyer-v3-fixture.js";
import { createSessions } from "./auth/session.js";
import { buildServer } from "./server.js";
const db = createLocalDatabase(),
  secret = "synthetic-v3-tests-secret-for-local-tests-only",
  catalog: ReferenceCatalog = Object.fromEntries(
    syntheticV3Course().segments.map((s) => [s.ticker, s.asset]),
  );
let app: FastifyInstance,
  now: Date,
  index = 0;
const env = {
  SESSION_SECRET: secret,
  FLYER_MAX_FINISHES_PER_DAY: "100",
  FLYER_MAX_SESSION_SECONDS: "599",
};
beforeAll(() => db.migrate(), 30000);
afterAll(() => db.close());
beforeEach(async () => {
  now = new Date(Date.UTC(2027, 0, 1 + index++, 12));
  await db.db.delete(extendedQuotes);
  await db.db.delete(extendedPriceReferences);
  app = buildServer({
    logger: false,
    auth: { database: db, env, now: () => now },
    flyer: { catalog },
  });
});
afterEach(() => app.close());
async function player() {
  const [user] = await db.db
    .insert(users)
    .values({ displayName: "Synthetic v3 player", createdAt: now })
    .returning();
  const identity = { platform: "discord" as const, platformUserId: randomUUID() };
  await db.db.insert(identities).values({ userId: user!.id, ...identity });
  const session = await createSessions(secret, () => now).issue({ ...user!, identity });
  return { id: user!.id, headers: { authorization: `Bearer ${session.token}` } };
}
async function seed(history = true) {
  for (const [ticker, asset] of Object.entries(catalog)) {
    await db.db.insert(extendedQuotes).values({
      ticker,
      symbol: asset.symbol,
      priceUsd: "109",
      referencePrice: "100",
      referenceAt: new Date(now.getTime() - 86400000),
      change24hPct: "9",
      takenAt: now,
      updatedAt: now,
    });
    if (history)
      await db.db.insert(extendedPriceReferences).values(
        Array.from({ length: 20 }, (_, i) => ({
          ticker,
          priceUsd: String(100 + (i * 9) / 19),
          takenAt: new Date(now.getTime() - 86400000 + (i * 86400000) / 19),
        })),
      );
  }
}
type Player = Awaited<ReturnType<typeof player>>;
async function start(p: Player) {
  return app.inject({ method: "POST", url: "/api/flyer/start", headers: p.headers, payload: {} });
}
type Session = { id: string; course: FlyerCourse; maxTicks: number; startedAt: string };
it("freezes v3 order, coins and ten primary chart samples; retains old daily courses", async () => {
  await seed();
  const a = await player(),
    b = await player(),
    one = (await start(a)).json<Session>(),
    two = (await start(b)).json<Session>();
  expect(one.course.version).toBe("flyer-3");
  expect(one.course).toEqual(two.course);
  expect(one.course.segments[0]!.chart).toHaveLength(10);
  expect(one.course.segments[0]!.chart?.[0]).toBe("100");
  expect(one.course.segments[0]!.chart?.at(-1)).toBe("109");
  const [stored] = await db.db.select().from(flyerSessions).where(eq(flyerSessions.id, one.id));
  expect(stored?.course).toEqual({
    version: "flyer-3",
    dailyDay: one.course.day,
    seed: one.course.seed,
  });
  await expect(db.db.update(flyerV3DailyCourses).set({ course: one.course })).rejects.toThrow();
  await db.db.delete(extendedPriceReferences);
  expect(
    (
      await db.db
        .select()
        .from(flyerV3DailyCourses)
        .where(eq(flyerV3DailyCourses.day, one.course.day!))
    )[0]?.course,
  ).toEqual(one.course);
});
it("keeps gameplay available with an explicit no-chart fallback instead of invented samples", async () => {
  await seed(false);
  const r = await start(await player());
  expect(r.statusCode).toBe(200);
  expect(r.json<Session>().course.segments.every((s) => s.chart === undefined)).toBe(true);
});
it("replays flaps, derives pipes and coins, caps points and rejects client-supplied coins/double finish", async () => {
  await seed();
  const p = await player(),
    session = (await start(p)).json<Session>(),
    flight = syntheticFlaps(session.course, 5, session.maxTicks);
  now = new Date(new Date(session.startedAt).getTime() + (flight.ticks * 1000) / 60);
  const payload = {
    sessionId: session.id,
    ticks: flight.ticks,
    score: flight.score,
    inputs: flight.inputs,
  };
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/flyer/finish",
        headers: p.headers,
        payload: { ...payload, coins: 999 },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/flyer/finish",
        headers: p.headers,
        payload: { ...payload, score: flight.score + 1 },
      })
    ).statusCode,
  ).toBe(422);
  const r = await app.inject({
    method: "POST",
    url: "/api/flyer/finish",
    headers: p.headers,
    payload,
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().pipes).toBeGreaterThan(0);
  expect(r.json().score).toBe(r.json().pipes + r.json().coins);
  expect(r.json().pointsAwarded).toBe(Math.min(50, flight.score));
  expect(
    (await app.inject({ method: "POST", url: "/api/flyer/finish", headers: p.headers, payload }))
      .statusCode,
  ).toBe(409);
  const [stats] = await db.db
    .select()
    .from(flyerV3Results)
    .where(eq(flyerV3Results.sessionId, session.id));
  expect(stats?.coins).toBe(flight.state.coins);
  await expect(db.db.delete(flyerV3Results)).rejects.toThrow();
  expect(await db.db.select().from(pointsLedger).where(eq(pointsLedger.userId, p.id))).toHaveLength(
    flight.score ? 1 : 0,
  );
});

it("keeps daily-best delta awards capped at 50 when coins contribute to the score", async () => {
  await seed();
  const p = await player();
  for (const goal of [60, 70]) {
    const session = (await start(p)).json<Session>(),
      flight = syntheticFlaps(session.course, goal, session.maxTicks);
    expect(flight.state.pipes).toBeGreaterThanOrEqual(goal);
    expect(flight.state.coins).toBeGreaterThan(0);
    now = new Date(new Date(session.startedAt).getTime() + (flight.ticks * 1000) / 60);
    const r = await app.inject({
      method: "POST",
      url: "/api/flyer/finish",
      headers: p.headers,
      payload: {
        sessionId: session.id,
        ticks: flight.ticks,
        score: flight.score,
        inputs: flight.inputs,
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().pointsToday).toBe(50);
    expect(r.json().pointsAwarded).toBe(goal === 60 ? 50 : 0);
  }
  const ledger = await db.db.select().from(pointsLedger).where(eq(pointsLedger.userId, p.id));
  expect(ledger.reduce((n, r) => n + r.amount, 0)).toBe(50);
});
it("accepts a verified early exit, enforces wall-clock tolerance and awards only the replayed score", async () => {
  await seed();
  const p = await player(),
    session = (await start(p)).json<Session>();
  const payload = {
    sessionId: session.id,
    ticks: 10,
    score: 0,
    inputs: [{ tick: 0, action: "flap" }],
    stop: true,
  };
  now = new Date(now.getTime() + 10000);
  expect(
    (await app.inject({ method: "POST", url: "/api/flyer/finish", headers: p.headers, payload }))
      .statusCode,
  ).toBe(422);
  now = new Date(new Date(session.startedAt).getTime() + (10 * 1000) / 60);
  const r = await app.inject({
    method: "POST",
    url: "/api/flyer/finish",
    headers: p.headers,
    payload,
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().endReason).toBe("retired");
  expect(r.json().pointsAwarded).toBe(0);
  expect(
    (
      await db.db.execute(
        sql`select count(*)::int n from flyer_v3_results where session_id=${session.id}`,
      )
    ).rows[0]?.n,
  ).toBe(1);
});
