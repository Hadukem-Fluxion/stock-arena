import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAddress } from "viem/utils";
import {
  adminActions,
  adminSessions,
  createLocalDatabase,
  identities,
  pointsLedger,
  rewardDestinationHistory,
  rewardDestinations,
  rewardEntries,
  rewardEvents,
  rewardLocks,
  rewardSnapshots,
  seasons,
  staff,
  users,
} from "@stock-arena/db";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { createSessions } from "../auth/session.js";
import { digest, hmac, SESSION_COOKIE } from "./security.js";
import { ROLES } from "./permissions.js";
import type { Role } from "./permissions.js";
import { csvCell } from "./rewards.js";
const db = createLocalDatabase(),
  secret = "synthetic-reward-test-secret-not-a-credential",
  origin = "https://arena.example";
let app: FastifyInstance,
  now: Date,
  season: string,
  start: Date,
  end: Date,
  sequence = 0;
beforeAll(async () => {
  await db.migrate();
}, 30000);
beforeEach(async () => {
  now = new Date("2026-10-23T12:00:00Z");
  start = new Date(Date.UTC(2024, 0, 1 + sequence++ * 2));
  end = new Date(start.getTime() + 86400000);
  season = `synthetic-${sequence}`;
  await db.db
    .insert(seasons)
    .values({ id: season, name: "Synthetic season", startsAt: start, endsAt: end });
  await db.db.update(rewardLocks).set({ locked: false });
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
  const [u] = await db.db
    .insert(users)
    .values({ displayName: `Synthetic ${role}` })
    .returning();
  await db.db.insert(staff).values({ userId: u!.id, role, grantedBy: u!.id });
  const token = Buffer.from(randomUUID()).toString("base64url").slice(0, 43);
  await db.db.insert(adminSessions).values({
    tokenHash: digest(token),
    userId: u!.id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 43200000),
  });
  return {
    id: u!.id,
    token,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      origin,
      "x-admin-csrf": hmac(secret, `admin-csrf:${token}`),
    },
  };
}
async function player(name = "Synthetic player", platform: "discord" | "telegram" = "discord") {
  const [u] = await db.db.insert(users).values({ displayName: name }).returning();
  const identity = {
    platform,
    platformUserId: String(BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 14)}`)),
  };
  await db.db.insert(identities).values({ userId: u!.id, ...identity });
  const session = await createSessions(secret, () => now).issue({ ...u!, identity });
  return { ...u!, identity, headers: { authorization: `Bearer ${session.token}` } };
}
const profileBody = {
  bybitUid: "01234567",
  mantleAddress: "",
  confirmed: true as const,
  expectedChangedAt: null as string | null,
};
const post = (headers: Record<string, string>, path: string, body: unknown) =>
  app.inject({
    method: "POST",
    url: path.startsWith("/api/") ? path : `/api/admin/rewards/${path}`,
    headers: { ...headers, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
const get = (headers: Record<string, string>, path: string) => app.inject({ url: path, headers });
async function award(id: string, amount: number, at = new Date(start.getTime() + 1000)) {
  await db.db
    .insert(pointsLedger)
    .values({ userId: id, amount, reason: "synthetic", refId: randomUUID(), createdAt: at });
}
async function prepare(headers: Record<string, string>, topN = 3) {
  expect(
    (
      await post(headers, "prizes", {
        seasonId: season,
        rankFrom: 1,
        rankTo: topN,
        description: "Synthetic campaign prize",
        reason: "Synthetic prize setup",
      })
    ).statusCode,
  ).toBe(200);
}
const view = (headers: Record<string, string>) =>
  get(headers, `/api/admin/rewards/season?seasonId=${season}`);
describe("T31 reward registration", () => {
  it("validates UID, address/checksum, explicit confirmation and rejects unknown fields", async () => {
    const p = await player(),
      path = "/api/rewards/destination";
    for (const body of [
      { ...profileBody, bybitUid: "1234" },
      { ...profileBody, bybitUid: "1".repeat(13) },
      { ...profileBody, bybitUid: "uid12345" },
      { ...profileBody, mantleAddress: "0x123" },
      { ...profileBody, confirmed: false },
      { ...profileBody, userId: randomUUID() },
    ])
      expect((await post(p.headers, path, body)).statusCode).toBe(400);
    const address = getAddress("0x5aeda56215b167893e80b4fe645ba6d5bab767de");
    const index = [...address].findIndex((c, i) => i > 1 && /[a-fA-F]/.test(c));
    const wrong =
      address.slice(0, index) +
      (address[index] === address[index]!.toUpperCase()
        ? address[index]!.toLowerCase()
        : address[index]!.toUpperCase()) +
      address.slice(index + 1);
    expect((await post(p.headers, path, { ...profileBody, mantleAddress: wrong })).statusCode).toBe(
      400,
    );
    expect(
      (await post(p.headers, path, { ...profileBody, mantleAddress: address })).statusCode,
    ).toBe(200);
    expect((await get(p.headers, path)).json()).toMatchObject({
      bybitUid: "01234567",
      mantleAddress: address,
      locked: false,
    });
    const [row] = await db.db
      .select()
      .from(rewardDestinationHistory)
      .where(eq(rewardDestinationHistory.userId, p.id));
    expect(row).toMatchObject({
      actor: "player",
      oldValues: { bybitUid: "", mantleAddress: "" },
      newValues: { bybitUid: "••••4567", mantleAddress: `••••${address.slice(-4)}` },
    });
    expect(JSON.stringify(row)).not.toContain(address);
  });
  it("allows either or both fields empty, prevents stale edits and does not duplicate an unchanged save", async () => {
    const p = await player(),
      path = "/api/rewards/destination";
    expect((await post(p.headers, path, { ...profileBody, bybitUid: "" })).statusCode).toBe(200);
    const first = (await get(p.headers, path)).json();
    expect(
      (await post(p.headers, path, { ...profileBody, expectedChangedAt: first.changedAt }))
        .statusCode,
    ).toBe(200);
    const second = (await get(p.headers, path)).json();
    expect(second.changedAt).not.toBe(first.changedAt);
    expect(
      (
        await post(p.headers, path, {
          ...profileBody,
          bybitUid: "99999",
          expectedChangedAt: first.changedAt,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await post(p.headers, path, { ...profileBody, expectedChangedAt: second.changedAt }))
        .statusCode,
    ).toBe(200);
    expect((await get(p.headers, path)).json().history).toHaveLength(2);
  });
  it("only exposes the player's own values and history", async () => {
    const a = await player(),
      b = await player();
    await post(a.headers, "/api/rewards/destination", profileBody);
    expect((await get(b.headers, "/api/rewards/destination")).json()).toMatchObject({
      bybitUid: "",
      history: [],
    });
    expect((await get(b.headers, `/api/rewards/destination?userId=${a.id}`)).statusCode).toBe(400);
    expect((await get({}, "/api/rewards/destination")).statusCode).toBe(401);
  });
  it("serializes locks with edits and keeps all destinations locked until every season is unlocked", async () => {
    const a = await actor(),
      p = await player();
    const lock = async (id: string, locked: boolean) =>
      post(a.headers, "lock", { seasonId: id, locked, reason: "Synthetic review" });
    expect((await lock(season, true)).statusCode).toBe(200);
    await lock("season-1", true);
    expect((await post(p.headers, "/api/rewards/destination", profileBody)).json().error.code).toBe(
      "REWARDS_LOCKED",
    );
    expect((await get(p.headers, "/api/rewards/destination")).json().locked).toBe(true);
    await lock(season, false);
    expect((await post(p.headers, "/api/rewards/destination", profileBody)).statusCode).toBe(409);
    await lock("season-1", false);
    expect((await post(p.headers, "/api/rewards/destination", profileBody)).statusCode).toBe(200);
  });
  it("masks moderator/support responses and audits staff corrections without raw destination values", async () => {
    const p = await player("Synthetic private recipient"),
      a = await actor();
    await post(p.headers, "/api/rewards/destination", profileBody);
    for (const role of ["support", "moderator"] as const) {
      const viewer = await actor(role);
      const res = await get(
        viewer.headers,
        "/api/admin/rewards/destinations?search=Synthetic%20private%20recipient",
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().entries[0].bybitUid).toBe("••••4567");
      expect(res.body).not.toContain("01234567");
    }
    const current = (await get(p.headers, "/api/rewards/destination")).json();
    expect(
      (
        await post(a.headers, `destinations/${p.id}`, {
          ...profileBody,
          bybitUid: "98765432",
          expectedChangedAt: current.changedAt,
          reason: "Player requested correction",
        })
      ).statusCode,
    ).toBe(200);
    const h = (await get(p.headers, "/api/rewards/destination")).json().history;
    expect(h[0]).toMatchObject({ actor: "staff", newValues: { bybitUid: "••••5432" } });
    const logs = await db.db.select().from(adminActions).where(eq(adminActions.targetUserId, p.id));
    expect(logs.some((l) => l.action === "reward.destination_changed")).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("98765432");
  });
});
describe("T31 season rewards", () => {
  it.each(ROLES)("enforces all read/write/export routes for %s", async (role) => {
    const a = await actor(role);
    for (const path of [
      "/api/admin/rewards",
      `/api/admin/rewards/season?seasonId=${season}`,
      "/api/admin/rewards/destinations",
      `/api/admin/rewards/destinations/${a.id}`,
    ])
      expect((await get(a.headers, path)).statusCode).toBe(200);
    for (const path of ["prizes", "freeze", "status", "lock", "export", `destinations/${a.id}`])
      expect((await post(a.headers, path, {})).statusCode).toBe(
        role === "owner" || role === "admin" ? 400 : 403,
      );
  });
  it("requires CSRF and rechecks revoked sessions for mutations/exports", async () => {
    const a = await actor();
    expect(
      (
        await post({ cookie: a.headers.cookie }, "lock", {
          seasonId: season,
          locked: true,
          reason: "Test",
        })
      ).statusCode,
    ).toBe(403);
    await db.db
      .update(adminSessions)
      .set({ revokedAt: now })
      .where(eq(adminSessions.tokenHash, digest(a.token)));
    expect((await post(a.headers, "export", { seasonId: season })).statusCode).toBe(401);
  });
  it.each([false, true])(
    "freezing locks destinations and audits the previous lock=%s",
    async (locked) => {
      const a = await actor(),
        p = await player();
      await award(p.id, 10);
      await post(p.headers, "/api/rewards/destination", profileBody);
      await prepare(a.headers, 1);
      await db.db.insert(rewardLocks).values({ seasonId: season, locked, updatedAt: now });
      expect(
        (await post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "Freeze and lock" }))
          .statusCode,
      ).toBe(200);
      expect((await view(a.headers)).json().locked).toBe(true);
      expect(
        (
          await post(p.headers, "/api/rewards/destination", {
            ...profileBody,
            bybitUid: "98765432",
          })
        ).json().error.code,
      ).toBe("REWARDS_LOCKED");
      const logs = await db.db.select().from(adminActions).where(eq(adminActions.targetId, season));
      expect(logs.filter((row) => row.action === "reward.destinations_locked")).toMatchObject([
        {
          adminId: a.id,
          details: { before: locked, after: true, source: "snapshot", reason: "Freeze and lock" },
        },
      ]);
    },
  );
  it("freezes and locks even an empty ranking", async () => {
    const a = await actor();
    await prepare(a.headers, 1);
    expect(
      (await post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "Empty season" }))
        .statusCode,
    ).toBe(200);
    expect((await view(a.headers)).json()).toMatchObject({ locked: true, entries: [] });
  });
  it("rolls the snapshot, recipients and lock back if lock auditing fails", async () => {
    const a = await actor(),
      p = await player();
    await award(p.id, 10);
    await prepare(a.headers, 1);
    await db.db.execute(
      sql.raw(
        `CREATE FUNCTION reject_synthetic_lock_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'reward.destinations_locked' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`,
      ),
    );
    await db.db.execute(
      sql.raw(
        `CREATE TRIGGER reject_synthetic_lock_audit BEFORE INSERT ON admin_actions FOR EACH ROW EXECUTE FUNCTION reject_synthetic_lock_audit()`,
      ),
    );
    try {
      expect(
        (await post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "Atomic test" }))
          .statusCode,
      ).toBe(500);
      expect((await view(a.headers)).json()).toMatchObject({
        locked: false,
        snapshot: null,
        entries: [],
      });
    } finally {
      await db.db.execute(sql.raw("DROP TRIGGER reject_synthetic_lock_audit ON admin_actions"));
      await db.db.execute(sql.raw("DROP FUNCTION reject_synthetic_lock_audit()"));
    }
  });
  it.each([-1000, 0, 1000, null])(
    "CSV flags destination changes strictly after snapshot: offset=%s",
    async (offset) => {
      const a = await actor(),
        p = await player();
      await award(p.id, 10);
      await prepare(a.headers, 1);
      if (offset !== null)
        await db.db.insert(rewardDestinations).values({
          userId: p.id,
          bybitUid: "01234567",
          mantleAddress: "",
          changedAt: new Date(now.getTime() + offset),
        });
      await post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "Export boundary" });
      const csv = await post(a.headers, "export", { seasonId: season });
      expect(csv.statusCode).toBe(200);
      const [header, row] = csv.body
        .trim()
        .split("\r\n")
        .map((line) => line.split(","));
      const index = header!.indexOf('"changed_after_snapshot"');
      expect(index).toBeGreaterThan(-1);
      expect(row![index]).toBe(offset !== null && offset > 0 ? '"true"' : '"false"');
    },
  );
  it("concurrent freezes generate only one snapshot and one initial event per recipient", async () => {
    const a = await actor(),
      p = await player();
    await award(p.id, 20);
    await prepare(a.headers, 1);
    const results = await Promise.all([
      post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "First freeze" }),
      post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "Concurrent freeze" }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const rows = (await view(a.headers)).json().entries;
    expect(rows).toHaveLength(1);
    expect(
      await db.db.select().from(rewardEvents).where(eq(rewardEvents.entryId, rows[0].id)),
    ).toHaveLength(1);
  });
  it("freezes top N using season boundaries and tie rules; later ledger/name/identity/date changes do not rewrite it", async () => {
    const a = await actor(),
      p = await player('=Synthetic,"recipient"\nname'),
      q = await player("Synthetic second", "telegram"),
      r = await player("Synthetic third");
    await award(p.id, 30);
    await award(q.id, 30, new Date(start.getTime() + 2000));
    await award(r.id, 10);
    await award(r.id, 999, new Date(start.getTime() - 1));
    await award(r.id, 999, end);
    await db.db
      .insert(identities)
      .values({ userId: p.id, platform: "telegram", platformUserId: "123456789" });
    await prepare(a.headers, 2);
    expect(
      (await post(a.headers, "freeze", { seasonId: season, topN: 2, reason: "Freeze review" }))
        .statusCode,
    ).toBe(200);
    const before = (await view(a.headers)).json();
    expect(before.entries).toHaveLength(2);
    expect(before.entries.map((e: { points: number }) => e.points)).toEqual([30, 30]);
    expect(before.entries[0]).toMatchObject({
      userId: p.id,
      rank: 1,
      eligibility: "review_required",
    });
    expect(before.entries[0].identities).toHaveLength(2);
    await db.db.update(users).set({ displayName: "Changed later" }).where(eq(users.id, p.id));
    await award(r.id, 1000);
    await db.db
      .update(seasons)
      .set({ endsAt: new Date(end.getTime() + 1000) })
      .where(eq(seasons.id, season));
    expect((await view(a.headers)).json().entries).toEqual(before.entries);
    expect(
      (await post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "Retry" })).json().error
        .code,
    ).toBe("REWARDS_FROZEN");
    expect(
      (
        await post(a.headers, "prizes", {
          seasonId: season,
          rankFrom: 3,
          rankTo: 3,
          description: "Late",
          reason: "Retry",
        })
      ).statusCode,
    ).toBe(409);
  });
  it("rejects an ongoing season, prize overlaps, missing coverage and invalid ranks", async () => {
    const a = await actor();
    expect(
      (await post(a.headers, "freeze", { seasonId: "season-1", topN: 1, reason: "Test" })).json()
        .error.code,
    ).toBe("SEASON_NOT_ENDED");
    expect(
      (await post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "Test" })).json().error
        .code,
    ).toBe("PRIZE_MISSING");
    await prepare(a.headers, 2);
    expect(
      (
        await post(a.headers, "prizes", {
          seasonId: season,
          rankFrom: 2,
          rankTo: 4,
          description: "Overlap",
          reason: "Test",
        })
      ).json().error.code,
    ).toBe("PRIZE_OVERLAP");
    expect(
      (await post(a.headers, "freeze", { seasonId: season, topN: 0, reason: "Test" })).statusCode,
    ).toBe(400);
  });
  it("appends status transitions once, requires notes, rejects stale/terminal edits and leaves ledger unchanged", async () => {
    const a = await actor("admin"),
      p = await player();
    await award(p.id, 30);
    await prepare(a.headers, 1);
    await post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "Freeze" });
    const [entry] = await db.db
      .select()
      .from(rewardEntries)
      .where(eq(rewardEntries.seasonId, season));
    const body = {
      entryId: entry!.id,
      version: 0,
      status: "approved",
      note: "Eligibility manually reviewed",
    };
    expect((await post(a.headers, "status", { ...body, note: " " })).statusCode).toBe(400);
    const results = await Promise.all([
      post(a.headers, "status", body),
      post(a.headers, "status", body),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      (
        await post(a.headers, "status", {
          ...body,
          version: 1,
          status: "delivered",
          note: "Manual delivery reference",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await post(a.headers, "status", { ...body, version: 2, status: "void", note: "Too late" }))
        .statusCode,
    ).toBe(409);
    const events = await db.db
      .select()
      .from(rewardEvents)
      .where(eq(rewardEvents.entryId, entry!.id));
    expect(events).toHaveLength(3);
    expect(
      await db.db.select().from(pointsLedger).where(eq(pointsLedger.userId, p.id)),
    ).toHaveLength(1);
    const logs = await db.db.select().from(adminActions).where(eq(adminActions.targetUserId, p.id));
    expect(logs.filter((l) => l.action === "reward.status_changed")).toHaveLength(2);
  });
  it("can void pending/approved rewards with a note; inactive players cannot be approved", async () => {
    const a = await actor(),
      p = await player();
    await award(p.id, 5);
    await prepare(a.headers, 1);
    await post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "Freeze" });
    const row = (await view(a.headers)).json().entries[0];
    await db.db.update(users).set({ status: "banned" }).where(eq(users.id, p.id));
    expect(
      (
        await post(a.headers, "status", {
          entryId: row.id,
          version: 0,
          status: "approved",
          note: "Review",
        })
      ).json().error.code,
    ).toBe("PLAYER_INACTIVE");
    expect(
      (
        await post(a.headers, "status", {
          entryId: row.id,
          version: 0,
          status: "void",
          note: "Ineligible recipient",
        })
      ).statusCode,
    ).toBe(200);
  });
  it("exports only frozen recipients with current destinations and records actor/row count; escapes CSV formulas", async () => {
    const a = await actor(),
      p = await player('=Synthetic,"recipient"\nname'),
      q = await player();
    await award(p.id, 10);
    await award(q.id, 1);
    await post(p.headers, "/api/rewards/destination", profileBody);
    await prepare(a.headers, 1);
    await post(a.headers, "freeze", { seasonId: season, topN: 1, reason: "Freeze" });
    const csv = await post(a.headers, "export", { seasonId: season });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain('"\'=Synthetic,""recipient""\nname"');
    expect(csv.body).toContain('"01234567"');
    expect(csv.body).toContain(p.identity.platformUserId);
    expect(csv.body).not.toContain(q.identity.platformUserId);
    expect(csv.body).toContain("review_required");
    const logs = await db.db.select().from(adminActions).where(eq(adminActions.targetId, season));
    expect(logs.find((l) => l.action === "reward.exported")).toMatchObject({
      adminId: a.id,
      details: { rowCount: 1 },
    });
    expect(csvCell(" @test")).toBe('"\' @test"');
    expect(csvCell('line\n"quoted"')).toBe('"line\n""quoted"""');
  });
  it("protects snapshot/history/event/prize rows, ledger and audit from UPDATE/DELETE/TRUNCATE", async () => {
    for (const table of [
      "reward_snapshots",
      "reward_entries",
      "reward_events",
      "reward_prizes",
      "reward_destination_history",
      "points_ledger",
      "admin_actions",
    ]) {
      for (const statement of [`DELETE FROM ${table} WHERE false`, `TRUNCATE ${table} CASCADE`]) {
        await expect(db.db.execute(sql.raw(statement))).rejects.toThrow();
      }
    }
    await expect(
      db.db.update(rewardSnapshots).set({ topN: 1 }).where(eq(rewardSnapshots.seasonId, season)),
    ).rejects.toThrow();
    await expect(db.db.update(rewardEvents).set({ note: "Tamper" })).rejects.toThrow();
    expect(
      await db.db.select().from(rewardSnapshots).where(eq(rewardSnapshots.seasonId, season)),
    ).toHaveLength(0);
  });
});
