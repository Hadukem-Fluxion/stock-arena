import { createHmac } from "node:crypto";
import { Writable } from "node:stream";
import { createLocalDatabase, identities, users } from "@stock-arena/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import { createSessions } from "./session.js";

const fakeBotToken = "fake-test-bot-token-never-used-with-telegram";
const fakeSessionSecret = "fake-session-secret-for-unit-tests-only-32-bytes";
const instant = new Date("2026-10-15T12:00:00Z");
const baseEnv = {
  SESSION_SECRET: fakeSessionSecret,
  TELEGRAM_BOT_TOKEN: fakeBotToken,
  DISCORD_CLIENT_ID: "fake-client-id",
  DISCORD_CLIENT_SECRET: "fake-client-secret",
};
const connection = createLocalDatabase();
let time = instant;
let userNumber = 100;

function signedInitData(fields: Record<string, string> = {}, token = fakeBotToken) {
  const data = {
    auth_date: String(Math.floor(instant.getTime() / 1000)),
    query_id: "fake-query-id",
    user: JSON.stringify({ id: ++userNumber, first_name: "Test", last_name: "Player" }),
    ...fields,
  };
  const check = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key as keyof typeof data]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...data, hash }).toString();
}

function server(
  options: { env?: Record<string, string | undefined>; fetch?: typeof fetch; logs?: string[] } = {},
) {
  const stream = new Writable({
    write(chunk, _encoding, done) {
      options.logs?.push(String(chunk));
      done();
    },
  });
  const app = buildServer({
    auth: {
      database: connection,
      env: { ...baseEnv, ...options.env },
      fetch:
        options.fetch ??
        vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected external request in test")),
      now: () => time,
    },
    logger: options.logs ? { stream } : false,
  });
  // Future game/admin routes inherit authentication without opting in individually.
  app.get("/api/test/game", async (request) => ({ id: request.user?.id }));
  app.get("/api/admin/test", { config: { adminPermission: "overview:read" } }, async () => ({
    ok: true,
  }));
  return app;
}

type LoginResponse = {
  session: {
    token: string;
    expiresAt: string;
    user: {
      id: string;
      displayName: string;
      avatarUrl: string | null;
      identity: { platform: "discord" | "telegram"; platformUserId: string };
    };
  };
  access_token?: string;
};

beforeAll(async () => {
  await connection.migrate();
}, 30_000);
afterAll(async () => {
  await connection.close();
});

describe("Telegram login", () => {
  it("validates signed init data, creates the identity and returns a signed session", async () => {
    const app = server();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/telegram",
        payload: { initData: signedInitData() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const body = res.json<LoginResponse>();
      expect(body.session.user.displayName).toBe("Test Player");
      const claims = await createSessions(fakeSessionSecret, () => instant).verify(
        body.session.token,
      );
      expect(claims.sub).toBe(body.session.user.id);
      const [identity] = await connection.db
        .select()
        .from(identities)
        .where(eq(identities.userId, claims.sub));
      expect(identity).toMatchObject({ platform: "telegram", platformCreatedAt: null });
      expect(
        await app
          .inject({
            url: "/api/test/game",
            headers: { authorization: `Bearer ${body.session.token}` },
          })
          .then((response) => response.statusCode),
      ).toBe(200);
    } finally {
      await app.close();
    }
  });

  it.each([
    ["tampered", () => signedInitData().replace("fake-query-id", "tampered")],
    [
      "missing hash",
      () => {
        const params = new URLSearchParams(signedInitData());
        params.delete("hash");
        return params.toString();
      },
    ],
    [
      "invalid hash length",
      () => {
        const params = new URLSearchParams(signedInitData());
        params.set("hash", "ab");
        return params.toString();
      },
    ],
    [
      "nonhex hash",
      () => {
        const params = new URLSearchParams(signedInitData());
        params.set("hash", "z".repeat(64));
        return params.toString();
      },
    ],
    [
      "older than 24h",
      () => signedInitData({ auth_date: String(instant.getTime() / 1000 - 86401) }),
    ],
    ["future auth_date", () => signedInitData({ auth_date: String(instant.getTime() / 1000 + 1) })],
    ["missing auth_date", () => signedInitData({ auth_date: "" })],
    ["duplicate key", () => `${signedInitData()}&auth_date=1`],
    ["wrong bot token", () => signedInitData({}, "another-fake-token")],
    ["invalid user JSON", () => signedInitData({ user: "not JSON" })],
    [
      "invalid user ID",
      () => signedInitData({ user: JSON.stringify({ id: "123", first_name: "Test" }) }),
    ],
  ] as const)("rejects %s without creating a user", async (_name, initData) => {
    const app = server();
    const before = await connection.db.select().from(users);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/telegram",
        payload: { initData: initData() },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: { code: "INVALID_IDENTITY" } });
      expect(await connection.db.select().from(users)).toEqual(before);
    } finally {
      await app.close();
    }
  });

  it("accepts the 24-hour boundary and keeps the same account on repeated/concurrent logins", async () => {
    const app = server();
    try {
      const initData = signedInitData({ auth_date: String(instant.getTime() / 1000 - 86400) });
      const responses = await Promise.all(
        [1, 2, 3].map(() =>
          app.inject({ method: "POST", url: "/api/auth/telegram", payload: { initData } }),
        ),
      );
      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
      expect(
        new Set(responses.map((response) => response.json<LoginResponse>().session.user.id)).size,
      ).toBe(1);
    } finally {
      await app.close();
    }
  });
});

describe("Discord code exchange", () => {
  const discordId = "1000000000000000000";
  const fakeAccessToken = "fake-discord-access-token";
  function discordFetch() {
    return vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: fakeAccessToken, token_type: "Bearer" }))
      .mockResolvedValueOnce(
        Response.json({
          id: discordId,
          username: "fake-discord-user",
          global_name: "Discord Test Player",
          avatar: "a_0123456789abcdef",
        }),
      );
  }
  it("exchanges form data, fetches /users/@me, stores snowflake creation time and returns access_token", async () => {
    const fetcher = discordFetch();
    const app = server({ fetch: fetcher });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/discord",
        payload: { code: "fake-oauth-code" },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<LoginResponse>();
      expect(body.access_token).toBe(fakeAccessToken);
      expect(body.session.user.displayName).toBe("Discord Test Player");
      expect(body.session.user.avatarUrl).toBe(
        `https://cdn.discordapp.com/avatars/${discordId}/a_0123456789abcdef.gif`,
      );
      const [identity] = await connection.db
        .select()
        .from(identities)
        .where(eq(identities.userId, body.session.user.id));
      expect(identity?.platformCreatedAt?.getTime()).toBe(
        Number((BigInt(discordId) >> 22n) + 1420070400000n),
      );
      expect(fetcher.mock.calls[0]?.[0]).toBe("https://discord.com/api/oauth2/token");
      const form = fetcher.mock.calls[0]?.[1]?.body;
      expect(form).toBeInstanceOf(URLSearchParams);
      expect(String(form)).toContain("grant_type=authorization_code");
      expect(String(form)).toContain("client_id=fake-client-id");
      expect(fetcher.mock.calls[1]?.[0]).toBe("https://discord.com/api/v10/users/@me");
      expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({
        authorization: `Bearer ${fakeAccessToken}`,
      });
    } finally {
      await app.close();
    }
  });
  it.each([
    [400, "INVALID_IDENTITY", 401],
    [401, "INVALID_IDENTITY", 401],
    [429, "PROVIDER_UNAVAILABLE", 502],
    [503, "PROVIDER_UNAVAILABLE", 502],
  ] as const)("handles provider HTTP %i safely", async (status, code, resultStatus) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider body must stay private", { status }));
    const app = server({ fetch: fetcher });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/discord",
        payload: { code: "fake-code" },
      });
      expect(response.statusCode).toBe(resultStatus);
      expect(response.json()).toEqual({ error: { code } });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
  it("handles network failures without exposing their contents", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("fake-secret-sensitive-provider-error"));
    const app = server({ fetch: fetcher });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/discord",
        payload: { code: "fake-code" },
      });
      expect(response.json()).toEqual({ error: { code: "PROVIDER_UNAVAILABLE" } });
    } finally {
      await app.close();
    }
  });
});

describe("session and permissions", () => {
  it.each(["suspended", "banned"] as const)(
    "rejects another login for a %s account",
    async (status) => {
      const app = server();
      const initData = signedInitData();
      try {
        const { session } = (
          await app.inject({ method: "POST", url: "/api/auth/telegram", payload: { initData } })
        ).json<LoginResponse>();
        await connection.db.update(users).set({ status }).where(eq(users.id, session.user.id));
        const result = await app.inject({
          method: "POST",
          url: "/api/auth/telegram",
          payload: { initData },
        });
        expect(result.statusCode).toBe(403);
        expect(result.json()).toEqual({ error: { code: "ACCOUNT_UNAVAILABLE" } });
      } finally {
        await app.close();
      }
    },
  );
  it("requires sessions by default, rejects tampering and expiry, and checks the current account status", async () => {
    const app = server();
    try {
      expect((await app.inject({ url: "/api/test/game" })).statusCode).toBe(401);
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/telegram",
        payload: { initData: signedInitData() },
      });
      const { session } = response.json<LoginResponse>();
      expect(
        (
          await app.inject({
            url: "/api/test/game",
            headers: { authorization: `Bearer ${session.token}tampered` },
          })
        ).statusCode,
      ).toBe(401);
      time = new Date(instant.getTime() + 86400_000);
      expect(
        (
          await app.inject({
            url: "/api/test/game",
            headers: { authorization: `Bearer ${session.token}` },
          })
        ).statusCode,
      ).toBe(401);
      time = instant;
      await connection.db
        .update(users)
        .set({ status: "banned" })
        .where(eq(users.id, session.user.id));
      expect(
        (
          await app.inject({
            url: "/api/test/game",
            headers: { authorization: `Bearer ${session.token}` },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      time = instant;
      await app.close();
    }
  });

  it("never grants admin access from deprecated platform allowlists", async () => {
    const adminId = ++userNumber;
    const initData = signedInitData({ user: JSON.stringify({ id: adminId, first_name: "Admin" }) });
    const app = server({ env: { ADMIN_TELEGRAM_IDS: ` 999, ${adminId} ` } });
    const notAdmin = server({ env: { ADMIN_DISCORD_IDS: String(adminId) } });
    try {
      const { session } = (
        await app.inject({ method: "POST", url: "/api/auth/telegram", payload: { initData } })
      ).json<LoginResponse>();
      const headers = { authorization: `Bearer ${session.token}` };
      expect((await app.inject({ url: "/api/admin/test", headers })).statusCode).toBe(401);
      expect((await notAdmin.inject({ url: "/api/admin/test", headers })).statusCode).toBe(401);
    } finally {
      await app.close();
      await notAdmin.close();
    }
  });

  it("invalidates a session whose identity no longer belongs to that user", async () => {
    const app = server();
    try {
      const { session } = (
        await app.inject({
          method: "POST",
          url: "/api/auth/telegram",
          payload: { initData: signedInitData() },
        })
      ).json<LoginResponse>();
      await connection.db.delete(identities).where(eq(identities.userId, session.user.id));
      expect(
        (
          await app.inject({
            url: "/api/test/game",
            headers: { authorization: `Bearer ${session.token}` },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe("validation and safe logging", () => {
  it.each([{}, { initData: {} }, { initData: "" }])(
    "validates Telegram API input %j",
    async (payload) => {
      const app = server();
      try {
        const response = await app.inject({ method: "POST", url: "/api/auth/telegram", payload });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: { code: "INVALID_INPUT" } });
      } finally {
        await app.close();
      }
    },
  );
  it.each([{}, { code: 123 }, { code: "" }, { code: "x", access_token: "unexpected" }])(
    "validates Discord API input %j",
    async (payload) => {
      const app = server();
      try {
        expect(
          (await app.inject({ method: "POST", url: "/api/auth/discord", payload })).json(),
        ).toEqual({ error: { code: "INVALID_INPUT" } });
      } finally {
        await app.close();
      }
    },
  );

  it("keeps health public and returns a typed error for unconfigured auth", async () => {
    const app = server({ env: { SESSION_SECRET: "" } });
    try {
      expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/telegram",
            payload: { initData: signedInitData() },
          })
        ).json(),
      ).toEqual({ error: { code: "AUTH_UNAVAILABLE" } });
    } finally {
      await app.close();
    }
  });

  it("omits tokens, raw init data, OAuth codes, provider errors and query parameters from logs", async () => {
    const logs: string[] = [];
    const app = server({
      logs,
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("private-provider-error")),
    });
    const initData = signedInitData();
    try {
      await app.inject({
        method: "POST",
        url: "/api/auth/telegram?code=private-query-code",
        payload: { initData },
        headers: { authorization: "Bearer private-header-token" },
      });
      await app.inject({
        method: "POST",
        url: "/api/auth/discord",
        payload: { code: "private-body-code" },
      });
    } finally {
      await app.close();
    }
    const output = logs.join("");
    expect(output.length).toBeGreaterThan(0);
    for (const secret of [
      initData,
      fakeBotToken,
      fakeSessionSecret,
      "private-query-code",
      "private-header-token",
      "private-body-code",
      "private-provider-error",
    ])
      expect(output).not.toContain(secret);
  });
});
