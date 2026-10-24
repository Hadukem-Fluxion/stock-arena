import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createLocalDatabase,
  users,
  identities,
  rewardDestinations,
  checkins,
  quizAttempts,
  hlRuns,
  hlPredictions,
  seasons,
  gameControls,
} from "@stock-arena/db";
import type { FastifyInstance, HTTPMethods } from "fastify";
import { ASSETS } from "@stock-arena/game-core";
import { buildServer } from "./server.js";
import type { PublicStats } from "./public-stats.js";

const db = createLocalDatabase(),
  path = "/api/public/stats";
const origin = "https://mantle-synch.netlify.app";
let now = new Date("2026-10-24T12:00:00Z"),
  app: FastifyInstance;
function server(limit = "60") {
  return buildServer({
    logger: false,
    auth: {
      database: db,
      now: () => now,
      env: { PUBLIC_STATS_RATE_LIMIT_PER_MINUTE: limit },
    },
  });
}
beforeAll(() => db.migrate(), 30_000);
beforeEach(async () => {
  now = new Date("2026-10-24T12:00:00Z");
  await db.db.delete(hlPredictions);
  await db.db.delete(hlRuns);
  await db.db.delete(quizAttempts);
  await db.db.delete(checkins);
  await db.db.delete(rewardDestinations);
  await db.db.delete(identities);
  await db.db.delete(users);
  await db.db.delete(seasons);
  await db.db.update(gameControls).set({ paused: false, reason: "" });
  app = server();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});
afterAll(() => db.close());
const get = (headers: Record<string, string> = {}, ip = "198.51.100.10") =>
  app.inject({ method: "GET", url: path, headers, remoteAddress: ip });

describe("public stats (T35)", () => {
  it("returns only aggregate fields without auth/cookies/PII, deduplicating gameplay users", async () => {
    const players = await db.db
      .insert(users)
      .values(
        Array.from({ length: 4 }, () => ({
          displayName: "Synthetic private profile marker",
          createdAt: new Date("2026-10-23T00:00:00Z"),
        })),
      )
      .returning();
    const [a, b, c, d] = players.map((p) => p.id) as [string, string, string, string];
    await db.db.insert(identities).values([
      { userId: a, platform: "discord", platformUserId: "synthetic-discord-private" },
      { userId: a, platform: "telegram", platformUserId: "synthetic-telegram-private" },
    ]);
    await db.db.insert(rewardDestinations).values({
      userId: a,
      bybitUid: "55500111",
      mantleAddress: `0x${"1".repeat(40)}`,
      changedAt: now,
    });
    await db.db.insert(seasons).values([
      {
        id: "season-1",
        name: "Season 1",
        startsAt: new Date("2026-10-16T00:00:00Z"),
        endsAt: new Date("2026-10-25T00:00:00Z"),
      },
      { id: "season-2", name: "Season 2", startsAt: new Date("2026-10-25T00:00:00Z") },
    ]);
    await db.db
      .update(gameControls)
      .set({ paused: true, reason: "Synthetic private moderation note" })
      .where(eq(gameControls.game, "quiz"));
    await db.db.insert(checkins).values([
      { userId: a, day: "2026-10-24", streak: 1 },
      { userId: d, day: "2026-10-23", streak: 1 },
    ]);
    const questionIds = [randomUUID(), randomUUID(), randomUUID()];
    await db.db.insert(quizAttempts).values([
      {
        userId: a,
        day: "2026-10-24",
        questionIds,
        answers: [0, -1, 1],
        startedAt: [now, now, now],
      },
      { userId: b, day: "2026-10-24", questionIds, answers: [], startedAt: [now] },
      { userId: d, day: "2026-10-23", questionIds, answers: [0, 0, 0], startedAt: [now, now, now] },
    ]);
    const runs = await db.db
      .insert(hlRuns)
      .values([
        { userId: a, day: "2026-10-24", runNumber: 1, model: "prediction", createdAt: now },
        {
          userId: c,
          day: "2026-10-23",
          runNumber: 1,
          model: "prediction",
          createdAt: new Date("2026-10-23T12:00:00Z"),
        },
        {
          userId: d,
          day: "2026-10-25",
          runNumber: 1,
          model: "prediction",
          createdAt: new Date("2026-10-25T12:00:00Z"),
        },
      ])
      .returning();
    const prediction = {
      ticker: "AAPL",
      referenceTicker: "AAPL",
      asset: ASSETS.AAPL,
      offeredAt: now,
    };
    await db.db.insert(hlPredictions).values([
      {
        ...prediction,
        runId: runs[0]!.id,
        position: 0,
        lockedAt: now,
        direction: "up",
        state: "won",
        settledAt: now,
      },
      { ...prediction, runId: runs[0]!.id, position: 1, state: "offered" },
      {
        ...prediction,
        runId: runs[1]!.id,
        position: 0,
        lockedAt: now,
        direction: "down",
        state: "waiting_start",
      },
      {
        ...prediction,
        runId: runs[2]!.id,
        position: 0,
        lockedAt: new Date("2026-10-25T12:00:00Z"),
        direction: "up",
        state: "waiting_start",
      },
    ]);
    const result = await get({
      origin,
      cookie: "session=synthetic-cookie",
      authorization: "invalid",
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.headers["cache-control"]).toBe("public, max-age=60");
    expect(result.json()).toEqual({
      updatedAt: now.toISOString(),
      day: "2026-10-24",
      season: {
        id: "season-1",
        name: "Season 1",
        startsAt: "2026-10-16T00:00:00.000Z",
        endsAt: "2026-10-25T00:00:00.000Z",
      },
      players: { total: 4, activeToday: 3 },
      today: { checkins: 1, quizCompleted: 1, hlPredictions: 2 },
      games: { checkin: "active", quiz: "paused", higherLower: "active" },
    });
    for (const value of [
      ...players.map((p) => p.id),
      ...questionIds,
      "private",
      "55500111",
      `0x${"1".repeat(40)}`,
    ])
      expect(result.body).not.toContain(value);
    expect((await app.inject({ url: "/api/checkin" })).statusCode).toBe(401);
  });

  it("returns zero counts and null season without inventing data", async () => {
    const result = (await get()).json<PublicStats>();
    expect(result.season).toBeNull();
    expect(result.players).toEqual({ total: 0, activeToday: 0 });
    expect(result.today).toEqual({ checkins: 0, quizCompleted: 0, hlPredictions: 0 });
  });

  it("coalesces concurrent cold requests and refreshes once after 60 seconds", async () => {
    const execute = vi.spyOn(db.db, "execute");
    const results = await Promise.all(Array.from({ length: 20 }, () => get()));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    await db.db.insert(users).values({ displayName: "Synthetic new player" });
    now = new Date("2026-10-24T12:00:59Z");
    expect((await get()).json<PublicStats>().players.total).toBe(0);
    now = new Date("2026-10-24T12:01:00Z");
    const refreshed = await Promise.all([get(), get(), get()]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(refreshed[0]!.json<PublicStats>()).toMatchObject({
      players: { total: 1 },
      updatedAt: now.toISOString(),
    });
  });

  it("invalidates at UTC midnight and returns the newest started season, including its end date", async () => {
    await db.db.insert(seasons).values({
      id: "ended",
      name: "Ended season",
      startsAt: new Date("2026-10-16T00:00:00Z"),
      endsAt: new Date("2026-10-23T00:00:00Z"),
    });
    now = new Date("2026-10-24T23:59:59Z");
    const execute = vi.spyOn(db.db, "execute");
    expect((await get()).json<PublicStats>().season?.endsAt).toBe("2026-10-23T00:00:00.000Z");
    now = new Date("2026-10-25T00:00:00Z");
    expect((await get()).json<PublicStats>().day).toBe("2026-10-25");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([origin, "https://other.example", `${origin}/`, "null", ""])(
    "allows CORS only for the exact origin: %s",
    async (requestOrigin) => {
      const result = await get(requestOrigin ? { origin: requestOrigin } : {});
      expect(result.statusCode).toBe(200);
      expect(result.headers.vary).toBe("Origin");
      expect(result.headers["access-control-allow-origin"]).toBe(
        requestOrigin === origin ? origin : undefined,
      );
      expect(result.headers["access-control-allow-credentials"]).toBeUndefined();
    },
  );

  it("handles preflight and unsupported methods without parsing bodies or querying the DB", async () => {
    const execute = vi.spyOn(db.db, "execute");
    const preflight = await app.inject({
      method: "OPTIONS",
      url: path,
      headers: { origin, "access-control-request-method": "GET" },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toBe("GET, OPTIONS");
    expect(preflight.headers["set-cookie"]).toBeUndefined();
    const denied = await app.inject({
      method: "OPTIONS",
      url: path,
      headers: { origin: "https://other.example" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "TRACE"] as HTTPMethods[]) {
      const result = await app.inject({
        method,
        url: path,
        headers: { "content-type": "application/json" },
        ...(method === "HEAD" ? {} : { payload: "{invalid" }),
      });
      expect(result.statusCode).toBe(405);
      expect(result.headers.allow).toBe("GET, OPTIONS");
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("limits each IP and resets in the next minute without caching 429", async () => {
    await app.close();
    app = server("2");
    expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(200);
    const limited = await get({ origin });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.headers["cache-control"]).toBe("no-store");
    expect(limited.headers["access-control-allow-origin"]).toBe(origin);
    expect((await get({}, "198.51.100.11")).statusCode).toBe(200);
    now = new Date("2026-10-24T12:01:00Z");
    expect((await get()).statusCode).toBe(200);
  });

  it("ignores spoofed forwarded headers from public peers and uses only the nearest private proxy hop", async () => {
    await app.close();
    app = server("1");
    expect((await get({ "x-forwarded-for": "203.0.113.1" })).statusCode).toBe(200);
    expect((await get({ "x-forwarded-for": "203.0.113.2" })).statusCode).toBe(429);
    expect(
      (await get({ "x-forwarded-for": "203.0.113.3, 203.0.113.20" }, "172.18.0.2")).statusCode,
    ).toBe(200);
    expect(
      (await get({ "x-forwarded-for": "203.0.113.4, 203.0.113.20" }, "172.18.0.2")).statusCode,
    ).toBe(429);
    expect((await get({ "x-forwarded-for": "203.0.113.21" }, "172.18.0.2")).statusCode).toBe(200);
  });

  it("rejects unexpected query parameters and sanitizes DB failures without per-request retries", async () => {
    const execute = vi.spyOn(db.db, "execute");
    expect((await app.inject({ url: `${path}?userId=synthetic-private-filter` })).statusCode).toBe(
      400,
    );
    expect(execute).not.toHaveBeenCalled();
    execute.mockImplementationOnce(() => {
      throw new Error("synthetic-private-database-credential");
    });
    const failed = await get({ origin });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ error: { code: "STATS_UNAVAILABLE" } });
    expect(failed.headers["cache-control"]).toBe("no-store");
    expect(failed.body).not.toContain("private");
    expect((await get()).statusCode).toBe(503);
    expect(execute).toHaveBeenCalledTimes(1);
    now = new Date("2026-10-24T12:01:00Z");
    expect((await get()).statusCode).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
