import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  createLocalDatabase,
  users,
  identities,
  extendedQuotes,
  extendedPriceReferences,
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
it("starts shared flyer-3b courses and derives coin awards under the unchanged daily cap", async () => {
  await seed();
  const p = await player();
  for (const goal of [60, 70]) {
    const response = await start(p);
    expect(response.statusCode).toBe(200);
    const session = response.json<Session>();
    expect(session.course.version).toBe("flyer-3b");
    const flight = syntheticFlaps(session.course, goal, session.maxTicks);
    expect(flight.state.coins).toBeGreaterThan(0);
    expect(flight.state.pipes).toBeGreaterThanOrEqual(goal);
    now = new Date(new Date(session.startedAt).getTime() + (flight.ticks * 1000) / 60);
    const result = await app.inject({
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
    expect(result.statusCode).toBe(200);
    expect(result.json().score).toBe(result.json().pipes + result.json().coins);
    expect(result.json().pointsAwarded).toBe(goal === 60 ? 50 : 0);
    expect(result.json().pointsToday).toBe(50);
    const [stats] = await db.db
      .select()
      .from(flyerV3Results)
      .where(eq(flyerV3Results.sessionId, session.id));
    expect(stats?.coins).toBe(flight.state.coins);
  }
  expect(
    (await db.db.select().from(pointsLedger).where(eq(pointsLedger.userId, p.id))).reduce(
      (n, r) => n + r.amount,
      0,
    ),
  ).toBe(50);
});
it("preserves today's frozen v3 course and its open replay; only a new day uses v3b", async () => {
  await seed();
  const p = await player(),
    old = { ...syntheticV3Course(), day: now.toISOString().slice(0, 10) };
  await db.db.insert(flyerV3DailyCourses).values({ day: old.day, course: old, createdAt: now });
  const a = (await start(p)).json<Session>();
  expect(a.course).toEqual(old);
  const b = (await start(await player())).json<Session>();
  expect(b.course).toEqual(old);
  const flight = syntheticFlaps(a.course, 5, a.maxTicks);
  now = new Date(new Date(a.startedAt).getTime() + (flight.ticks * 1000) / 60);
  await app.close();
  app = buildServer({
    logger: false,
    auth: { database: db, env, now: () => now },
    flyer: { catalog },
  });
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/flyer/finish",
        headers: p.headers,
        payload: {
          sessionId: a.id,
          ticks: flight.ticks,
          score: flight.score,
          inputs: flight.inputs,
        },
      })
    ).statusCode,
  ).toBe(200);
  now = new Date(now.getTime() + 86400000);
  const nextResponse = await start(await player());
  expect(nextResponse.statusCode).toBe(200);
  const next = nextResponse.json<Session>();
  expect(next.course.version).toBe("flyer-3b");
  expect(next.course.day).not.toBe(old.day);
  expect(
    (await db.db.select().from(flyerV3DailyCourses).where(eq(flyerV3DailyCourses.day, old.day)))[0]
      ?.course,
  ).toEqual(old);
  const peer = (await start(await player())).json<Session>();
  expect(peer.course).toEqual(next.course);
});
