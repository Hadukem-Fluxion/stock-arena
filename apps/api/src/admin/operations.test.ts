import { randomUUID } from "node:crypto";
import {
  adminActions,
  adminSessions,
  createLocalDatabase,
  flagNotes,
  flags,
  hlPredictions,
  hlRuns,
  identities,
  pointsLedger,
  quizDailySets,
  quizQuestions,
  staff,
  users,
} from "@stock-arena/db";
import { ASSETS } from "@stock-arena/game-core";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { createSessions } from "../auth/session.js";
import { createQuizStore } from "../quiz.js";
import { settlePredictions } from "../../../worker/src/predictions.js";
import { allowed, ROLES } from "./permissions.js";
import type { Permission, Role } from "./permissions.js";
import { digest, hmac, SESSION_COOKIE } from "./security.js";

const connection = createLocalDatabase(),
  now = new Date("2026-10-22T12:00:00Z");
const secret = "synthetic-admin-operations-session-secret-only",
  origin = "https://arena.example";
let app: FastifyInstance;
let serial = 0;
beforeAll(async () => {
  await connection.migrate();
}, 30000);
beforeEach(async () => {
  app = buildServer({
    logger: false,
    auth: {
      database: connection,
      now: () => now,
      env: { SESSION_SECRET: secret, ADMIN_WEB_ORIGIN: origin },
    },
  });
  await connection.db.delete(quizDailySets);
  await connection.db.delete(quizQuestions);
});
afterAll(async () => {
  await connection.close();
});
async function actor(role: Role = "owner") {
  const [user] = await connection.db
    .insert(users)
    .values({ displayName: `Synthetic operator ${++serial}` })
    .returning();
  await connection.db.insert(staff).values({ userId: user!.id, role, grantedBy: user!.id });
  const token = Buffer.from(randomUUID()).toString("base64url").slice(0, 43);
  await connection.db.insert(adminSessions).values({
    tokenHash: digest(token),
    userId: user!.id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 43200000),
  });
  return {
    user: user!,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      origin,
      "x-admin-csrf": hmac(secret, `admin-csrf:${token}`),
    },
  };
}
async function player() {
  const [user] = await connection.db
    .insert(users)
    .values({ displayName: `Synthetic player ${++serial}`, createdAt: now })
    .returning();
  const platformUserId = String(900000 + serial);
  await connection.db
    .insert(identities)
    .values({ userId: user!.id, platform: "telegram", platformUserId });
  const session = await createSessions(secret, () => now).issue({
    ...user!,
    identity: { platform: "telegram", platformUserId },
  });
  return { ...user!, platformUserId, headers: { authorization: `Bearer ${session.token}` } };
}
const invented = () => ({
  slug: `synthetic-${++serial}`,
  topic: "Invented topic",
  prompt: "Synthetic test marker?",
  options: ["Marker A", "Marker B", "Marker C", "Marker D"],
  answerIndex: 2,
  explanation: "Invented explanation.",
});
async function post(headers: Record<string, string>, path: string, body: unknown) {
  return app.inject({
    method: "POST",
    url: `/api/admin/${path}`,
    headers: { ...headers, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
}
async function save(headers: Record<string, string>) {
  const values = invented();
  const result = await post(
    { ...headers, "content-type": "application/json" },
    "quiz/save",
    values,
  );
  expect(result.statusCode).toBe(200);
  const [row] = await connection.db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.slug, values.slug));
  return row!;
}
async function audits(userId: string, action?: string) {
  return connection.db
    .select()
    .from(adminActions)
    .where(
      and(eq(adminActions.adminId, userId), action ? eq(adminActions.action, action) : undefined),
    );
}
const routes: [string, string, Permission][] = [
  ["GET", "quiz", "quiz:read"],
  ["POST", "quiz/save", "quiz:write"],
  ["POST", "quiz/deactivate", "quiz:write"],
  ["POST", "quiz/schedule", "quiz:write"],
  ["POST", "quiz/import", "quiz:write"],
  ["GET", "players", "players:read"],
  ["GET", "players/00000000-0000-4000-8000-000000000000", "players:read"],
  ["POST", "players/00000000-0000-4000-8000-000000000000/status", "players:write"],
  ["POST", "players/00000000-0000-4000-8000-000000000000/adjust", "points:write"],
  ["GET", "flags", "flags:read"],
  ["POST", "flags", "flags:write"],
  ["GET", "flags/00000000-0000-4000-8000-000000000000", "flags:read"],
  ["POST", "flags/00000000-0000-4000-8000-000000000000/note", "flags:write"],
  ["POST", "flags/00000000-0000-4000-8000-000000000000/resolve", "flags:resolve"],
];
describe("T29 explicit permissions", () => {
  it.each(ROLES)("checks every operations route for %s", async (role) => {
    const user = await actor(role);
    for (const [method, path, permission] of routes) {
      const result =
        method === "POST"
          ? await post(user.headers, path, {})
          : await app.inject({ url: `/api/admin/${path}`, headers: user.headers });
      if (allowed(role, permission)) expect([200, 400, 404], path).toContain(result.statusCode);
      else expect(result.statusCode, path).toBe(403);
    }
    await app.close();
  });
  it("rechecks a revocation after the route auth hook and rolls back the write", async () => {
    const user = await actor();
    app.addHook("preHandler", async (req) => {
      if (req.url === "/api/admin/quiz/save")
        await connection.db
          .update(staff)
          .set({ revokedAt: now })
          .where(eq(staff.userId, user.user.id));
    });
    const result = await post(user.headers, "quiz/save", invented());
    expect(result.statusCode).toBe(403);
    expect(await connection.db.select().from(quizQuestions)).toHaveLength(0);
    expect(await audits(user.user.id)).toHaveLength(0);
    await app.close();
  });
});
describe("T29 quiz bank", () => {
  it("adds, searches, edits, schedules and deactivates with one audit per write", async () => {
    const a = await actor();
    const row = await save(a.headers);
    const body = {
      id: row.id,
      slug: row.slug,
      topic: row.topic,
      prompt: "Edited invented marker",
      options: row.options,
      answerIndex: 0,
      explanation: row.explanation,
    };
    expect((await post(a.headers, "quiz/save", body)).statusCode).toBe(200);
    expect(
      (await post(a.headers, "quiz/schedule", { id: row.id, day: "2026-10-23" })).statusCode,
    ).toBe(200);
    let list = await app.inject({ url: "/api/admin/quiz?search=Edited", headers: a.headers });
    expect(list.json().entries).toMatchObject([
      { answerIndex: 0, scheduledDay: "2026-10-23", frozenToday: false },
    ]);
    expect((await post(a.headers, "quiz/deactivate", { id: row.id })).statusCode).toBe(200);
    list = await app.inject({ url: "/api/admin/quiz", headers: a.headers });
    expect(list.json().entries[0].active).toBe(false);
    expect((await audits(a.user.id)).map((r) => r.action).sort()).toEqual([
      "quiz.created",
      "quiz.deactivated",
      "quiz.edited",
      "quiz.scheduled",
    ]);
    expect(JSON.stringify(await audits(a.user.id))).not.toContain("Marker A");
    expect((await post(a.headers, "quiz/save", { ...invented(), slug: row.slug })).statusCode).toBe(
      409,
    );
    expect(
      (await post(a.headers, "quiz/schedule", { id: row.id, day: "2026-02-30" })).statusCode,
    ).toBe(400);
    await app.close();
  });
  it("imports idempotently and rejects the entire import/edit/schedule for today's frozen questions", async () => {
    const a = await actor();
    const rows = Array.from({ length: 3 }, () => {
      const q = invented();
      return {
        id: q.slug,
        topic: q.topic,
        prompt: q.prompt,
        options: q.options,
        answer_index: q.answerIndex,
        explanation: q.explanation,
      };
    });
    for (let i = 0; i < 2; i++)
      expect((await post(a.headers, "quiz/import", rows)).json()).toEqual({ ok: true, count: 3 });
    expect(await connection.db.select().from(quizQuestions)).toHaveLength(3);
    const p = await player();
    await createQuizStore(connection, secret, () => now)(p.id, { type: "start" });
    const [row] = await connection.db.select().from(quizQuestions);
    const set = await connection.db.select().from(quizDailySets);
    expect(
      (await post(a.headers, "quiz/save", { ...invented(), id: row!.id, slug: row!.slug })).json(),
    ).toEqual({ error: { code: "QUIZ_FROZEN" } });
    expect((await post(a.headers, "quiz/schedule", { id: row!.id, day: null })).statusCode).toBe(
      409,
    );
    expect(
      (
        await post(a.headers, "quiz/import", [
          ...rows,
          { ...rows[0], id: "synthetic-new-after-freeze" },
        ])
      ).statusCode,
    ).toBe(409);
    expect(await connection.db.select().from(quizQuestions)).toHaveLength(3);
    expect((await post(a.headers, "quiz/deactivate", { id: row!.id })).statusCode).toBe(200);
    expect(await connection.db.select().from(quizDailySets)).toEqual(set);
    expect((await audits(a.user.id)).map((r) => r.action)).toEqual([
      "quiz.imported",
      "quiz.imported",
      "quiz.deactivated",
    ]);
    const view = await app.inject({ url: "/api/quiz", headers: p.headers });
    expect(view.statusCode).toBe(200);
    expect(view.body).not.toMatch(/answerIndex|answer_index|explanation/);
    await app.close();
  });
  it("serializes a concurrent first quiz selection and bank edit", async () => {
    const a = await actor(),
      p = await player();
    const rows = await Promise.all([save(a.headers), save(a.headers), save(a.headers)]);
    const row = rows[0]!;
    const [start, edit] = await Promise.all([
      createQuizStore(connection, secret, () => now)(p.id, { type: "start" }),
      post(a.headers, "quiz/save", {
        id: row.id,
        slug: row.slug,
        topic: row.topic,
        prompt: "Concurrent invented marker",
        options: row.options,
        answerIndex: 1,
        explanation: row.explanation,
      }),
    ]);
    expect(start.status).toBe("question");
    expect([200, 409]).toContain(edit.statusCode);
    const [set] = await connection.db.select().from(quizDailySets);
    const frozen = set!.questions.find((q) => q.id === row.id)!;
    expect(frozen.answerIndex).toBe(edit.statusCode === 200 ? 1 : row.answerIndex);
    expect((await post(a.headers, "quiz/import", [{ id: "bad" }])).statusCode).toBe(400);
    await app.close();
  });
});
describe("T29 player operations and immutable point adjustments", () => {
  it("finds names/IDs and shows identities, age, pending eligibility and activity", async () => {
    const a = await actor("support"),
      p = await player();
    for (const search of [p.displayName, p.platformUserId]) {
      const result = await app.inject({
        url: `/api/admin/players?${new URLSearchParams({ search })}`,
        headers: a.headers,
      });
      expect(result.json().entries.some((r: { id: string }) => r.id === p.id)).toBe(true);
    }
    const detail = await app.inject({ url: `/api/admin/players/${p.id}`, headers: a.headers });
    expect(detail.json()).toMatchObject({
      accountAgeDays: 0,
      balance: "0",
      eligibility: { accountActive: true, verification: "pending" },
      identities: [{ platformUserId: p.platformUserId }],
    });
    for (const key of ["ledger", "runs", "attempts", "checkins"])
      expect(detail.json()[key]).toMatchObject({ entries: [], hasMore: false });
    await app.close();
  });
  it("adds positive and negative corrections once on duplicate retries with required reason and atomic audit", async () => {
    const a = await actor("admin"),
      p = await player();
    const input = { requestId: randomUUID(), amount: 12, reason: "Synthetic correction" };
    const path = `players/${p.id}/adjust`;
    const results = await Promise.all([post(a.headers, path, input), post(a.headers, path, input)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await post(a.headers, path, { ...input, amount: 13 })).statusCode).toBe(409);
    expect(
      (await post(a.headers, path, { ...input, requestId: randomUUID(), amount: -4 })).statusCode,
    ).toBe(200);
    for (const amount of [0, 1.2, 2147483648])
      expect((await post(a.headers, path, { ...input, amount })).statusCode).toBe(400);
    expect((await post(a.headers, path, { ...input, reason: " " })).statusCode).toBe(400);
    const ledger = await connection.db
      .select()
      .from(pointsLedger)
      .where(eq(pointsLedger.userId, p.id));
    expect(ledger.map((r) => r.amount)).toEqual([12, -4]);
    expect(await audits(a.user.id, "points.adjusted")).toHaveLength(2);
    await expect(connection.db.execute("UPDATE points_ledger SET amount = 0")).rejects.toThrow();
    await app.close();
  });
  it("suspends/bans/restores with reasons and blocks both player actions and pending worker awards", async () => {
    const a = await actor(),
      p = await player();
    const [run] = await connection.db
      .insert(hlRuns)
      .values({
        userId: p.id,
        day: "2026-10-22",
        runNumber: 1,
        model: "prediction",
        createdAt: now,
      })
      .returning();
    await connection.db.insert(hlPredictions).values({
      runId: run!.id,
      position: 0,
      ticker: "AAPL",
      referenceTicker: "AAPL",
      asset: ASSETS.AAPL,
      offeredAt: now,
      lockedAt: now,
      direction: "up",
      state: "waiting_start",
    });
    expect(
      (
        await post(a.headers, `players/${p.id}/status`, {
          status: "suspended",
          reason: "Synthetic review",
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: "/api/checkin", headers: p.headers })).statusCode).toBe(403);
    await settlePredictions(connection, now);
    const [round] = await connection.db
      .select()
      .from(hlPredictions)
      .where(eq(hlPredictions.runId, run!.id));
    expect(round!.state).toBe("void");
    expect(
      await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, p.id)),
    ).toHaveLength(0);
    expect(
      (
        await post(a.headers, `players/${p.id}/status`, {
          status: "banned",
          reason: "Synthetic ban",
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: "/api/checkin", headers: p.headers })).statusCode).toBe(403);
    expect(
      (
        await post(a.headers, `players/${p.id}/status`, {
          status: "active",
          reason: "Synthetic restore",
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: "/api/checkin", headers: p.headers })).statusCode).toBe(200);
    expect(await audits(a.user.id, "player.status_changed")).toHaveLength(3);
    await app.close();
  });
  it("protects the last active owner and revokes inactive staff sessions", async () => {
    await connection.db.delete(staff);
    const owner = await actor(),
      admin = await actor("admin");
    const denied = await post(admin.headers, `players/${owner.user.id}/status`, {
      status: "banned",
      reason: "Synthetic reason",
    });
    expect(denied.json()).toEqual({ error: { code: "LAST_OWNER" } });
    expect(
      (
        await post(owner.headers, `players/${admin.user.id}/status`, {
          status: "suspended",
          reason: "Synthetic reason",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/admin/session", headers: admin.headers })).statusCode,
    ).toBe(401);
    await app.close();
  });
});
describe("T29 flags", () => {
  it("leaves a flag open and adds no audit when its account action is rejected", async () => {
    await connection.db.delete(staff);
    const owner = await actor(),
      admin = await actor("admin");
    expect(
      (
        await post(admin.headers, "flags", {
          userId: owner.user.id,
          note: "Synthetic last-owner report",
        })
      ).statusCode,
    ).toBe(200);
    const [flag] = await connection.db.select().from(flags).where(eq(flags.userId, owner.user.id));
    const result = await post(admin.headers, `flags/${flag!.id}/resolve`, {
      action: "ban",
      reason: "Synthetic rejected action",
    });
    expect(result.json()).toEqual({ error: { code: "LAST_OWNER" } });
    const [saved] = await connection.db.select().from(flags).where(eq(flags.id, flag!.id));
    expect(saved!.state).toBe("open");
    expect((await audits(admin.user.id)).map((entry) => entry.action)).toEqual(["flag.raised"]);
    await app.close();
  });
  it("lets moderators raise/note, support read, and only operations staff clear", async () => {
    const mod = await actor("moderator"),
      support = await actor("support"),
      admin = await actor("admin"),
      p = await player();
    expect(
      (await post(mod.headers, "flags", { userId: p.id, note: "Synthetic report" })).statusCode,
    ).toBe(200);
    const [flag] = await connection.db.select().from(flags).where(eq(flags.userId, p.id));
    expect(
      (await post(mod.headers, `flags/${flag!.id}/note`, { note: "Synthetic follow-up" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await post(support.headers, `flags/${flag!.id}/note`, { note: "Not allowed" })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: `/api/admin/flags/${flag!.id}`, headers: support.headers })).json()
        .notes.entries,
    ).toHaveLength(1);
    expect(
      (
        await post(mod.headers, `flags/${flag!.id}/resolve`, {
          action: "clear",
          reason: "Reviewed",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(admin.headers, `flags/${flag!.id}/resolve`, {
          action: "clear",
          reason: "Reviewed",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await post(admin.headers, `flags/${flag!.id}/resolve`, { action: "clear", reason: "Again" }))
        .statusCode,
    ).toBe(409);
    expect((await audits(mod.user.id)).map((r) => r.action)).toEqual(["flag.raised", "flag.noted"]);
    expect(await audits(admin.user.id, "flag.resolved")).toHaveLength(1);
    for (const command of [
      "UPDATE flag_notes SET note = 'tampered'",
      "DELETE FROM flag_notes",
      "TRUNCATE flag_notes",
    ])
      await expect(connection.db.execute(command)).rejects.toThrow();
    expect(
      await connection.db.select().from(flagNotes).where(eq(flagNotes.flagId, flag!.id)),
    ).toHaveLength(1);
    await app.close();
  });
  it.each(["suspend", "ban", "adjust"] as const)(
    "commits %s and its flag outcome/audits together",
    async (action) => {
      const a = await actor("admin"),
        p = await player();
      await post(a.headers, "flags", { userId: p.id, note: "Invented report" });
      const [flag] = await connection.db.select().from(flags).where(eq(flags.userId, p.id));
      const input = {
        action,
        reason: "Synthetic action",
        ...(action === "adjust" ? { amount: -5, requestId: randomUUID() } : {}),
      };
      expect((await post(a.headers, `flags/${flag!.id}/resolve`, input)).statusCode).toBe(200);
      const [updated] = await connection.db.select().from(flags).where(eq(flags.id, flag!.id));
      expect(updated!.state).toBe("actioned");
      expect((await audits(a.user.id)).map((r) => r.action)).toEqual([
        "flag.raised",
        action === "adjust" ? "points.adjusted" : "player.status_changed",
        "flag.resolved",
      ]);
      await app.close();
    },
  );
});
