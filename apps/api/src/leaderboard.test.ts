import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLocalDatabase, identities, pointsLedger, users } from "@stock-arena/db";
import { GAME_CONFIG } from "@stock-arena/game-core";
import type { LeaderboardView, Season } from "@stock-arena/game-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";
import { createSessions } from "./auth/session.js";
import { leaderboardWindow } from "./leaderboard.js";

const connection = createLocalDatabase();
const secret = "fake-leaderboard-secret-for-isolated-tests-48-bytes";
let now = new Date("2026-10-19T12:00:00Z");
const apps: FastifyInstance[] = [];
beforeAll(async () => {
  await connection.migrate();
}, 30_000);
beforeEach(async () => {
  now = new Date("2026-10-19T12:00:00Z");
  await connection.db.update(users).set({ status: "suspended" });
});
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
afterAll(async () => {
  await connection.close();
});
async function player(displayName: string, platform: "discord" | "telegram" = "discord") {
  const [user] = await connection.db.insert(users).values({ displayName }).returning();
  if (!user) throw new Error("Missing player");
  const identity = { platform, platformUserId: randomUUID() };
  await connection.db.insert(identities).values({ userId: user.id, ...identity });
  const session = await createSessions(secret, () => now).issue({ ...user, identity });
  return { ...user, token: session.token };
}
async function awards(userId: string, entries: [number, string][]) {
  await connection.db.insert(pointsLedger).values(
    entries.map(([amount, at]) => ({
      userId,
      amount,
      createdAt: new Date(at),
      reason: "synthetic_test",
      refId: randomUUID(),
    })),
  );
}
function server(season?: Season) {
  const app = buildServer({
    logger: false,
    auth: { database: connection, env: { SESSION_SECRET: secret }, now: () => now },
    leaderboard: { season },
  });
  apps.push(app);
  return (token: string, query = "period=day&platform=all") =>
    app.inject({
      method: "GET",
      url: `/api/leaderboard?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
}
describe("leaderboard windows", () => {
  it("uses Monday-to-Monday UTC weeks and calendar UTC days at both boundaries", () => {
    expect(
      leaderboardWindow("week", new Date("2026-10-18T23:59:59.999Z"), GAME_CONFIG.season),
    ).toEqual({ startsAt: "2026-10-12T00:00:00.000Z", endsAt: "2026-10-19T00:00:00.000Z" });
    expect(leaderboardWindow("week", new Date("2026-10-19T00:00:00Z"), GAME_CONFIG.season)).toEqual(
      { startsAt: "2026-10-19T00:00:00.000Z", endsAt: "2026-10-26T00:00:00.000Z" },
    );
    expect(leaderboardWindow("day", new Date("2026-10-19T00:00:00Z"), GAME_CONFIG.season)).toEqual({
      startsAt: "2026-10-19T00:00:00.000Z",
      endsAt: "2026-10-20T00:00:00.000Z",
    });
  });
});
describe("leaderboard API", () => {
  it("counts an ongoing season from the configured staging start, excluding earlier and future points", async () => {
    const user = await player("Ongoing season player");
    await awards(user.id, [
      [100, "2026-10-15T23:59:59Z"],
      [20, "2026-10-16T00:00:00Z"],
      [5, "2026-10-19T11:00:00Z"],
      [1000, "2026-10-20T00:00:00Z"],
    ]);
    const send = server();
    const result = await send(user.token, "period=season&platform=all");
    expect(result.statusCode).toBe(200);
    expect(result.json<LeaderboardView>()).toMatchObject({
      season: { ended: false, endsAt: null },
      caller: { score: 25, rank: 1 },
      endsAt: null,
    });
    expect((await send(user.token)).json<LeaderboardView>().caller!.score).toBe(5);
  });
  it("closes the season at endsAt and never rewrites historical awards", async () => {
    const user = await player("Closed season player");
    await awards(user.id, [
      [20, "2026-10-17T23:59:59.999Z"],
      [100, "2026-10-18T00:00:00Z"],
      [200, "2026-10-19T00:00:00Z"],
    ]);
    const result = (
      await server({ ...GAME_CONFIG.season, endsAt: "2026-10-18T00:00:00Z" })(
        user.token,
        "period=season&platform=all",
      )
    ).json<LeaderboardView>();
    expect(result.season.ended).toBe(true);
    expect(result.caller!.score).toBe(20);
    expect(
      await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
    ).toHaveLength(3);
  });
  it("orders ties by first attainment of the final score, including negative corrections and zero entries", async () => {
    const a = await player("A"),
      b = await player("B"),
      c = await player("C");
    await awards(a.id, [
      [30, "2026-10-19T00:10:00Z"],
      [-10, "2026-10-19T00:30:00Z"],
    ]);
    await awards(b.id, [
      [20, "2026-10-19T00:20:00Z"],
      [0, "2026-10-19T00:40:00Z"],
    ]);
    await awards(c.id, [
      [20, "2026-10-19T00:05:00Z"],
      [-5, "2026-10-19T00:15:00Z"],
      [5, "2026-10-19T00:50:00Z"],
    ]);
    const result = (await server()(a.token)).json<LeaderboardView>();
    expect(result.top.map((row) => row.userId)).toEqual([c.id, b.id, a.id]);
    expect(result.top.map((row) => row.score)).toEqual([20, 20, 20]);
  });
  it("filters by identity without double-counting linked players", async () => {
    const discord = await player("Discord"),
      telegram = await player("Telegram", "telegram");
    await connection.db
      .insert(identities)
      .values({ userId: discord.id, platform: "telegram", platformUserId: randomUUID() });
    await awards(discord.id, [[20, "2026-10-19T10:00:00Z"]]);
    await awards(telegram.id, [[10, "2026-10-19T10:00:00Z"]]);
    const send = server();
    expect((await send(discord.token)).json<LeaderboardView>().top.map((row) => row.score)).toEqual(
      [20, 10],
    );
    expect(
      (await send(discord.token, "period=day&platform=discord"))
        .json<LeaderboardView>()
        .top.map((row) => row.userId),
    ).toEqual([discord.id]);
    expect(
      (await send(telegram.token, "period=day&platform=telegram"))
        .json<LeaderboardView>()
        .top.map((row) => row.score),
    ).toEqual([20, 10]);
  });
  it("caches for 60 seconds, isolates the caller's rank and invalidates at UTC midnight", async () => {
    now = new Date("2026-10-19T23:59:30Z");
    const a = await player("Cached A"),
      b = await player("Cached B");
    await awards(a.id, [[10, "2026-10-19T10:00:00Z"]]);
    await awards(b.id, [[5, "2026-10-19T10:00:00Z"]]);
    const send = server();
    const first = (await send(a.token)).json<LeaderboardView>();
    await awards(b.id, [[20, "2026-10-19T23:59:30Z"]]);
    const cached = (await send(b.token)).json<LeaderboardView>();
    expect(cached.generatedAt).toBe(first.generatedAt);
    expect(cached.caller).toMatchObject({ userId: b.id, score: 5, rank: 2 });
    now = new Date("2026-10-20T00:00:00Z");
    expect((await send(a.token)).json<LeaderboardView>().top).toEqual([]);
    now = new Date("2026-10-20T12:00:00Z");
    await awards(b.id, [[10, "2026-10-20T01:00:00Z"]]);
    const fresh = (await send(b.token)).json<LeaderboardView>();
    expect(fresh.caller!.score).toBe(10);
    await awards(b.id, [[5, "2026-10-20T11:00:00Z"]]);
    expect((await send(b.token)).json<LeaderboardView>().caller!.score).toBe(10);
    now = new Date(now.getTime() + 60_000);
    expect((await send(b.token)).json<LeaderboardView>().caller!.score).toBe(15);
  });
  it("returns top 100 and the caller at rank 105", async () => {
    const inserted = await connection.db
      .insert(users)
      .values(Array.from({ length: 105 }, (_, i) => ({ displayName: `Synthetic ${i}` })))
      .returning();
    await connection.db.insert(identities).values(
      inserted.map((user) => ({
        userId: user.id,
        platform: "discord" as const,
        platformUserId: user.id,
      })),
    );
    await connection.db.insert(pointsLedger).values(
      inserted.map((user, i) => ({
        userId: user.id,
        amount: 105 - i,
        reason: "synthetic_test",
        refId: user.id,
        createdAt: now,
      })),
    );
    const caller = inserted.at(-1)!;
    const session = await createSessions(secret, () => now).issue({
      ...caller,
      identity: { platform: "discord", platformUserId: caller.id },
    });
    const response = await server()(session.token);
    const result = response.json<LeaderboardView>();
    expect(result.top).toHaveLength(100);
    expect(result.caller).toMatchObject({ rank: 105, score: 1, userId: caller.id });
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
  it("validates filters and requires an active authenticated caller", async () => {
    const user = await player("Unranked");
    const send = server();
    expect((await send(user.token)).json<LeaderboardView>().caller).toBeNull();
    for (const query of ["period=month", "platform=other", "period=day&limit=1000"])
      expect((await send(user.token, query)).statusCode).toBe(400);
    expect((await send("invalid-token")).statusCode).toBe(401);
  });
});
