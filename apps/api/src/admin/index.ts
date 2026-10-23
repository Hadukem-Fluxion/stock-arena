import {
  adminActions,
  adminControl,
  adminOauthStates,
  adminSessions,
  staff,
  users,
} from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { and, eq, gt, gte, isNull, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { exchangeDiscordCode } from "../auth/discord.js";
import { createIdentityStore } from "../auth/store.js";
import { AuthError } from "../auth/types.js";
import type { AuthOptions } from "../auth/index.js";
import { AdminError, allowed, ROLE_PERMISSIONS, ROLES } from "./permissions.js";
import type { Permission, Role } from "./permissions.js";
import {
  cookieValue,
  digest,
  equal,
  hmac,
  randomToken,
  SESSION_COOKIE,
  SESSION_SECONDS,
  sessionCookie,
  STATE_COOKIE,
  stateCookie,
  webOrigin,
} from "./security.js";
import { audit, auditOrder, createTeamStore, lockTeam } from "./store.js";
import type { Actor, AuditContext } from "./store.js";
import { registerOperations } from "./operations.js";
import { registerControls } from "./controls.js";
import type { AssetCatalog } from "@stock-arena/game-core";

declare module "fastify" {
  interface FastifyContextConfig {
    adminPermission?: Permission;
  }
  interface FastifyRequest {
    admin:
      (Actor & { credential: string; expiresAt: Date | null; tokenHash: string | null }) | null;
  }
}

const snowflake = z
  .string()
  .regex(/^\d{1,20}$/)
  .refine((id) => /^\d{1,20}$/.test(id) && BigInt(id) > 0n && BigInt(id) < 2n ** 64n);
const grantInput = z
  .object({
    discordId: snowflake,
    role: z.enum(ROLES),
    confirmation: z.string().max(256).optional(),
  })
  .strict();
const memberInput = z.object({ userId: z.string().uuid() }).strict();
const transferInput = z
  .object({ userId: z.string().uuid(), confirmation: z.string().min(1).max(256) })
  .strict();
const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });
const auditInput = z
  .object({
    actor: z.string().uuid().optional(),
    action: z
      .string()
      .regex(/^[a-z_.]{1,80}$/)
      .optional(),
    from: dateInput.optional(),
    to: dateInput.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine((input) => !input.from || !input.to || input.from <= input.to);

function parse<Output, Input>(
  schema: z.ZodType<Output, z.ZodTypeDef, Input>,
  value: unknown,
): Output {
  const result = schema.safeParse(value);
  if (!result.success) throw new AuthError("INVALID_INPUT", 400);
  return result.data;
}

export function registerAdmin(
  app: FastifyInstance,
  options: Omit<AuthOptions, "database"> & {
    database: () => DatabaseConnection;
    catalog?: AssetCatalog;
  },
) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const db = () => options.database().db;
  const team = createTeamStore(options.database);
  app.decorateRequest("admin", null);
  const context = (request: FastifyRequest): AuditContext => {
    if (!request.admin) throw new AuthError("UNAUTHORIZED", 401);
    return {
      actor: request.admin,
      ipHash: hmac(env.SESSION_SECRET, `admin-ip:${request.ip}`),
      now: now(),
      tokenHash: request.admin.tokenHash ?? undefined,
    };
  };
  async function authenticate(request: FastifyRequest) {
    const token = cookieValue(request.headers.cookie, SESSION_COOKIE);
    let userId: string;
    let expiresAt: Date | null = null;
    let tokenHash: string | null = null;
    let credential: string;
    if (token) {
      tokenHash = digest(token);
      credential = token;
      const [session] = await db()
        .select()
        .from(adminSessions)
        .where(
          and(
            eq(adminSessions.tokenHash, tokenHash),
            isNull(adminSessions.revokedAt),
            gt(adminSessions.expiresAt, now()),
          ),
        );
      if (!session) throw new AuthError("UNAUTHORIZED", 401);
      userId = session.userId;
      expiresAt = session.expiresAt;
    } else throw new AuthError("UNAUTHORIZED", 401);
    const [user] = await db().select().from(users).where(eq(users.id, userId));
    if (!user || user.status !== "active") throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
    const [member] = await db().select().from(staff).where(eq(staff.userId, userId));
    if (member?.revokedAt) throw new AuthError("FORBIDDEN", 403);
    if (!member) throw new AuthError("FORBIDDEN", 403);
    const role: Role = member.role;
    request.admin = {
      userId,
      displayName: user.displayName,
      role,
      credential,
      expiresAt,
      tokenHash,
    };
  }
  function requirePermission(permission: Permission | undefined) {
    return async (request: FastifyRequest) => {
      await authenticate(request);
      if (!permission || !request.admin || !allowed(request.admin.role, permission))
        throw new AuthError("FORBIDDEN", 403);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        const csrf = request.headers["x-admin-csrf"];
        if (
          request.headers.origin !== webOrigin(env.ADMIN_WEB_ORIGIN) ||
          typeof csrf !== "string" ||
          !equal(csrf, hmac(env.SESSION_SECRET, `admin-csrf:${request.admin.credential}`))
        )
          throw new AdminError("CSRF_REJECTED", 403);
      }
    };
  }
  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (path !== "/api/admin" && !path.startsWith("/api/admin/")) return;
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    if (
      request.method === "GET" &&
      ["/api/admin/auth/discord", "/api/admin/auth/callback"].includes(path)
    )
      return;
    await requirePermission(request.routeOptions.config.adminPermission)(request);
  });

  app.get("/api/admin/auth/discord", async (_request, reply) => {
    const origin = webOrigin(env.ADMIN_WEB_ORIGIN);
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET)
      throw new AuthError("AUTH_UNAVAILABLE", 503);
    hmac(env.SESSION_SECRET, "configuration-check");
    const state = randomToken();
    const browser = randomToken();
    const time = now();
    await db().transaction(async (tx) => {
      await tx.delete(adminOauthStates).where(lt(adminOauthStates.expiresAt, time));
      await tx.insert(adminOauthStates).values({
        stateHash: digest(state),
        browserHash: digest(browser),
        expiresAt: new Date(time.getTime() + 600_000),
      });
    });
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      response_type: "code",
      scope: "identify",
      state,
      redirect_uri: `${origin}/api/admin/auth/callback`,
      prompt: "consent",
    }).toString();
    return reply.header("Set-Cookie", stateCookie(browser)).redirect(url.toString());
  });
  app.get("/api/admin/auth/callback", async (request, reply) => {
    reply.header("Set-Cookie", stateCookie("", 0));
    const input = parse(
      z
        .object({
          code: z.string().min(1).max(4096).optional(),
          state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          iss: z.literal("https://discord.com").optional(),
          error: z.string().max(100).optional(),
          error_description: z.string().max(1024).optional(),
        })
        .strict(),
      request.query,
    );
    const browser = cookieValue(request.headers.cookie, STATE_COOKIE);
    if (!browser) throw new AuthError("INVALID_IDENTITY", 401);
    const consumed = await db()
      .delete(adminOauthStates)
      .where(
        and(
          eq(adminOauthStates.stateHash, digest(input.state)),
          eq(adminOauthStates.browserHash, digest(browser)),
          gt(adminOauthStates.expiresAt, now()),
        ),
      )
      .returning();
    if (!consumed.length) throw new AuthError("INVALID_IDENTITY", 401);
    const origin = webOrigin(env.ADMIN_WEB_ORIGIN);
    if (input.error || !input.code) return reply.redirect("/admin?error=login");
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET)
      throw new AuthError("AUTH_UNAVAILABLE", 503);
    const result = await exchangeDiscordCode(
      input.code,
      {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        redirectUri: `${origin}/api/admin/auth/callback`,
      },
      options.fetch,
    );
    const user = await createIdentityStore(options.database()).login(result.identity);
    const token = randomToken();
    const time = now();
    try {
      await db().transaction(async (tx) => {
        await lockTeam(tx);
        const [control] = await tx.select().from(adminControl).where(eq(adminControl.id, 1));
        let [member] = await tx.select().from(staff).where(eq(staff.userId, user.id));
        const owners = await tx
          .select()
          .from(staff)
          .where(and(eq(staff.role, "owner"), isNull(staff.revokedAt)));
        const auditContext: AuditContext = {
          actor: {
            userId: user.id,
            displayName: result.identity.displayName,
            role: member?.role ?? "admin",
          },
          now: time,
          ipHash: hmac(env.SESSION_SECRET, `admin-ip:${request.ip}`),
        };
        if (
          !owners.length &&
          !control?.bootstrappedAt &&
          result.identity.platformUserId === env.OWNER_DISCORD_ID &&
          !member?.revokedAt
        ) {
          [member] = await tx
            .insert(staff)
            .values({ userId: user.id, role: "owner", grantedBy: user.id, grantedAt: time })
            .onConflictDoUpdate({
              target: staff.userId,
              set: { role: "owner", grantedBy: user.id, grantedAt: time, revokedAt: null },
            })
            .returning();
          await tx.update(adminControl).set({ bootstrappedAt: time }).where(eq(adminControl.id, 1));
          await audit(tx, auditContext, "team.owner_bootstrapped", user.id, { after: "owner" });
        }
        if (!member || member.revokedAt) throw new AuthError("FORBIDDEN", 403);
        await tx
          .update(users)
          .set({ displayName: result.identity.displayName, avatarUrl: result.identity.avatarUrl })
          .where(eq(users.id, user.id));
        await tx.insert(adminSessions).values({
          tokenHash: digest(token),
          userId: user.id,
          createdAt: time,
          expiresAt: new Date(time.getTime() + SESSION_SECONDS * 1000),
        });
        await audit(tx, auditContext, "auth.login", user.id);
      });
    } catch (error) {
      if (error instanceof AuthError && error.code === "FORBIDDEN")
        return reply.redirect("/admin?error=access");
      throw error;
    }
    return reply
      .header("Set-Cookie", [stateCookie("", 0), sessionCookie(token)])
      .redirect("/admin");
  });
  app.get(
    "/api/admin/session",
    { config: { adminPermission: "overview:read" } },
    async (request) => ({
      user: {
        id: request.admin!.userId,
        displayName: request.admin!.displayName,
        role: request.admin!.role,
      },
      permissions: ROLE_PERMISSIONS[request.admin!.role],
      expiresAt: request.admin!.expiresAt?.toISOString() ?? null,
      csrf: hmac(env.SESSION_SECRET, `admin-csrf:${request.admin!.credential}`),
    }),
  );
  app.post(
    "/api/admin/logout",
    { config: { adminPermission: "overview:read" } },
    async (request, reply) => {
      await db().transaction(async (tx) => {
        if (request.admin!.tokenHash)
          await tx
            .update(adminSessions)
            .set({ revokedAt: now() })
            .where(eq(adminSessions.tokenHash, request.admin!.tokenHash!));
        await audit(tx, context(request), "auth.logout", request.admin!.userId);
      });
      return reply.header("Set-Cookie", sessionCookie("", 0)).send({ ok: true });
    },
  );
  app.get("/api/admin/team", { config: { adminPermission: "team:read" } }, async () => ({
    members: await team.list(),
  }));
  app.post("/api/admin/team", { config: { adminPermission: "team:write" } }, async (request) =>
    team.grant(context(request), parse(grantInput, request.body)),
  );
  app.post(
    "/api/admin/team/revoke",
    { config: { adminPermission: "team:write" } },
    async (request) => team.revoke(context(request), parse(memberInput, request.body).userId),
  );
  app.post(
    "/api/admin/team/transfer",
    { config: { adminPermission: "ownership:transfer" } },
    async (request) => {
      const input = parse(transferInput, request.body);
      return team.transfer(context(request), input.userId, input.confirmation);
    },
  );
  app.get("/api/admin/audit", { config: { adminPermission: "audit:read" } }, async (request) => {
    const input = parse(auditInput, request.query);
    const rows = await db()
      .select({
        id: adminActions.id,
        actorId: adminActions.adminId,
        actorName: users.displayName,
        action: adminActions.action,
        targetUserId: adminActions.targetUserId,
        targetType: adminActions.targetType,
        targetId: adminActions.targetId,
        details: adminActions.details,
        ipHash: adminActions.ipHash,
        createdAt: adminActions.createdAt,
      })
      .from(adminActions)
      .innerJoin(users, eq(users.id, adminActions.adminId))
      .where(
        and(
          input.actor ? eq(adminActions.adminId, input.actor) : undefined,
          input.action ? eq(adminActions.action, input.action) : undefined,
          input.from ? gte(adminActions.createdAt, new Date(`${input.from}T00:00:00Z`)) : undefined,
          input.to
            ? lt(
                adminActions.createdAt,
                new Date(new Date(`${input.to}T00:00:00Z`).getTime() + 86_400_000),
              )
            : undefined,
        ),
      )
      .orderBy(auditOrder)
      .limit(51)
      .offset((input.page - 1) * 50);
    return { entries: rows.slice(0, 50), page: input.page, hasMore: rows.length > 50 };
  });
  registerOperations(app, { database: options.database, now, context });
  registerControls(app, { database: options.database, now, context, catalog: options.catalog });
  return { requirePermission };
}
