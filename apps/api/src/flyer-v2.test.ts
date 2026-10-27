import { dailyV2Course } from "./flyer.js";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  createLocalDatabase,
  extendedQuotes,
  extendedPriceReferences,
  flyerDailyCourses,
  flyerSessions,
  users,
  identities,
  pointsLedger,
} from "@stock-arena/db";
import type { FlyerCourse, ReferenceCatalog } from "@stock-arena/game-core";
import { syntheticDaylightCourse } from "../../../packages/game-core/src/testing/daylight-fixture.js";
import {
  syntheticFlight,
  syntheticFlyerCourse,
} from "../../../packages/game-core/src/testing/flyer-fixture.js";
import { createSessions } from "./auth/session.js";
import { buildServer } from "./server.js";
const db = createLocalDatabase(),
  secret = "synthetic-daylight-session-secret-for-tests";
let app: FastifyInstance,
  now: Date,
  sequence = 0;
let catalog: ReferenceCatalog;
const env = {
  SESSION_SECRET: secret,
  FLYER_MAX_FINISHES_PER_DAY: "100",
  FLYER_MAX_SESSION_SECONDS: "599",
};
function server() {
  return buildServer({
    logger: false,
    auth: { database: db, env, now: () => now },
    flyer: { catalog, createCourse: dailyV2Course },
  });
}
beforeAll(() => db.migrate(), 30000);
afterAll(() => db.close());
beforeEach(async () => {
  now = new Date(Date.UTC(2026, 10, 1 + sequence++, 12));
  catalog = Object.fromEntries(syntheticDaylightCourse(3).segments.map((s) => [s.ticker, s.asset]));
  await db.db.delete(extendedQuotes);
  await db.db.delete(extendedPriceReferences);
  app = server();
});
afterEach(() => app.close());
async function player() {
  const [user] = await db.db
    .insert(users)
    .values({ displayName: "Synthetic daylight player", createdAt: now })
    .returning();
  const identity = { platform: "discord" as const, platformUserId: randomUUID() };
  await db.db.insert(identities).values({ userId: user!.id, ...identity });
  const session = await createSessions(secret, () => now).issue({ ...user!, identity });
  return { id: user!.id, headers: { authorization: `Bearer ${session.token}` } };
}
type Player = Awaited<ReturnType<typeof player>>;
async function seed() {
  await db.db.insert(extendedQuotes).values(
    Object.entries(catalog).map(([ticker, asset], i) => ({
      ticker,
      symbol: asset.symbol,
      priceUsd: String(100 + i),
      referencePrice: "100",
      referenceAt: new Date(now.getTime() - 86400000),
      change24hPct: String(i),
      takenAt: now,
      updatedAt: now,
    })),
  );
}
async function start(p: Player) {
  return app.inject({ method: "POST", url: "/api/flyer/start", headers: p.headers, payload: {} });
}
type Session = { id: string; course: FlyerCourse; startedAt: string; maxTicks: number };
it.each([3, 30, 468])(
  "freezes one %i-stock daily course for all users and retains only a compact reference per session",
  async (count) => {
    catalog = Object.fromEntries(
      syntheticDaylightCourse(count).segments.map((s) => [s.ticker, s.asset]),
    );
    await app.close();
    app = server();
    await seed();
    const a = await player(),
      b = await player();
    const responses = await Promise.all([start(a), start(b)]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    const first = responses[0]!.json<Session>(),
      second = responses[1]!.json<Session>();
    expect(first.course.version).toBe("flyer-2");
    expect(first.course.segments).toHaveLength(count);
    expect(first.course).toEqual(second.course);
    const [stored] = await db.db.select().from(flyerSessions).where(eq(flyerSessions.id, first.id));
    expect(stored?.course).toEqual({
      version: "flyer-2",
      dailyDay: first.course.day,
      seed: first.course.seed,
    });
    expect(JSON.stringify(stored?.course).length).toBeLessThan(100);
    await db.db.delete(extendedQuotes);
    await db.db.delete(extendedPriceReferences);
    await app.close();
    catalog = {};
    app = server();
    expect((await start(await player())).json<Session>().course).toEqual(first.course);
    const flight = syntheticFlight(first.course, 4, first.maxTicks);
    now = new Date(Date.parse(first.startedAt) + Math.round((flight.ticks * 1000) / 60));
    const payload = {
      sessionId: first.id,
      ticks: flight.ticks,
      score: flight.score,
      inputs: flight.inputs,
    };
    const result = await app.inject({
      method: "POST",
      url: "/api/flyer/finish",
      headers: a.headers,
      payload,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().pointsAwarded).toBe(Math.min(50, flight.score));
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/flyer/finish",
      headers: a.headers,
      payload,
    });
    expect(duplicate.json().error.code).toBe("FLYER_REUSED");
    expect(
      await db.db.select().from(pointsLedger).where(eq(pointsLedger.userId, a.id)),
    ).toHaveLength(1);
  },
);
it("skips halted/incomplete data, consumes nothing without a usable primary summary and freezes only valid candidates", async () => {
  const p = await player();
  expect((await start(p)).statusCode).toBe(503);
  expect(
    await db.db.select().from(flyerSessions).where(eq(flyerSessions.userId, p.id)),
  ).toHaveLength(0);
  await seed();
  const tickers = Object.keys(catalog);
  await db.db
    .update(extendedQuotes)
    .set({ halted: true })
    .where(eq(extendedQuotes.ticker, tickers[0]!));
  await db.db
    .update(extendedQuotes)
    .set({ referencePrice: null, referenceAt: null, change24hPct: null })
    .where(eq(extendedQuotes.ticker, tickers[1]!));
  const response = await start(p);
  expect(response.statusCode).toBe(200);
  expect(response.json<Session>().course.segments.map((s) => s.ticker)).toEqual([tickers[2]]);
});
it("replays an already open flyer-1 session after the v2 deployment without changing points rules", async () => {
  const p = await player(),
    course = syntheticFlyerCourse(),
    flight = syntheticFlight(course, 2);
  const [legacy] = await db.db
    .insert(flyerSessions)
    .values({
      userId: p.id,
      course,
      startedAt: now,
      expiresAt: new Date(now.getTime() + 600000),
      maxTicks: 35940,
    })
    .returning();
  now = new Date(now.getTime() + Math.round((flight.ticks * 1000) / 60));
  const response = await app.inject({
    method: "POST",
    url: "/api/flyer/finish",
    headers: p.headers,
    payload: {
      sessionId: legacy!.id,
      inputs: flight.inputs,
      ticks: flight.ticks,
      score: flight.score,
    },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().course).toEqual(course);
  expect(response.json().pointsAwarded).toBe(flight.score);
});
it("marks a frozen closed-session quote and creates a fresh daily order after UTC rollover", async () => {
  await seed();
  await db.db.update(extendedQuotes).set({ lastSession: true });
  const a = (await start(await player())).json<Session>();
  expect(a.course.segments.every((s) => s.lastSession)).toBe(true);
  now = new Date(now.getTime() + 86400000);
  const b = (await start(await player())).json<Session>();
  expect(a.course.day).not.toBe(b.course.day);
  expect(
    (
      await db.db.select().from(flyerDailyCourses).where(eq(flyerDailyCourses.day, a.course.day!))
    )[0]?.course,
  ).toEqual(a.course);
});
