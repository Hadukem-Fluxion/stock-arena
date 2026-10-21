import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import {
  adminActions,
  adminControl,
  adminOauthStates,
  adminSessions,
  createLocalDatabase,
  identities,
  staff,
  users,
} from "@stock-arena/db";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import { createSessions } from "../auth/session.js";
import { allowed, PERMISSIONS, ROLES } from "./permissions.js";
import type { Role } from "./permissions.js";
import { digest, hmac, SESSION_COOKIE, STATE_COOKIE } from "./security.js";

const connection = createLocalDatabase();
const origin = "https://arena.example";
const secret = "fake-admin-session-secret-only-for-tests-48-bytes";
const instant = new Date("2026-10-21T12:00:00Z");
let time = instant;
let serial = 200000000000000000n;
let apps: FastifyInstance[] = [];
const baseEnv = {
  SESSION_SECRET: secret,
  ADMIN_WEB_ORIGIN: origin,
  DISCORD_CLIENT_ID: "fake-client",
  DISCORD_CLIENT_SECRET: "fake-client-secret",
};

beforeAll(async () => {
  await connection.migrate();
}, 30000);
afterAll(async () => {
  await connection.close();
});
beforeEach(async () => {
  await Promise.all(apps.map((app) => app.close()));
  apps = [];
  time = instant;
  await connection.db.delete(adminSessions);
  await connection.db.delete(adminOauthStates);
  await connection.db.delete(staff);
  await connection.db.update(adminControl).set({ bootstrappedAt: null });
});

function server(
  env: Record<string, string | undefined> = {},
  fetcher?: typeof fetch,
  logs?: string[],
) {
  const stream = new Writable({
    write(chunk, _encoding, done) {
      logs?.push(String(chunk));
      done();
    },
  });
  const app = buildServer({
    auth: {
      database: connection,
      env: { ...baseEnv, ...env },
      now: () => time,
      fetch:
        fetcher ??
        vi.fn<typeof fetch>().mockRejectedValue(new Error("No external requests in tests")),
    },
    logger: logs ? { stream } : false,
  });
  apps.push(app);
  return app;
}
async function member(role: Role = "owner", revoked = false) {
  const discordId = String(++serial);
  const [user] = await connection.db
    .insert(users)
    .values({ displayName: `Synthetic ${role} ${serial}` })
    .returning();
  if (!user) throw new Error("Missing test user");
  await connection.db
    .insert(identities)
    .values({ userId: user.id, platform: "discord", platformUserId: discordId });
  await connection.db
    .insert(staff)
    .values({ userId: user.id, role, grantedBy: user.id, revokedAt: revoked ? instant : null });
  const token = Buffer.from(randomUUID()).toString("base64url").slice(0, 43);
  await connection.db.insert(adminSessions).values({
    tokenHash: digest(token),
    userId: user.id,
    createdAt: instant,
    expiresAt: new Date(instant.getTime() + 43200000),
  });
  return {
    ...user,
    discordId,
    token,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      origin,
      "x-admin-csrf": hmac(secret, `admin-csrf:${token}`),
    },
  };
}
function discordFetch(id: string, name = "Synthetic owner") {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ access_token: "fake-oauth-access-token", token_type: "Bearer" }),
    )
    .mockResolvedValueOnce(Response.json({ id, username: name, global_name: name, avatar: null }));
}
async function login(app: FastifyInstance, extraQuery = "") {
  const start = await app.inject({ url: "/api/admin/auth/discord" });
  expect(start.statusCode).toBe(302);
  const url = new URL(String(start.headers.location));
  const cookies = start.cookies;
  const browser = cookies.find((cookie) => cookie.name === STATE_COOKIE)!.value;
  const state = url.searchParams.get("state")!;
  const callback = await app.inject({
    url: `/api/admin/auth/callback?code=fake-auth-code&state=${state}${extraQuery}`,
    headers: { cookie: `${STATE_COOKIE}=${browser}` },
  });
  return { start, url, callback, state, browser };
}

describe("admin OAuth and session security", () => {
  it("returns a typed provider failure for malformed Discord IDs", async () => {
    const app = server({}, discordFetch("not-a-snowflake"));
    const result = await login(app);
    expect(result.callback.statusCode).toBe(502);
    expect(result.callback.json()).toEqual({ error: { code: "PROVIDER_UNAVAILABLE" } });
  });
  it("keeps the player session separate and limits deprecated bearer access to admin operations", async () => {
    const user = await member();
    const app = server({ ADMIN_DISCORD_IDS: user.discordId });
    const player = await createSessions(secret, () => time).issue({
      id: user.id,
      displayName: user.displayName,
      avatarUrl: null,
      identity: { platform: "discord", platformUserId: user.discordId },
    });
    const headers = { authorization: `Bearer ${player.token}` };
    expect((await app.inject({ url: "/api/admin/session", headers })).json()).toMatchObject({
      legacy: true,
      user: { role: "admin" },
    });
    expect((await app.inject({ url: "/api/admin/team", headers })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/checkin", headers: user.headers })).statusCode).toBe(401);
  });
  it("persists admin access and revocation across API restarts", async () => {
    const user = await member("support");
    const first = server();
    expect(
      (await first.inject({ url: "/api/admin/session", headers: user.headers })).statusCode,
    ).toBe(200);
    await first.close();
    const second = server();
    expect(
      (await second.inject({ url: "/api/admin/session", headers: user.headers })).statusCode,
    ).toBe(200);
    await second.inject({ method: "POST", url: "/api/admin/logout", headers: user.headers });
    await second.close();
    expect(
      (await server().inject({ url: "/api/admin/session", headers: user.headers })).statusCode,
    ).toBe(401);
  });
  it("bootstraps only OWNER_DISCORD_ID, requests identify and uses the exact web redirect", async () => {
    const id = String(++serial);
    const fetcher = discordFetch(id);
    const app = server({ OWNER_DISCORD_ID: id }, fetcher);
    const { start, url, callback } = await login(app, "&iss=https%3A%2F%2Fdiscord.com");
    expect(url.origin).toBe("https://discord.com");
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/api/admin/auth/callback`);
    expect(start.cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/admin");
    const cookie = callback.cookies.find((entry) => entry.name === SESSION_COOKIE)!;
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: 43200,
      path: "/api/admin",
    });
    expect(new URLSearchParams(String(fetcher.mock.calls[0]![1]!.body)).get("redirect_uri")).toBe(
      `${origin}/api/admin/auth/callback`,
    );
    const session = await app.inject({
      url: "/api/admin/session",
      headers: { cookie: `${SESSION_COOKIE}=${cookie.value}` },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.role).toBe("owner");
    expect(session.json()).not.toHaveProperty("token");
    expect((await connection.db.select().from(staff))[0]?.role).toBe("owner");
    const events = await connection.db
      .select()
      .from(adminActions)
      .where(eq(adminActions.adminId, session.json().user.id));
    expect(events.map((event) => event.action)).toEqual(["team.owner_bootstrapped", "auth.login"]);
    expect(events.every((event) => event.ipHash && !event.ipHash.includes("127.0.0.1"))).toBe(true);
    time = new Date(instant.getTime() + 43200000);
    expect(
      (
        await app.inject({
          url: "/api/admin/session",
          headers: { cookie: `${SESSION_COOKIE}=${cookie.value}` },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("rejects unsolicited, mismatched, expired and replayed OAuth callbacks", async () => {
    const id = String(++serial);
    const fetcher = discordFetch(id);
    const app = server({ OWNER_DISCORD_ID: id }, fetcher);
    expect(
      (await app.inject({ url: `/api/admin/auth/callback?code=x&state=${"s".repeat(43)}` }))
        .statusCode,
    ).toBe(401);
    const { callback, state, browser } = await login(app);
    expect(callback.statusCode).toBe(302);
    expect(
      (
        await app.inject({
          url: `/api/admin/auth/callback?code=x&state=${state}`,
          headers: { cookie: `${STATE_COOKIE}=${browser}` },
        })
      ).statusCode,
    ).toBe(401);
    const start = await app.inject({ url: "/api/admin/auth/discord" });
    const nextState = new URL(String(start.headers.location)).searchParams.get("state")!;
    expect(
      (
        await app.inject({
          url: `/api/admin/auth/callback?code=x&state=${nextState}`,
          headers: { cookie: `${STATE_COOKIE}=${"w".repeat(43)}` },
        })
      ).statusCode,
    ).toBe(401);
    time = new Date(instant.getTime() + 600001);
    expect(
      (
        await app.inject({
          url: `/api/admin/auth/callback?code=x&state=${nextState}`,
          headers: { cookie: `${STATE_COOKIE}=${start.cookies[0]!.value}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not bootstrap an unlisted user or replace an existing owner", async () => {
    const id = String(++serial);
    const app = server({ OWNER_DISCORD_ID: String(++serial) }, discordFetch(id));
    expect((await login(app)).callback.headers.location).toBe("/admin?error=access");
    expect(await connection.db.select().from(staff)).toHaveLength(0);
    await member();
    const second = server({ OWNER_DISCORD_ID: id }, discordFetch(id));
    expect((await login(second)).callback.headers.location).toBe("/admin?error=access");
    expect(await connection.db.select().from(staff)).toHaveLength(1);
  });
  it("keeps allowlisted Discord access but never restores a revoked member", async () => {
    const user = await member("admin", true);
    const app = server({ ADMIN_DISCORD_IDS: user.discordId }, discordFetch(user.discordId));
    expect((await login(app)).callback.headers.location).toBe("/admin?error=access");
    const id = String(++serial);
    const legacy = server({ ADMIN_DISCORD_IDS: id }, discordFetch(id));
    const result = await login(legacy);
    const cookie = result.callback.cookies.find((entry) => entry.name === SESSION_COOKIE)!;
    const headers = { cookie: `${SESSION_COOKIE}=${cookie.value}` };
    const response = await legacy.inject({ url: "/api/admin/session", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ legacy: true, user: { role: "admin" } });
    expect((await legacy.inject({ url: "/api/admin/team", headers })).statusCode).toBe(403);
  });
  it("revokes logout on the server, rejects CSRF, cross-origin and duplicate cookies", async () => {
    const user = await member();
    const app = server();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/logout",
          headers: { cookie: user.headers.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/logout",
          headers: { ...user.headers, origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/api/admin/session",
          headers: { cookie: `${user.headers.cookie}; ${user.headers.cookie}` },
        })
      ).statusCode,
    ).toBe(401);
    const logout = await app.inject({
      method: "POST",
      url: "/api/admin/logout",
      headers: user.headers,
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.cookies[0]?.maxAge).toBe(0);
    expect(
      (await app.inject({ url: "/api/admin/session", headers: user.headers })).statusCode,
    ).toBe(401);
    expect(
      await connection.db
        .select()
        .from(adminActions)
        .where(and(eq(adminActions.adminId, user.id), eq(adminActions.action, "auth.logout"))),
    ).toHaveLength(1);
  });
  it("does not log cookies, OAuth codes, state or provider errors", async () => {
    const logs: string[] = [];
    const app = server(
      { OWNER_DISCORD_ID: String(++serial) },
      vi.fn<typeof fetch>().mockRejectedValue(new Error("fake-provider-secret")),
      logs,
    );
    const result = await login(app);
    expect(result.callback.statusCode).toBe(502);
    const text = logs.join("");
    for (const value of [
      "fake-auth-code",
      "fake-provider-secret",
      result.browser,
      result.state,
      "fake-client-secret",
    ])
      expect(text).not.toContain(value);
  });
});

const routes: {
  method: "GET" | "POST";
  url: string;
  permission: Parameters<typeof allowed>[1];
  body?: object;
}[] = [
  { method: "GET", url: "/api/admin/session", permission: "overview:read" },
  { method: "POST", url: "/api/admin/logout", permission: "overview:read" },
  { method: "GET", url: "/api/admin/team", permission: "team:read" },
  {
    method: "POST",
    url: "/api/admin/team",
    permission: "team:write",
    body: { discordId: "300000000000000001", role: "support" },
  },
  {
    method: "POST",
    url: "/api/admin/team/revoke",
    permission: "team:write",
    body: { userId: "00000000-0000-4000-8000-000000000001" },
  },
  {
    method: "POST",
    url: "/api/admin/team/transfer",
    permission: "ownership:transfer",
    body: { userId: "00000000-0000-4000-8000-000000000001", confirmation: "Synthetic" },
  },
  { method: "GET", url: "/api/admin/audit", permission: "audit:read" },
];
describe("deny-by-default role permissions", () => {
  for (const role of ROLES)
    for (const route of routes)
      it(`${role}: ${route.method} ${route.url}`, async () => {
        const user = await member(role);
        const app = server();
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: user.headers,
          payload: route.body,
        });
        const permitted =
          role === "owner" ||
          ["/api/admin/session", "/api/admin/logout", "/api/admin/audit"].includes(route.url);
        if (permitted) expect([200, 404]).toContain(response.statusCode);
        else expect(response.statusCode).toBe(403);
      });
  it("denies a future admin route without an explicit permission", async () => {
    const user = await member();
    const app = server();
    app.get("/api/admin/future", async () => ({ unsafe: true }));
    expect((await app.inject({ url: "/api/admin/future", headers: user.headers })).statusCode).toBe(
      403,
    );
  });
  it("covers the future permission map without granting moderators writes outside flags", () => {
    expect(PERMISSIONS.every((permission) => allowed("owner", permission))).toBe(true);
    expect(
      PERMISSIONS.filter(
        (permission) => permission.endsWith(":write") && allowed("moderator", permission),
      ),
    ).toEqual(["flags:write"]);
    expect(
      PERMISSIONS.filter(
        (permission) => !permission.endsWith(":read") && allowed("support", permission),
      ),
    ).toEqual([]);
    for (const permission of ["team:write", "ownership:transfer", "seasons:past-start"] as const)
      expect(allowed("admin", permission)).toBe(false);
  });
});

describe("team and append-only audit", () => {
  it("validates all team writes and rolls back an unconfirmed new owner completely", async () => {
    const owner = await member();
    const app = server();
    for (const payload of [
      { discordId: "not-an-id", role: "support" },
      { discordId: "1", role: "root" },
      { discordId: "18446744073709551616", role: "support" },
      { discordId: "1", role: "admin", extra: true },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/admin/team",
            headers: owner.headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    const id = String(++serial);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/team",
          headers: owner.headers,
          payload: { discordId: id, role: "owner" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      await connection.db.select().from(identities).where(eq(identities.platformUserId, id)),
    ).toHaveLength(0);
    for (const url of ["/api/admin/team/revoke", "/api/admin/team/transfer"]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            headers: owner.headers,
            payload: { userId: "invalid" },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      await connection.db.select().from(adminActions).where(eq(adminActions.adminId, owner.id)),
    ).toHaveLength(0);
  });
  it("grants a new Discord ID, changes roles, revokes immediately and audits each write", async () => {
    const owner = await member();
    const target = await member("support");
    const app = server();
    const post = (url: string, payload: object) =>
      app.inject({ method: "POST", url, headers: owner.headers, payload });
    expect(
      (await post("/api/admin/team", { discordId: "400000000000000001", role: "support" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await post("/api/admin/team", { discordId: target.discordId, role: "moderator" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/admin/session", headers: target.headers })).statusCode,
    ).toBe(401);
    expect((await post("/api/admin/team/revoke", { userId: target.id })).statusCode).toBe(200);
    const events = await connection.db
      .select()
      .from(adminActions)
      .where(eq(adminActions.adminId, owner.id));
    expect(events.map((event) => event.action)).toEqual([
      "team.granted",
      "team.role_changed",
      "team.revoked",
    ]);
    expect(events[1]?.details).toMatchObject({ before: "support", after: "moderator" });
    expect(
      (await app.inject({ url: "/api/admin/team", headers: owner.headers })).json().members,
    ).toHaveLength(3);
  });
  it("updates a pending member's display name on login and keeps the same identity", async () => {
    const owner = await member();
    const id = String(++serial);
    const app = server({}, discordFetch(id, "New synthetic name"));
    await app.inject({
      method: "POST",
      url: "/api/admin/team",
      headers: owner.headers,
      payload: { discordId: id, role: "support" },
    });
    const before = (await app.inject({ url: "/api/admin/team", headers: owner.headers }))
      .json()
      .members.find((entry: { discordId: string }) => entry.discordId === id);
    expect(before.displayName).toBe(`Discord ${id}`);
    const logged = await login(app);
    expect(logged.callback.headers.location).toBe("/admin");
    const after = (await app.inject({ url: "/api/admin/team", headers: owner.headers }))
      .json()
      .members.find((entry: { discordId: string }) => entry.discordId === id);
    expect(after.userId).toBe(before.userId);
    expect(after.displayName).toBe("New synthetic name");
  });
  it("protects the last owner and rolls failed changes back without audit events", async () => {
    const owner = await member();
    const app = server();
    for (const [url, payload] of [
      ["/api/admin/team/revoke", { userId: owner.id }],
      ["/api/admin/team", { discordId: owner.discordId, role: "admin" }],
    ] as const) {
      const response = await app.inject({ method: "POST", url, headers: owner.headers, payload });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("LAST_OWNER");
    }
    expect(
      await connection.db.select().from(adminActions).where(eq(adminActions.adminId, owner.id)),
    ).toHaveLength(0);
    expect(
      (await connection.db.select().from(staff).where(eq(staff.userId, owner.id)))[0]?.role,
    ).toBe("owner");
  });
  it("requires exact confirmation for a transfer and atomically changes both roles", async () => {
    const owner = await member();
    const target = await member("admin");
    const app = server();
    for (const confirmation of ["wrong", target.displayName]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/team/transfer",
        headers: owner.headers,
        payload: { userId: target.id, confirmation },
      });
      expect(response.statusCode).toBe(confirmation === "wrong" ? 409 : 200);
    }
    const rows = await connection.db.select().from(staff);
    expect(rows.find((row) => row.userId === owner.id)?.role).toBe("admin");
    expect(rows.find((row) => row.userId === target.id)?.role).toBe("owner");
    for (const user of [owner, target])
      expect(
        (await app.inject({ url: "/api/admin/session", headers: user.headers })).statusCode,
      ).toBe(401);
    const events = await connection.db
      .select()
      .from(adminActions)
      .where(eq(adminActions.adminId, owner.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("team.ownership_transferred");
  });
  it("requires confirmation to grant another owner and protects concurrent owner removals", async () => {
    const first = await member();
    const second = await member();
    const target = await member("admin");
    const app = server();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/team",
          headers: first.headers,
          payload: { discordId: target.discordId, role: "owner" },
        })
      ).json().error.code,
    ).toBe("CONFIRMATION_REQUIRED");
    const results = await Promise.all(
      [first, second].map((user) =>
        app.inject({
          method: "POST",
          url: "/api/admin/team/revoke",
          headers: user.headers,
          payload: { userId: user.id },
        }),
      ),
    );
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409]);
  });
  it("rejects an existing session when staff access or the player account is revoked", async () => {
    const target = await member("support");
    const app = server();
    await connection.db
      .update(staff)
      .set({ revokedAt: instant })
      .where(eq(staff.userId, target.id));
    expect(
      (await app.inject({ url: "/api/admin/session", headers: target.headers })).statusCode,
    ).toBe(403);
    await connection.db.update(staff).set({ revokedAt: null }).where(eq(staff.userId, target.id));
    await connection.db.update(users).set({ status: "banned" }).where(eq(users.id, target.id));
    expect(
      (await app.inject({ url: "/api/admin/session", headers: target.headers })).statusCode,
    ).toBe(403);
  });
  it("filters and paginates audit entries and rejects invalid input", async () => {
    const owner = await member();
    const app = server();
    await connection.db.insert(adminActions).values(
      Array.from({ length: 52 }, (_, i) => ({
        adminId: owner.id,
        action: "test.event",
        reason: "synthetic",
        createdAt: new Date(instant.getTime() + i),
      })),
    );
    const filter = `actor=${owner.id}&action=test.event&from=2026-10-21&to=2026-10-21`;
    const first = (
      await app.inject({ url: `/api/admin/audit?${filter}`, headers: owner.headers })
    ).json();
    const second = (
      await app.inject({ url: `/api/admin/audit?${filter}&page=2`, headers: owner.headers })
    ).json();
    expect(first.entries).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(second.entries).toHaveLength(2);
    expect(first.entries[0].createdAt > second.entries[0].createdAt).toBe(true);
    for (const query of [
      "from=2026-02-30",
      "page=0",
      "actor=invalid",
      "from=2026-11-01&to=2026-10-01",
      "unknown=1",
    ]) {
      expect(
        (await app.inject({ url: `/api/admin/audit?${query}`, headers: owner.headers })).statusCode,
      ).toBe(400);
    }
  });
  it("rejects raw UPDATE, DELETE and TRUNCATE of the audit table", async () => {
    for (const query of [
      sql`UPDATE admin_actions SET action = 'tampered' WHERE false`,
      sql`DELETE FROM admin_actions WHERE false`,
      sql`TRUNCATE admin_actions`,
    ]) {
      await expect(connection.db.execute(query)).rejects.toThrow();
    }
  });
});
