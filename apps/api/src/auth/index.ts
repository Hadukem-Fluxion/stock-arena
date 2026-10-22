import { createDatabase } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { exchangeDiscordCode } from "./discord.js";
import { verifyTelegram } from "./telegram.js";
import { createSessions } from "./session.js";
import { createIdentityStore } from "./store.js";
import { AuthError } from "./types.js";

export type AuthOptions = {
  database?: DatabaseConnection;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
};

const discordBody = z.object({ code: z.string().min(1).max(4096) }).strict();
const telegramBody = z.object({ initData: z.string().min(1).max(16_384) }).strict();

export function registerAuth(app: FastifyInstance, options: AuthOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  let connection = options.database;
  let store: ReturnType<typeof createIdentityStore> | undefined;
  function database() {
    if (!connection) {
      connection = createDatabase({ databaseUrl: env.DATABASE_URL ?? "" });
      if (connection.kind === "postgres")
        connection.db.$client.on("error", () => app.log.error("Idle database connection failed"));
    }
    return connection;
  }
  function identityStore() {
    return (store ??= createIdentityStore(database()));
  }
  function sessions() {
    return createSessions(env.SESSION_SECRET ?? "", now);
  }
  function configured(value: string | undefined): string {
    if (!value) throw new AuthError("AUTH_UNAVAILABLE", 503);
    return value;
  }

  app.decorateRequest("user", null);
  async function requireUser(request: FastifyRequest) {
    const header = request.headers.authorization;
    if (!header || header.length > 8192 || !/^Bearer \S+$/i.test(header))
      throw new AuthError("UNAUTHORIZED", 401);
    const claims = await sessions().verify(header.slice(7));
    request.user = await identityStore().find(claims.sub, claims);
  }
  app.addHook("preHandler", async (request, reply) => {
    const route = request.routeOptions.url;
    if (route === "/api/auth/discord" || route === "/api/auth/telegram") {
      reply.header("Cache-Control", "no-store");
      return;
    }
    if (
      !route?.startsWith("/api/") ||
      route === "/api/health" ||
      route === "/api/admin" ||
      route?.startsWith("/api/admin/") ||
      (request.method === "POST" &&
        (route === "/api/discord/interactions" || route === "/api/telegram/webhook"))
    )
      return;
    await requireUser(request);
  });

  app.post("/api/auth/discord", async (request) => {
    const input = discordBody.safeParse(request.body);
    if (!input.success) throw new AuthError("INVALID_INPUT", 400);
    const sessionManager = sessions();
    const result = await exchangeDiscordCode(
      input.data.code,
      {
        clientId: configured(env.DISCORD_CLIENT_ID),
        clientSecret: configured(env.DISCORD_CLIENT_SECRET),
      },
      options.fetch,
    );
    const user = await identityStore().login(result.identity);
    return { access_token: result.accessToken, session: await sessionManager.issue(user) };
  });

  app.post("/api/auth/telegram", async (request) => {
    const input = telegramBody.safeParse(request.body);
    if (!input.success) throw new AuthError("INVALID_INPUT", 400);
    const sessionManager = sessions();
    const identity = verifyTelegram(input.data.initData, configured(env.TELEGRAM_BOT_TOKEN), now());
    const user = await identityStore().login(identity);
    return { session: await sessionManager.issue(user) };
  });

  app.addHook("onClose", async () => {
    if (!options.database) await connection?.close();
  });
  return { requireUser, database };
}
