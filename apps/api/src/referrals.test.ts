import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { ASSETS, GAME_CONFIG } from "@stock-arena/game-core";
import type { QuizView } from "@stock-arena/game-core";
import {
  adminActions,
  adminSessions,
  createLocalDatabase,
  gameControls,
  hlPredictions,
  hlRuns,
  identities,
  pointsLedger,
  priceSnapshots,
  quizQuestions,
  referrals,
  rewardReferral,
  staff,
  users,
} from "@stock-arena/db";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";
import { createSessions } from "./auth/session.js";
import { ensureInviteCode } from "./referrals.js";
import { digest, hmac, SESSION_COOKIE } from "./admin/security.js";
import { settlePredictions } from "../../worker/src/predictions.js";

const db = createLocalDatabase(),
  secret = "synthetic-referral-session-secret-for-tests-only";
const origin = "https://arena.example",
  botToken = "synthetic-referral-bot-not-a-real-token";
const instant = new Date("2026-10-25T12:00:00Z");
let now = instant,
  app: FastifyInstance,
  serial = 400000;
beforeAll(async () => {
  await db.migrate();
}, 30000);
beforeEach(async () => {
  now = instant;
  await db.db.update(gameControls).set({ paused: false });
  app = buildServer({
    logger: false,
    auth: {
      database: db,
      now: () => now,
      env: {
        SESSION_SECRET: secret,
        TELEGRAM_BOT_TOKEN: botToken,
        TELEGRAM_BOT_USERNAME: "SyntheticArenaBot",
        DISCORD_CLIENT_ID: "111111111111111111",
        DISCORD_CLIENT_SECRET: "synthetic-oauth-secret",
        ADMIN_WEB_ORIGIN: origin,
      },
      fetch: vi.fn<typeof fetch>(async (url) =>
        Response.json(
          String(url).endsWith("/token")
            ? { access_token: "synthetic-oauth-access", token_type: "Bearer" }
            : { id: String(++serial), username: "Synthetic Discord player" },
        ),
      ),
    },
  });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db.close();
});
async function player(createdAt = now) {
  const [user] = await db.db
    .insert(users)
    .values({ displayName: "Synthetic invite player", createdAt })
    .returning();
  const identity = { platform: "discord" as const, platformUserId: String(++serial) };
  await db.db.insert(identities).values({ userId: user!.id, ...identity });
  const session = await createSessions(secret, () => now).issue({ ...user!, identity });
  return { ...user!, headers: { authorization: `Bearer ${session.token}` } };
}
async function code(userId: string) {
  return db.db.transaction((tx) => ensureInviteCode(tx, userId));
}
async function claim(invitee: Awaited<ReturnType<typeof player>>, value: string) {
  return app.inject({
    method: "POST",
    url: "/api/referral/claim",
    headers: invitee.headers,
    payload: { code: value },
  });
}
async function pair() {
  const inviter = await player(),
    invitee = await player(),
    value = await code(inviter.id);
  expect((await claim(invitee, value)).statusCode).toBe(200);
  return { inviter, invitee, code: value };
}
async function points(userId: string, amount: number, reason = "quiz") {
  await db.db
    .insert(pointsLedger)
    .values({ userId, amount, reason, refId: `synthetic:${randomUUID()}`, createdAt: now });
}
async function retry(userId: string) {
  await db.db.transaction(async (tx) => {
    await tx.select().from(users).where(eq(users.id, userId)).for("update");
    await rewardReferral(tx, userId, now);
  });
}
async function awards(userId: string) {
  return db.db
    .select()
    .from(pointsLedger)
    .where(and(eq(pointsLedger.userId, userId), eq(pointsLedger.reason, "referral")));
}
async function checkin(p: Awaited<ReturnType<typeof player>>) {
  return app.inject({ method: "POST", url: "/api/checkin", headers: p.headers, payload: {} });
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
function signedStart(code: string, id = ++serial) {
  const fields = {
    auth_date: String(now.getTime() / 1000),
    start_param: code,
    user: JSON.stringify({ id, first_name: "Synthetic Telegram" }),
  };
  const text = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(botToken).digest();
  return new URLSearchParams({
    ...fields,
    hash: createHmac("sha256", key).update(text).digest("hex"),
  }).toString();
}

it("creates fixed nonsequential per-user codes and platform links without exposing invitee identities", async () => {
  const a = await player(),
    b = await player();
  const read = () => app.inject({ url: "/api/referral", headers: a.headers });
  const [first, second] = await Promise.all([read(), read()]);
  expect(first.json().code).toMatch(/^ref_[A-Za-z0-9_-]{24}$/);
  expect(second.json().code).toBe(first.json().code);
  expect(await code(b.id)).not.toBe(first.json().code);
  expect(first.json()).toEqual({
    code: first.json().code,
    joined: 0,
    points: 0,
    claim: null,
    maintenance: false,
    telegramUrl: `https://t.me/SyntheticArenaBot?startapp=${first.json().code}`,
    discordUrl: `https://discord.com/activities/111111111111111111?custom_id=${first.json().code}`,
  });
  expect(first.headers["cache-control"]).toBe("no-store");
  expect((await app.inject({ url: "/api/referral" })).statusCode).toBe(401);
});
it("accepts a signed Telegram start parameter; tampering cannot create a claim", async () => {
  const inviter = await player(),
    value = await code(inviter.id),
    input = signedStart(value);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/telegram",
    payload: { initData: input },
  });
  expect(res.statusCode).toBe(200);
  const id = res.json().session.user.id;
  expect(await db.db.select().from(referrals).where(eq(referrals.inviteeId, id))).toMatchObject([
    { inviterId: inviter.id, platform: "telegram", status: "pending" },
  ]);
  const bad = await app.inject({
    method: "POST",
    url: "/api/auth/telegram",
    payload: { initData: signedStart(value).replace(value, "ref_aaaaaaaaaaaaaaaaaaaaaaaa") },
  });
  expect(bad.statusCode).toBe(401);
  // Re-login cannot attach an inviter to an existing account.
  const old = signedStart("unrelated-launch", ++serial);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/telegram",
    payload: { initData: old },
  });
  const sameId = JSON.parse(new URLSearchParams(old).get("user")!).id as number;
  await app.inject({
    method: "POST",
    url: "/api/auth/telegram",
    payload: { initData: signedStart(value, sameId) },
  });
  expect(
    await db.db
      .select()
      .from(referrals)
      .where(eq(referrals.inviteeId, login.json().session.user.id)),
  ).toEqual([]);
});
it("claims Discord launch customId only for a new authenticated identity", async () => {
  const inviter = await player(),
    value = await code(inviter.id);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/discord",
    payload: { code: "synthetic-code", customId: value },
  });
  expect(res.statusCode).toBe(200);
  expect(
    await db.db.select().from(referrals).where(eq(referrals.inviteeId, res.json().session.user.id)),
  ).toMatchObject([{ inviterId: inviter.id, platform: "discord" }]);
});
it("rejects invalid and self codes; inviter assignment cannot be changed even after void", async () => {
  const { inviter, invitee, code: value } = await pair();
  expect((await claim(inviter, value)).json().error.code).toBe("INVITE_INVALID");
  expect((await claim(await player(), "ref_aaaaaaaaaaaaaaaaaaaaaaaa")).json().error.code).toBe(
    "INVITE_INVALID",
  );
  expect((await claim(invitee, await code((await player()).id))).json().error.code).toBe(
    "INVITE_CLAIMED",
  );
  expect((await claim(await player(), "bad")).statusCode).toBe(400);
  await expect(
    db.db
      .update(referrals)
      .set({ inviterId: (await player()).id })
      .where(eq(referrals.inviteeId, invitee.id)),
  ).rejects.toThrow();
  await expect(
    db.db.delete(referrals).where(eq(referrals.inviteeId, invitee.id)),
  ).rejects.toThrow();
  await expect(db.db.execute(sql`TRUNCATE referrals`)).rejects.toThrow();
});
it.each(["checkin", "quiz", "run", "ledger"])(
  "rejects manual claim after prior %s activity",
  async (activity) => {
    const inviter = await player(),
      invitee = await player();
    if (activity === "checkin") await checkin(invitee);
    if (activity === "quiz")
      await app
        .inject({ method: "POST", url: "/api/quiz/start", headers: invitee.headers, payload: {} })
        .then(async () => {
          // Store a synthetic prior attempt when the bank is not configured yet.
          await db.db.execute(
            sql`INSERT INTO quiz_attempts (user_id,day,question_ids,answers,started_at) VALUES (${invitee.id},'2026-10-24','{}','{}','{}') ON CONFLICT DO NOTHING`,
          );
        });
    if (activity === "run")
      await db.db.insert(hlRuns).values({ userId: invitee.id, day: "2026-10-25", runNumber: 1 });
    if (activity === "ledger") await points(invitee.id, 10, "admin_adjustment");
    expect((await claim(invitee, await code(inviter.id))).json().error.code).toBe(
      "INVITE_INELIGIBLE",
    );
  },
);
it("enforces the 24-hour manual cutoff and serializes competing claims", async () => {
  const inviter = await player(),
    value = await code(inviter.id);
  expect(
    (await claim(await player(new Date(now.getTime() - 86400000)), value)).json().error.code,
  ).toBe("INVITE_INELIGIBLE");
  expect((await claim(await player(new Date(now.getTime() - 86399999)), value)).statusCode).toBe(
    200,
  );
  const invitee = await player();
  const results = await Promise.all([claim(invitee, value), claim(invitee, value)]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
});
it("pays invitee once on first check-in and inviter only at 200 gameplay points, excluding referral and admin points", async () => {
  const { inviter, invitee } = await pair();
  await points(invitee.id, 179);
  await points(invitee.id, 500, "admin_adjustment");
  expect((await checkin(invitee)).statusCode).toBe(201);
  expect(await awards(invitee.id)).toMatchObject([{ amount: 20, refId: `ref:${invitee.id}` }]);
  expect(await awards(inviter.id)).toEqual([]); // 189 game points, despite a larger balance.
  await points(invitee.id, 10, "higher_lower");
  await retry(invitee.id);
  expect(await awards(inviter.id)).toEqual([]); // 199 is below the milestone.
  await points(invitee.id, 1);
  await Promise.all([retry(invitee.id), retry(invitee.id)]);
  expect(await awards(inviter.id)).toMatchObject([{ amount: 50, refId: `ref:${invitee.id}` }]);
  expect(await awards(inviter.id)).toHaveLength(1);
  expect(await awards(invitee.id)).toHaveLength(1);
  const view = await app.inject({ url: "/api/referral", headers: inviter.headers });
  expect(view.json()).toMatchObject({ joined: 1, points: 50 });
  expect((await app.inject({ url: "/api/referral", headers: invitee.headers })).json().points).toBe(
    0,
  );
});
it("grants the welcome bonus even when the milestone was reached before the first check-in", async () => {
  const { inviter, invitee } = await pair();
  await points(invitee.id, 200);
  await retry(invitee.id);
  expect(await awards(inviter.id)).toHaveLength(1);
  expect(await awards(invitee.id)).toEqual([]);
  expect((await checkin(invitee)).statusCode).toBe(201);
  expect(await awards(invitee.id)).toMatchObject([{ amount: 20 }]);
});
it("retries a paused invite without blocking check-in or consuming a claim; halted inviter cannot earn", async () => {
  const { inviter, invitee, code: value } = await pair();
  await db.db.update(gameControls).set({ paused: true }).where(eq(gameControls.game, "invite"));
  expect((await claim(await player(), value)).json().error.code).toBe("GAME_PAUSED");
  await points(invitee.id, 200);
  expect((await checkin(invitee)).statusCode).toBe(201);
  expect(await awards(invitee.id)).toEqual([]);
  expect(await awards(inviter.id)).toEqual([]);
  await db.db.update(gameControls).set({ paused: false }).where(eq(gameControls.game, "invite"));
  await db.db.update(users).set({ status: "suspended" }).where(eq(users.id, inviter.id));
  await retry(invitee.id);
  expect(await awards(inviter.id)).toEqual([]);
  await db.db.update(users).set({ status: "active" }).where(eq(users.id, inviter.id));
  await retry(invitee.id);
  expect(await awards(inviter.id)).toHaveLength(1);
  expect(await awards(invitee.id)).toHaveLength(1);
});
it("serializes the daily inviter cap; capped qualification survives UTC rollover", async () => {
  const { inviter, invitee, code: value } = await pair();
  // Existing qualifications fill all but one of the public product quota slots.
  const past = await db.db
    .insert(users)
    .values(
      Array.from({ length: GAME_CONFIG.referrals.maxRewardsPerDay - 1 }, () => ({
        displayName: "Synthetic prior qualification",
        createdAt: now,
      })),
    )
    .returning();
  await db.db.insert(referrals).values(
    past.map((p) => ({
      inviterId: inviter.id,
      inviteeId: p.id,
      code: value,
      status: "rewarded" as const,
      qualifiedAt: now,
    })),
  );
  const another = await player();
  expect((await claim(another, value)).statusCode).toBe(200);
  await points(invitee.id, 200);
  await points(another.id, 200);
  await Promise.all([retry(invitee.id), retry(another.id)]);
  expect(await awards(inviter.id)).toHaveLength(1);
  const pending = await db.db
    .select()
    .from(referrals)
    .where(and(eq(referrals.inviterId, inviter.id), eq(referrals.status, "pending")));
  expect(pending).toHaveLength(1);
  now = new Date("2026-10-26T00:00:00Z");
  await retry(pending[0]!.inviteeId);
  expect(await awards(inviter.id)).toHaveLength(2);
});
it.each(["owner", "admin", "moderator", "support"] as const)(
  "enforces %s read/void permissions and audits reversals exactly once",
  async (role) => {
    const { inviter, invitee } = await pair(),
      a = await actor(role);
    await points(invitee.id, 190);
    await checkin(invitee);
    const listed = await app.inject({
      url: `/api/admin/referrals?inviter=${inviter.id}&invitee=${invitee.id}&status=rewarded`,
      headers: a.headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().entries).toHaveLength(1);
    const post = (reason = "Synthetic review") =>
      app.inject({
        method: "POST",
        url: "/api/admin/referrals/void",
        headers: a.headers,
        payload: { inviteeId: invitee.id, reason },
      });
    if (role === "moderator" || role === "support") {
      expect((await post()).statusCode).toBe(403);
      return;
    }
    expect((await post("")).statusCode).toBe(400);
    expect((await post()).statusCode).toBe(200);
    expect((await post()).statusCode).toBe(200);
    const corrections = await db.db
      .select()
      .from(pointsLedger)
      .where(
        and(
          eq(pointsLedger.reason, "admin_adjustment"),
          eq(pointsLedger.refId, `ref:${invitee.id}`),
        ),
      );
    expect(corrections.map((a) => a.amount).sort((a, b) => a - b)).toEqual([-50, -20]);
    expect(
      await db.db
        .select()
        .from(adminActions)
        .where(and(eq(adminActions.adminId, a.id), eq(adminActions.action, "referral.voided"))),
    ).toHaveLength(1);
    expect((await claim(invitee, await code((await player()).id))).json().error.code).toBe(
      "INVITE_CLAIMED",
    );
  },
);
it("voids a pending claim and reverses an already paid welcome bonus without inventing a fixed award", async () => {
  const { inviter, invitee } = await pair(),
    a = await actor("owner");
  await checkin(invitee);
  const result = await app.inject({
    method: "POST",
    url: "/api/admin/referrals/void",
    headers: a.headers,
    payload: { inviteeId: invitee.id, reason: "Synthetic pending reversal" },
  });
  expect(result.statusCode).toBe(200);
  expect(await awards(inviter.id)).toEqual([]);
  expect(
    await db.db
      .select()
      .from(pointsLedger)
      .where(
        and(
          eq(pointsLedger.reason, "admin_adjustment"),
          eq(pointsLedger.refId, `ref:${invitee.id}`),
        ),
      ),
  ).toMatchObject([{ amount: -20 }]);
  await points(invitee.id, 200);
  await retry(invitee.id);
  expect(await awards(inviter.id)).toEqual([]);
});
it("rolls back the void and both corrections if auditing fails", async () => {
  const { inviter, invitee } = await pair(),
    a = await actor("owner");
  await points(invitee.id, 190);
  await checkin(invitee);
  await db.db.execute(
    sql`CREATE FUNCTION fail_referral_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'referral.voided' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
  );
  await db.db.execute(
    sql`CREATE TRIGGER fail_referral_audit BEFORE INSERT ON admin_actions FOR EACH ROW EXECUTE FUNCTION fail_referral_audit()`,
  );
  try {
    const result = await app.inject({
      method: "POST",
      url: "/api/admin/referrals/void",
      headers: a.headers,
      payload: { inviteeId: invitee.id, reason: "Synthetic rollback test" },
    });
    expect(result.statusCode).toBe(500);
    expect(result.json()).toEqual({ error: { code: "INTERNAL_ERROR" } });
    expect(
      await db.db.select().from(referrals).where(eq(referrals.inviteeId, invitee.id)),
    ).toMatchObject([{ status: "rewarded" }]);
    expect(
      await db.db
        .select()
        .from(pointsLedger)
        .where(
          and(
            eq(pointsLedger.reason, "admin_adjustment"),
            eq(pointsLedger.refId, `ref:${invitee.id}`),
          ),
        ),
    ).toEqual([]);
    expect(await awards(inviter.id)).toHaveLength(1);
  } finally {
    await db.db.execute(sql`DROP TRIGGER fail_referral_audit ON admin_actions`);
    await db.db.execute(sql`DROP FUNCTION fail_referral_audit()`);
  }
});
it("a completed quiz can reach the milestone in the same award transaction", async () => {
  const { inviter, invitee } = await pair();
  await points(invitee.id, 125);
  await db.db.insert(quizQuestions).values(
    Array.from({ length: 3 }, (_, i) => ({
      slug: `synthetic-referral-${i}`,
      prompt: `Fictional test marker ${i}?`,
      topic: "synthetic",
      options: ["Synthetic correct", "Synthetic B", "Synthetic C", "Synthetic D"] as [
        string,
        string,
        string,
        string,
      ],
      answerIndex: 0,
      explanation: "Invented test content.",
    })),
  );
  let view = (
    await app.inject({
      method: "POST",
      url: "/api/quiz/start",
      headers: invitee.headers,
      payload: {},
    })
  ).json<QuizView>();
  for (let i = 0; i < 3; i++) {
    const q = view.question!;
    const res = await app.inject({
      method: "POST",
      url: "/api/quiz/answer",
      headers: invitee.headers,
      payload: {
        day: view.day,
        questionId: q.id,
        position: q.position,
        choice: q.options.indexOf("Synthetic correct"),
      },
    });
    expect(res.statusCode).toBe(200);
    if (i < 2)
      view = (
        await app.inject({
          method: "POST",
          url: "/api/quiz/next",
          headers: invitee.headers,
          payload: {},
        })
      ).json<QuizView>();
  }
  expect(await awards(inviter.id)).toMatchObject([{ amount: 50 }]);
});
it("worker settlement reaches the milestone and a repeated settlement cannot duplicate either award", async () => {
  const { inviter, invitee } = await pair();
  await points(invitee.id, 195);
  const start = new Date(now.getTime() - 900000),
    lock = new Date(start.getTime() - 15000);
  const [run] = await db.db
    .insert(hlRuns)
    .values({
      userId: invitee.id,
      day: "2026-10-25",
      runNumber: 1,
      model: "prediction",
      createdAt: lock,
    })
    .returning();
  await db.db.insert(hlPredictions).values({
    runId: run!.id,
    position: 0,
    ticker: "AAPL",
    referenceTicker: "AAPL",
    asset: ASSETS.AAPL,
    offeredAt: lock,
    lockedAt: lock,
    direction: "up",
    state: "pending",
    startPrice: "100",
    startTakenAt: start,
    targetAt: now,
  });
  await db.db
    .insert(priceSnapshots)
    .values({ ticker: "AAPL", source: "xstocks", priceUsd: "101", takenAt: now, tradable: true });
  await settlePredictions(db, now);
  await settlePredictions(db, now);
  expect(await awards(inviter.id)).toMatchObject([{ amount: 50 }]);
  expect(await awards(inviter.id)).toHaveLength(1);
});
