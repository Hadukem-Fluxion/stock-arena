import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { ASSETS, GAME_CONFIG } from "@stock-arena/game-core";
import type { AssetCatalog, FlyerCourse, FlyerInput } from "@stock-arena/game-core";
import {
  adminActions,
  adminSessions,
  createLocalDatabase,
  flyerSessions,
  gameControls,
  identities,
  pointsLedger,
  priceSnapshots,
  staff,
  users,
} from "@stock-arena/db";
import {
  syntheticFlight,
  syntheticFlyerCourse,
} from "../../../packages/game-core/src/testing/flyer-fixture.js";
import { buildServer } from "./server.js";
import { createSessions } from "./auth/session.js";
import { digest, hmac, SESSION_COOKIE } from "./admin/security.js";
import { ensureInviteCode } from "./referrals.js";
import { retainPriceSnapshots } from "../../worker/src/retention.js";
const db = createLocalDatabase(),
  secret = "synthetic-flyer-session-secret-for-tests-only",
  origin = "https://arena.example";
const instant = new Date("2026-10-25T12:00:00Z");
let now = instant,
  app: FastifyInstance;
let env: Record<string, string | undefined>;
function catalog(count = 3): AssetCatalog {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `SYN${i}`,
      {
        ...ASSETS.AAPL,
        symbol: `SYN${i}x`,
        name: `Synthetic company ${i}`,
        referenceTicker: `SYN${i}`,
      },
    ]),
  ) as AssetCatalog;
}
let assets = catalog();
beforeAll(async () => {
  await db.migrate();
}, 30000);
beforeEach(async () => {
  now = instant;
  assets = catalog();
  await db.db.delete(priceSnapshots);
  await db.db.update(gameControls).set({ paused: false });
  env = {
    SESSION_SECRET: secret,
    ADMIN_WEB_ORIGIN: origin,
    FLYER_MAX_FINISHES_PER_DAY: "10",
    FLYER_MAX_SESSION_SECONDS: String(GAME_CONFIG.flyer.sessionExpirySeconds - 1),
  };
  app = server();
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.close();
});
function server() {
  return buildServer({
    logger: false,
    auth: { database: db, env, now: () => now },
    checkin: { catalog: assets },
  });
}
async function player() {
  const [p] = await db.db
    .insert(users)
    .values({ displayName: "Synthetic flyer player", createdAt: now })
    .returning();
  const identity = { platform: "discord" as const, platformUserId: randomUUID() };
  await db.db.insert(identities).values({ userId: p!.id, ...identity });
  const session = await createSessions(secret, () => now).issue({ ...p!, identity });
  return { ...p!, headers: { authorization: `Bearer ${session.token}` } };
}
type Player = Awaited<ReturnType<typeof player>>;
async function seedPrices(
  count = Object.keys(assets).length,
  source: "xstocks" | "fluxion_pool" = "xstocks",
  buckets = 10,
) {
  const rows = Array.from({ length: count }, (_, i) =>
    Array.from({ length: buckets }, (_, b) => ({
      ticker: `SYN${i}`,
      priceUsd: "100",
      source,
      takenAt: new Date(now.getTime() - 86400000 + (b === 9 ? 10 : b + 0.5) * 8640000),
    })),
  ).flat();
  if (rows.length) await db.db.insert(priceSnapshots).values(rows);
}
async function post(p: Player, path: string, payload: object = {}) {
  return app.inject({ method: "POST", url: `/api/flyer/${path}`, headers: p.headers, payload });
}
type Session = {
  id: string;
  course: FlyerCourse;
  startedAt: string;
  expiresAt: string;
  maxTicks: number;
};
async function start(p: Player) {
  const response = await post(p, "start");
  expect(response.statusCode).toBe(200);
  return response.json<Session>();
}
async function finish(p: Player, s: Session, goal = 5) {
  const run = syntheticFlight(s.course, goal, s.maxTicks);
  now = new Date(Date.parse(s.startedAt) + Math.round((run.ticks * 1000) / 60));
  const body = { sessionId: s.id, ticks: run.ticks, score: run.score, inputs: run.inputs };
  return { run, body, response: await post(p, "finish", body) };
}
async function awards(p: Player) {
  return db.db
    .select()
    .from(pointsLedger)
    .where(and(eq(pointsLedger.userId, p.id), eq(pointsLedger.reason, "flyer_best")));
}
async function actor(role: "owner" | "admin" | "moderator" | "support") {
  const p = await player(),
    token = Buffer.from(randomUUID()).toString("base64url").slice(0, 43);
  await db.db.insert(staff).values({ userId: p.id, role, grantedBy: p.id });
  await db.db.insert(adminSessions).values({
    userId: p.id,
    tokenHash: digest(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 43200000),
  });
  return {
    id: p.id,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      origin,
      "x-admin-csrf": hmac(secret, `admin-csrf:${token}`),
    },
  };
}

it.each([3, 30])(
  "builds a %i-asset frozen course from primary samples only, independent of retention",
  async (count) => {
    assets = catalog(count);
    await app.close();
    app = server();
    await seedPrices(count);
    await seedPrices(count, "fluxion_pool");
    const p = await player(),
      s = await start(p);
    expect(s.course.segments).toHaveLength(count);
    expect(s.course.segments.every((a) => a.prices.every((n) => n === "100"))).toBe(true);
    await db.db.delete(priceSnapshots);
    const completed = await finish(p, s);
    expect(completed.response.statusCode).toBe(200);
    expect(completed.response.json().score).toBe(completed.run.score);
    await expect(
      db.db
        .update(flyerSessions)
        .set({ course: syntheticFlyerCourse() })
        .where(eq(flyerSessions.id, s.id)),
    ).rejects.toThrow();
  },
);
it("skips incomplete assets, cannot build from pools alone and consumes no session on missing data", async () => {
  const p = await player();
  await seedPrices(3, "fluxion_pool");
  expect((await post(p, "start")).json().error.code).toBe("FLYER_UNAVAILABLE");
  await seedPrices(3, "xstocks", 9);
  expect((await post(p, "start")).statusCode).toBe(503);
  await seedPrices(1);
  const s = await start(p);
  expect(s.course.segments.map((a) => a.ticker)).toEqual(["SYN0"]);
  expect(
    await db.db.select().from(flyerSessions).where(eq(flyerSessions.userId, p.id)),
  ).toHaveLength(1);
});
async function seedWindow(ticker: string, end: Date, missingFirstBucket = false) {
  await db.db.insert(priceSnapshots).values(
    Array.from({ length: 10 }, (_, bucket) => ({
      ticker,
      source: "xstocks" as const,
      priceUsd: "100",
      takenAt: new Date(end.getTime() - 86400000 + (bucket === 9 ? 10 : bucket + 0.5) * 8640000),
    })).slice(missingFirstBucket ? 1 : 0),
  );
}
it.each([
  { name: "weekend", at: "2026-10-25T23:00:00Z", last: "2026-10-23T21:00:00Z" },
  { name: "holiday", at: "2026-12-25T23:00:00Z", last: "2026-12-24T21:00:00Z" },
])(
  "keeps $name courses available from each ticker's latest primary window",
  async ({ at, last }) => {
    now = new Date(at);
    const first = new Date(last),
      second = new Date(first.getTime() - 3600000);
    await seedWindow("SYN0", first);
    await seedWindow("SYN1", second);
    await seedWindow("SYN2", first, true);
    await db.db.insert(priceSnapshots).values([
      { ticker: "SYN0", source: "fluxion_pool", priceUsd: "999", takenAt: now },
      {
        ticker: "SYN1",
        source: "xstocks",
        priceUsd: "888",
        takenAt: new Date(now.getTime() + 60000),
      },
    ]);
    await retainPriceSnapshots(db, now);
    const p = await player(),
      s = await start(p);
    expect(s.course.segments.map((s) => s.ticker).sort()).toEqual(["SYN0", "SYN1"]);
    for (const segment of s.course.segments) {
      expect(segment.prices).toEqual(Array(10).fill("100"));
      expect(segment.lastSession).toBe(true);
      expect(segment.windowEndsAt).toBe((segment.ticker === "SYN0" ? first : second).toISOString());
    }
    await db.db.delete(priceSnapshots);
    expect((await finish(p, s)).response.statusCode).toBe(200);
  },
);
it("keeps intraday sampling and normalization unchanged and labels only windows older than 120 seconds", async () => {
  const ends = [now, new Date(now.getTime() - 120000), new Date(now.getTime() - 120001)];
  for (const [i, end] of ends.entries()) await seedWindow(`SYN${i}`, end);
  // Exercise the existing first/last choice within each bucket with real price variation.
  await db.db.insert(priceSnapshots).values([
    {
      ticker: "SYN0",
      source: "xstocks",
      priceUsd: "90",
      takenAt: new Date(now.getTime() - 86400000 + 1000),
    },
    { ticker: "SYN0", source: "xstocks", priceUsd: "110", takenAt: now },
  ]);
  // Avoid a tied timestamp for the last bucket in this fixture.
  await db.db
    .delete(priceSnapshots)
    .where(
      and(
        eq(priceSnapshots.ticker, "SYN0"),
        eq(priceSnapshots.priceUsd, "100"),
        eq(priceSnapshots.takenAt, now),
      ),
    );
  const s = await start(await player());
  expect(s.course.segments.find((s) => s.ticker === "SYN0")).toMatchObject({
    prices: ["90", ...Array(8).fill("100"), "110"],
    centers: [380, ...Array(8).fill(240), 100],
    lastSession: false,
    windowEndsAt: now.toISOString(),
  });
  expect(s.course.segments.find((s) => s.ticker === "SYN1")!.lastSession).toBe(false);
  expect(s.course.segments.find((s) => s.ticker === "SYN2")!.lastSession).toBe(true);
});
it("serializes start and accepts exactly one finish; no client-provided score is trusted", async () => {
  await seedPrices();
  const p = await player();
  const results = await Promise.all([post(p, "start"), post(p, "start")]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const s = results.find((r) => r.statusCode === 200)!.json<Session>(),
    run = syntheticFlight(s.course);
  now = new Date(Date.parse(s.startedAt) + Math.round((run.ticks * 1000) / 60));
  expect(
    (
      await post(p, "finish", {
        sessionId: s.id,
        inputs: run.inputs,
        ticks: run.ticks,
        score: run.score + 10,
      })
    ).json().error.code,
  ).toBe("FLYER_INVALID_REPLAY");
  const responses = await Promise.all([
    post(p, "finish", { sessionId: s.id, ticks: run.ticks, inputs: run.inputs, score: run.score }),
    post(p, "finish", { sessionId: s.id, ticks: run.ticks, inputs: run.inputs, score: run.score }),
  ]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(await awards(p)).toHaveLength(1);
});
it("rolls back the completed flight if its ledger insert fails, allowing a safe retry", async () => {
  await seedPrices();
  const p = await player(),
    s = await start(p),
    run = syntheticFlight(s.course);
  now = new Date(Date.parse(s.startedAt) + Math.round((run.ticks * 1000) / 60));
  const payload = { sessionId: s.id, ticks: run.ticks, score: run.score, inputs: run.inputs };
  await db.db.execute(
    sql`CREATE FUNCTION reject_synthetic_flyer_award() RETURNS trigger AS $$ BEGIN IF NEW.reason='flyer_best' THEN RAISE EXCEPTION 'Synthetic write failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
  );
  await db.db.execute(
    sql`CREATE TRIGGER synthetic_flyer_failure BEFORE INSERT ON points_ledger FOR EACH ROW EXECUTE FUNCTION reject_synthetic_flyer_award()`,
  );
  try {
    expect((await post(p, "finish", payload)).statusCode).toBe(500);
    expect(await awards(p)).toEqual([]);
    expect(
      await db.db.select().from(flyerSessions).where(eq(flyerSessions.id, s.id)),
    ).toMatchObject([{ state: "active", score: null }]);
  } finally {
    await db.db.execute(sql`DROP TRIGGER synthetic_flyer_failure ON points_ledger`);
    await db.db.execute(sql`DROP FUNCTION reject_synthetic_flyer_award()`);
  }
  expect((await post(p, "finish", payload)).statusCode).toBe(200);
  expect(await awards(p)).toHaveLength(1);
});
it("prevents attaching a manual referral after starting a Flyer session", async () => {
  await seedPrices();
  const inviter = await player(),
    invitee = await player();
  const code = await db.db.transaction((tx) => ensureInviteCode(tx, inviter.id));
  await start(invitee);
  const response = await app.inject({
    method: "POST",
    url: "/api/referral/claim",
    headers: invitee.headers,
    payload: { code },
  });
  expect(response.json().error.code).toBe("INVITE_INELIGIBLE");
});
it.each(["time", "order", "overlap", "late", "premature"])(
  "rejects %s-inconsistent replay without awarding or finishing",
  async (kind) => {
    await seedPrices();
    const p = await player(),
      s = await start(p),
      run = syntheticFlight(s.course);
    let inputs: FlyerInput[] = [...run.inputs],
      ticks = run.ticks;
    now = new Date(Date.parse(s.startedAt) + Math.round((run.ticks * 1000) / 60));
    if (kind === "time") now = new Date(now.getTime() + 30000);
    if (kind === "order")
      inputs = [
        { tick: 2, action: "press" },
        { tick: 1, action: "release" },
      ];
    if (kind === "overlap")
      inputs = [
        { tick: 1, action: "press" },
        { tick: 1, action: "release" },
      ];
    if (kind === "late")
      inputs = [...inputs, { tick: run.ticks, action: inputs.length % 2 ? "release" : "press" }];
    if (kind === "premature") ticks--;
    const response = await post(p, "finish", { sessionId: s.id, inputs, ticks, score: run.score });
    expect(response.statusCode).toBe(422);
    expect(await awards(p)).toEqual([]);
    expect(
      await db.db.select().from(flyerSessions).where(eq(flyerSessions.id, s.id)),
    ).toMatchObject([{ state: "active", score: null }]);
  },
);
it("validates config privately, expires sessions, rejects foreign ownership and permits explicit discard", async () => {
  const p = await player();
  delete env.FLYER_MAX_SESSION_SECONDS;
  const view = await app.inject({ url: "/api/flyer", headers: p.headers });
  expect(view.json()).toMatchObject({ available: false, canStart: false });
  expect((await post(p, "start")).statusCode).toBe(503);
  env.FLYER_MAX_SESSION_SECONDS = String(GAME_CONFIG.flyer.sessionExpirySeconds - 1);
  await seedPrices();
  const s = await start(p),
    other = await player();
  expect((await post(other, "cancel", { sessionId: s.id })).statusCode).toBe(404);
  now = new Date(Date.parse(s.expiresAt));
  const run = syntheticFlight(s.course);
  expect(
    (
      await post(p, "finish", {
        sessionId: s.id,
        ticks: run.ticks,
        score: run.score,
        inputs: run.inputs,
      })
    ).json().error.code,
  ).toBe("FLYER_EXPIRED");
  expect((await post(p, "cancel", { sessionId: s.id })).statusCode).toBe(200);
  expect((await post(p, "cancel", { sessionId: s.id })).json().error.code).toBe("FLYER_REUSED");
  expect((await post(p, "start")).statusCode).toBe(200);
});
it("awards only daily best deltas up to 50 points and allows ranking play after the points cap", async () => {
  await seedPrices();
  const p = await player();
  let paid = 0,
    best = 0;
  for (const goal of [7, 3, 60, 70]) {
    const s = await start(p),
      f = await finish(p, s, goal);
    expect(f.response.statusCode).toBe(200);
    best = Math.max(best, f.run.score);
    const total = Math.min(50, best);
    expect(f.response.json().pointsAwarded).toBe(total - paid);
    paid = total;
  }
  expect((await awards(p)).reduce((n, a) => n + a.amount, 0)).toBe(50);
  expect((await app.inject({ url: "/api/flyer", headers: p.headers })).json()).toMatchObject({
    best,
    pointsToday: 50,
    canStart: true,
  });
});
it("counts finishes by server UTC day, not start day, and resets its private daily limit", async () => {
  now = new Date("2026-10-25T23:59:59Z");
  env.FLYER_MAX_FINISHES_PER_DAY = "1";
  await seedPrices();
  const p = await player(),
    s = await start(p),
    f = await finish(p, s, 0);
  expect(f.response.statusCode).toBe(200);
  expect(f.response.json().day).toBe("2026-10-26");
  expect((await post(p, "start")).json().error.code).toBe("FLYER_LIMIT");
  const [stored] = await db.db.select().from(flyerSessions).where(eq(flyerSessions.id, s.id));
  expect(stored!.day).toBe("2026-10-26");
});
it("pauses start/finish without consuming a session or points, but keeps read and cancellation available", async () => {
  await seedPrices();
  const p = await player();
  await db.db.update(gameControls).set({ paused: true }).where(eq(gameControls.game, "flyer"));
  expect((await post(p, "start")).json().error.code).toBe("GAME_PAUSED");
  expect(await db.db.select().from(flyerSessions).where(eq(flyerSessions.userId, p.id))).toEqual(
    [],
  );
  await db.db.update(gameControls).set({ paused: false }).where(eq(gameControls.game, "flyer"));
  const s = await start(p);
  await db.db.update(gameControls).set({ paused: true }).where(eq(gameControls.game, "flyer"));
  expect((await finish(p, s)).response.json().error.code).toBe("GAME_PAUSED");
  expect(await awards(p)).toEqual([]);
  expect((await app.inject({ url: "/api/flyer", headers: p.headers })).json().maintenance).toBe(
    true,
  );
  expect((await post(p, "cancel", { sessionId: s.id })).statusCode).toBe(200);
});
it("counts Flyer points toward referral qualification and the main ledger leaderboard", async () => {
  await seedPrices();
  const inviter = await player(),
    invitee = await player(),
    code = await db.db.transaction((tx) => ensureInviteCode(tx, inviter.id));
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/referral/claim",
        headers: invitee.headers,
        payload: { code },
      })
    ).statusCode,
  ).toBe(200);
  await db.db.insert(pointsLedger).values({
    userId: invitee.id,
    amount: 150,
    reason: "quiz",
    refId: "synthetic:before-flyer",
    createdAt: now,
  });
  const s = await start(invitee),
    f = await finish(invitee, s, 60);
  expect(f.response.statusCode).toBe(200);
  expect(
    await db.db
      .select()
      .from(pointsLedger)
      .where(and(eq(pointsLedger.userId, inviter.id), eq(pointsLedger.reason, "referral"))),
  ).toMatchObject([{ amount: 50 }]);
  const ranked = await app.inject({
    url: "/api/leaderboard?period=day&platform=all",
    headers: invitee.headers,
  });
  expect(ranked.json().caller.score).toBe(200);
});
it("survives API restart before finish using frozen course/version and captured input", async () => {
  await seedPrices();
  const p = await player(),
    s = await start(p);
  await app.close();
  app = server();
  await db.db.delete(priceSnapshots);
  const f = await finish(p, s);
  expect(f.response.statusCode).toBe(200);
  expect((await post(p, "finish", f.body)).json().error.code).toBe("FLYER_REUSED");
});
it.each(["owner", "admin", "moderator", "support"] as const)(
  "supports %s session review with permission-gated audited void and point correction",
  async (role) => {
    await seedPrices();
    const p = await player(),
      s = await start(p),
      f = await finish(p, s, 8);
    expect(f.response.statusCode).toBe(200);
    const a = await actor(role);
    const read = await app.inject({ url: `/api/admin/flyer?userId=${p.id}`, headers: a.headers });
    expect(read.statusCode).toBe(200);
    expect(read.json().entries[0]).toMatchObject({ id: s.id, state: "finished" });
    const voidIt = (reason = "Synthetic correction") =>
      app.inject({
        method: "POST",
        url: "/api/admin/flyer/void",
        headers: a.headers,
        payload: { id: s.id, reason },
      });
    if (role === "moderator" || role === "support") {
      expect((await voidIt()).statusCode).toBe(403);
      return;
    }
    expect((await voidIt("")).statusCode).toBe(400);
    expect((await voidIt()).statusCode).toBe(200);
    expect((await voidIt()).statusCode).toBe(200);
    expect(
      await db.db
        .select()
        .from(pointsLedger)
        .where(and(eq(pointsLedger.userId, p.id), eq(pointsLedger.reason, "admin_adjustment"))),
    ).toMatchObject([{ amount: -f.run.score }]);
    expect(
      await db.db
        .select()
        .from(adminActions)
        .where(and(eq(adminActions.adminId, a.id), eq(adminActions.action, "flyer.voided"))),
    ).toHaveLength(1);
    expect((await app.inject({ url: "/api/flyer", headers: p.headers })).json()).toMatchObject({
      best: 0,
      pointsToday: 0,
    });
    const again = await finish(p, await start(p), 4);
    expect(again.response.json().pointsAwarded).toBe(again.run.score);
  },
);
it("voiding an earlier best preserves another valid capped score and does not over-correct", async () => {
  await seedPrices();
  const p = await player(),
    first = await start(p);
  await finish(p, first, 60);
  await finish(p, await start(p), 70);
  const a = await actor("owner");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/admin/flyer/void",
        headers: a.headers,
        payload: { id: first.id, reason: "Synthetic earlier score" },
      })
    ).statusCode,
  ).toBe(200);
  expect((await app.inject({ url: "/api/flyer", headers: p.headers })).json().pointsToday).toBe(50);
  expect(
    await db.db
      .select()
      .from(pointsLedger)
      .where(and(eq(pointsLedger.userId, p.id), eq(pointsLedger.reason, "admin_adjustment"))),
  ).toEqual([]);
});
it("ranks best individual flights by UTC period/season with first attainment breaking ties", async () => {
  const a = await player(),
    b = await player(),
    course = syntheticFlyerCourse();
  for (const [p, score, at] of [
    [a, 5, "2026-10-25T10:00:00Z"],
    [b, 5, "2026-10-25T11:00:00Z"],
    [a, 99, "2026-10-24T10:00:00Z"],
  ] as const)
    await db.db.insert(flyerSessions).values({
      userId: p.id,
      startedAt: new Date(Date.parse(at) - 10000),
      expiresAt: new Date(Date.parse(at) + 600000),
      maxTicks: 36000,
      course,
      state: "finished",
      finishedAt: new Date(at),
      day: at.slice(0, 10),
      score,
      ticks: 600,
      inputs: [],
    });
  const day = await app.inject({ url: "/api/flyer/leaderboard?period=day", headers: a.headers });
  expect(day.statusCode).toBe(200);
  const rows = day.json().entries as { userId: string; score: number; rank: number }[];
  expect(rows.find((r) => r.userId === a.id)!.rank).toBeLessThan(
    rows.find((r) => r.userId === b.id)!.rank,
  );
  expect(day.json().caller.score).toBe(5);
  for (const period of ["week", "season"]) {
    expect(
      (
        await app.inject({ url: `/api/flyer/leaderboard?period=${period}`, headers: a.headers })
      ).json().caller.score,
    ).toBe(99);
  }
  expect(
    (await app.inject({ url: "/api/flyer/leaderboard?period=bad", headers: a.headers })).statusCode,
  ).toBe(400);
});
