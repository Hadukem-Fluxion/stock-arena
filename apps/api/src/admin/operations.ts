import {
  adminActions,
  adminSessions,
  bankSchema,
  checkins,
  flagNotes,
  flags,
  hlRuns,
  hlPredictions,
  hlRounds,
  identities,
  pointsLedger,
  quizAttempts,
  quizBankControl,
  quizDailySets,
  quizQuestions,
  staff,
  users,
} from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { gameDay } from "@stock-arena/game-core";
import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError } from "../auth/types.js";
import { AdminError, allowed } from "./permissions.js";
import type { Permission } from "./permissions.js";
import { lockTeam } from "./store.js";
import type { AuditContext } from "./store.js";

type Tx = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];
const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(16_000);
const reason = z.string().trim().min(1).max(2000);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const date = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
  });
const page = z.coerce.number().int().min(1).max(10000).default(1);
const query = z.object({ search: z.string().trim().max(200).default(""), page }).strict();
const pageQuery = z.object({ page }).strict();
const idParams = z.object({ id: uuid }).strict();
const question = z
  .object({
    id: uuid.optional(),
    slug: z.string().trim().min(1).max(200),
    topic: text,
    prompt: text,
    options: z.tuple([text, text, text, text]),
    answerIndex: z.number().int().min(0).max(3),
    explanation: text,
  })
  .strict();
const adjustment = z
  .object({
    requestId: uuid,
    reason,
    amount: z
      .number()
      .int()
      .min(-2147483648)
      .max(2147483647)
      .refine((n) => n !== 0),
  })
  .strict();
const statusInput = z
  .object({ status: z.enum(["active", "suspended", "banned"]), reason })
  .strict();
const size = 25;
function parse<O, I>(schema: z.ZodType<O, z.ZodTypeDef, I>, value: unknown): O {
  const result = schema.safeParse(value);
  if (!result.success) throw new AuthError("INVALID_INPUT", 400);
  return result.data;
}
function pattern(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
function paginated<T>(rows: T[], current: number) {
  return { entries: rows.slice(0, size), page: current, hasMore: rows.length > size };
}
export async function event(
  tx: Tx,
  ctx: AuditContext,
  action: string,
  type: string,
  id: string,
  userId: string | null,
  details: Record<string, unknown>,
) {
  await tx.insert(adminActions).values({
    adminId: ctx.actor.userId,
    action,
    reason: typeof details.reason === "string" ? details.reason : action,
    targetType: type,
    targetId: id,
    targetUserId: userId,
    details,
    ipHash: ctx.ipHash,
    createdAt: ctx.now,
  });
}
export async function activeActor(tx: Tx, ctx: AuditContext, permission: Permission) {
  // Same serialization gate as grants/revocations; prevents stale role writes.
  await lockTeam(tx);
  const [member] = await tx
    .select()
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId))
    .where(and(eq(staff.userId, ctx.actor.userId), isNull(staff.revokedAt)));
  if (!member || member.users.status !== "active" || !allowed(member.staff.role, permission))
    throw new AuthError("FORBIDDEN", 403);
  const [session] = await tx
    .select()
    .from(adminSessions)
    .where(
      and(
        eq(adminSessions.tokenHash, ctx.tokenHash ?? ""),
        eq(adminSessions.userId, ctx.actor.userId),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, ctx.now),
      ),
    );
  if (!session) throw new AuthError("UNAUTHORIZED", 401);
}
async function targetUser(tx: Tx, id: string) {
  const [user] = await tx.select().from(users).where(eq(users.id, id)).for("update");
  if (!user) throw new AdminError("NOT_FOUND", 404);
  return user;
}
async function changeStatus(
  tx: Tx,
  ctx: AuditContext,
  id: string,
  input: z.infer<typeof statusInput>,
) {
  const user = await targetUser(tx, id);
  if (input.status !== "active") {
    const owners = await tx
      .select({ id: staff.userId })
      .from(staff)
      .innerJoin(users, eq(users.id, staff.userId))
      .where(and(eq(staff.role, "owner"), isNull(staff.revokedAt), eq(users.status, "active")));
    if (owners.some((o) => o.id === id) && owners.length <= 1) throw new AdminError("LAST_OWNER");
  }
  await tx.update(users).set({ status: input.status }).where(eq(users.id, id));
  if (input.status !== "active")
    await tx
      .update(adminSessions)
      .set({ revokedAt: ctx.now })
      .where(and(eq(adminSessions.userId, id), isNull(adminSessions.revokedAt)));
  await event(tx, ctx, "player.status_changed", "player", id, id, {
    before: user.status,
    after: input.status,
    reason: input.reason,
  });
}
async function adjust(
  tx: Tx,
  ctx: AuditContext,
  userId: string,
  input: z.infer<typeof adjustment>,
) {
  await targetUser(tx, userId);
  const refId = `admin:${input.requestId}`;
  const [existing] = await tx
    .select()
    .from(pointsLedger)
    .where(
      and(
        eq(pointsLedger.userId, userId),
        eq(pointsLedger.reason, "admin_adjustment"),
        eq(pointsLedger.refId, refId),
      ),
    );
  if (existing) {
    const [audit] = await tx
      .select()
      .from(adminActions)
      .where(
        and(eq(adminActions.targetId, existing.id), eq(adminActions.action, "points.adjusted")),
      );
    if (
      existing.amount !== input.amount ||
      audit?.adminId !== ctx.actor.userId ||
      audit.reason !== input.reason
    )
      throw new AdminError("REQUEST_CONFLICT");
    return;
  }
  const [row] = await tx
    .insert(pointsLedger)
    .values({ userId, amount: input.amount, reason: "admin_adjustment", refId, createdAt: ctx.now })
    .returning();
  await event(tx, ctx, "points.adjusted", "ledger", row!.id, userId, {
    amount: input.amount,
    reason: input.reason,
    requestId: input.requestId,
  });
}
async function frozenIds(tx: Tx, now: Date) {
  await tx.select().from(quizBankControl).where(eq(quizBankControl.id, 1)).for("update");
  const [set] = await tx
    .select()
    .from(quizDailySets)
    .where(eq(quizDailySets.day, gameDay(now)));
  return new Set(set?.questions.map((q) => q.id) ?? []);
}

export function registerOperations(
  app: FastifyInstance,
  options: {
    database: () => DatabaseConnection;
    now: () => Date;
    context: (request: FastifyRequest) => AuditContext;
  },
) {
  const db = () => options.database().db;
  const write = <T>(
    req: FastifyRequest,
    permission: Permission,
    fn: (tx: Tx, ctx: AuditContext) => Promise<T>,
  ) =>
    db().transaction(async (tx) => {
      const ctx = options.context(req);
      await activeActor(tx, ctx, permission);
      return fn(tx, ctx);
    });
  app.get("/api/admin/quiz", { config: { adminPermission: "quiz:read" } }, async (req) => {
    const input = parse(query, req.query);
    const rows = await db()
      .select()
      .from(quizQuestions)
      .where(
        input.search
          ? or(
              ilike(quizQuestions.prompt, pattern(input.search)),
              ilike(quizQuestions.slug, pattern(input.search)),
              ilike(quizQuestions.topic, pattern(input.search)),
            )
          : undefined,
      )
      .orderBy(quizQuestions.slug, quizQuestions.id)
      .limit(size + 1)
      .offset((input.page - 1) * size);
    const [set] = await db()
      .select()
      .from(quizDailySets)
      .where(eq(quizDailySets.day, gameDay(options.now())));
    const ids = new Set(set?.questions.map((q) => q.id));
    return paginated(
      rows.map((q) => ({ ...q, frozenToday: ids.has(q.id) })),
      input.page,
    );
  });
  app.post("/api/admin/quiz/save", { config: { adminPermission: "quiz:write" } }, async (req) => {
    const input = parse(question, req.body);
    return write(req, "quiz:write", async (tx, ctx) => {
      const frozen = await frozenIds(tx, ctx.now);
      if (input.id && frozen.has(input.id)) throw new AdminError("QUIZ_FROZEN");
      const [duplicate] = await tx
        .select()
        .from(quizQuestions)
        .where(eq(quizQuestions.slug, input.slug));
      if (duplicate && duplicate.id !== input.id) throw new AdminError("SLUG_EXISTS");
      const { id, ...values } = input;
      let saved: typeof quizQuestions.$inferSelect | undefined;
      if (id)
        [saved] = await tx
          .update(quizQuestions)
          .set(values)
          .where(eq(quizQuestions.id, id))
          .returning();
      else [saved] = await tx.insert(quizQuestions).values(values).returning();
      if (!saved) throw new AdminError("NOT_FOUND", 404);
      // Never copy the private question bank or key into audit details/logs.
      await event(tx, ctx, id ? "quiz.edited" : "quiz.created", "quiz", saved.id, null, {});
      return { ok: true };
    });
  });
  app.post(
    "/api/admin/quiz/deactivate",
    { config: { adminPermission: "quiz:write" } },
    async (req) => {
      const { id } = parse(idParams, req.body);
      return write(req, "quiz:write", async (tx, ctx) => {
        await frozenIds(tx, ctx.now);
        const rows = await tx
          .update(quizQuestions)
          .set({ active: false })
          .where(eq(quizQuestions.id, id))
          .returning();
        if (!rows.length) throw new AdminError("NOT_FOUND", 404);
        await event(tx, ctx, "quiz.deactivated", "quiz", id, null, {});
        return { ok: true };
      });
    },
  );
  app.post(
    "/api/admin/quiz/schedule",
    { config: { adminPermission: "quiz:write" } },
    async (req) => {
      const input = parse(z.object({ id: uuid, day: day.nullable() }).strict(), req.body);
      if (input.day && input.day < gameDay(options.now()))
        throw new AuthError("INVALID_INPUT", 400);
      return write(req, "quiz:write", async (tx, ctx) => {
        const frozen = await frozenIds(tx, ctx.now);
        if (frozen.has(input.id)) throw new AdminError("QUIZ_FROZEN");
        const [row] = await tx
          .update(quizQuestions)
          .set({ scheduledDay: input.day })
          .where(eq(quizQuestions.id, input.id))
          .returning();
        if (!row) throw new AdminError("NOT_FOUND", 404);
        await event(tx, ctx, "quiz.scheduled", "quiz", input.id, null, { day: input.day });
        return { ok: true };
      });
    },
  );
  app.post("/api/admin/quiz/import", { config: { adminPermission: "quiz:write" } }, async (req) => {
    const rows = parse(bankSchema, req.body);
    return write(req, "quiz:write", async (tx, ctx) => {
      const frozen = await frozenIds(tx, ctx.now);
      const existing = await tx
        .select()
        .from(quizQuestions)
        .where(
          inArray(
            quizQuestions.slug,
            rows.map((r) => r.id),
          ),
        );
      if (existing.some((q) => frozen.has(q.id))) throw new AdminError("QUIZ_FROZEN");
      for (const row of rows) {
        const values = {
          slug: row.id,
          topic: row.topic,
          prompt: row.prompt,
          options: row.options,
          answerIndex: row.answer_index,
          explanation: row.explanation,
        };
        await tx
          .insert(quizQuestions)
          .values(values)
          .onConflictDoUpdate({ target: quizQuestions.slug, set: values });
      }
      await event(tx, ctx, "quiz.imported", "quiz_bank", gameDay(ctx.now), null, {
        count: rows.length,
      });
      return { ok: true, count: rows.length };
    });
  });
  app.get("/api/admin/players", { config: { adminPermission: "players:read" } }, async (req) => {
    const input = parse(query, req.query);
    const rows = await db()
      .select()
      .from(users)
      .where(
        input.search
          ? or(
              ilike(users.displayName, pattern(input.search)),
              sql`EXISTS (SELECT 1 FROM identities i WHERE i.user_id = ${users.id} AND i.platform_user_id ILIKE ${pattern(input.search)})`,
            )
          : undefined,
      )
      .orderBy(desc(users.createdAt), users.id)
      .limit(size + 1)
      .offset((input.page - 1) * size);
    return paginated(rows, input.page);
  });
  app.get(
    "/api/admin/players/:id",
    { config: { adminPermission: "players:read" } },
    async (req) => {
      const { id } = parse(idParams, req.params);
      const input = parse(pageQuery, req.query);
      const [user] = await db().select().from(users).where(eq(users.id, id));
      if (!user) throw new AdminError("NOT_FOUND", 404);
      const identityRows = await db().select().from(identities).where(eq(identities.userId, id));
      const ledger = await db()
        .select()
        .from(pointsLedger)
        .where(eq(pointsLedger.userId, id))
        .orderBy(desc(pointsLedger.createdAt), desc(pointsLedger.id))
        .limit(size + 1)
        .offset((input.page - 1) * size);
      const runs = await db()
        .select()
        .from(hlRuns)
        .where(eq(hlRuns.userId, id))
        .orderBy(desc(hlRuns.createdAt), hlRuns.id)
        .limit(size + 1)
        .offset((input.page - 1) * size);
      const runIds = runs.slice(0, size).map((r) => r.id);
      const predictions = runIds.length
        ? await db()
            .select({
              id: hlPredictions.id,
              runId: hlPredictions.runId,
              ticker: hlPredictions.ticker,
              state: hlPredictions.state,
              direction: hlPredictions.direction,
              lockedAt: hlPredictions.lockedAt,
              settledAt: hlPredictions.settledAt,
            })
            .from(hlPredictions)
            .where(inArray(hlPredictions.runId, runIds))
            .orderBy(hlPredictions.position)
        : [];
      const classic = runIds.length
        ? await db()
            .select({
              id: hlRounds.id,
              runId: hlRounds.runId,
              position: hlRounds.position,
              choice: hlRounds.choice,
              answeredAt: hlRounds.answeredAt,
            })
            .from(hlRounds)
            .where(inArray(hlRounds.runId, runIds))
        : [];
      const attempts = await db()
        .select()
        .from(quizAttempts)
        .where(eq(quizAttempts.userId, id))
        .orderBy(desc(quizAttempts.day))
        .limit(size + 1)
        .offset((input.page - 1) * size);
      const checkinRows = await db()
        .select()
        .from(checkins)
        .where(eq(checkins.userId, id))
        .orderBy(desc(checkins.day))
        .limit(size + 1)
        .offset((input.page - 1) * size);
      const [balance] = await db()
        .select({ total: sql<string>`coalesce(sum(${pointsLedger.amount}), 0)::text` })
        .from(pointsLedger)
        .where(eq(pointsLedger.userId, id));
      return {
        user,
        identities: identityRows,
        balance: balance?.total ?? "0",
        accountAgeDays: Math.max(
          0,
          Math.floor((options.now().getTime() - user.createdAt.getTime()) / 86_400_000),
        ),
        eligibility: { accountActive: user.status === "active", verification: "pending" as const },
        ledger: paginated(ledger, input.page),
        runs: paginated(runs, input.page),
        predictions,
        classic,
        attempts: paginated(attempts, input.page),
        checkins: paginated(checkinRows, input.page),
      };
    },
  );
  app.post(
    "/api/admin/players/:id/status",
    { config: { adminPermission: "players:write" } },
    async (req) => {
      const { id } = parse(idParams, req.params),
        input = parse(statusInput, req.body);
      return write(req, "players:write", async (tx, ctx) => {
        await changeStatus(tx, ctx, id, input);
        return { ok: true };
      });
    },
  );
  app.post(
    "/api/admin/players/:id/adjust",
    { config: { adminPermission: "points:write" } },
    async (req) => {
      const { id } = parse(idParams, req.params),
        input = parse(adjustment, req.body);
      return write(req, "points:write", async (tx, ctx) => {
        await adjust(tx, ctx, id, input);
        return { ok: true };
      });
    },
  );
  app.get("/api/admin/flags", { config: { adminPermission: "flags:read" } }, async (req) => {
    const input = parse(
      z.object({ page, state: z.enum(["open", "cleared", "actioned"]).default("open") }).strict(),
      req.query,
    );
    const rows = await db()
      .select({
        id: flags.id,
        userId: flags.userId,
        displayName: users.displayName,
        raisedBy: flags.raisedBy,
        note: flags.note,
        state: flags.state,
        createdAt: flags.createdAt,
      })
      .from(flags)
      .innerJoin(users, eq(users.id, flags.userId))
      .where(eq(flags.state, input.state))
      .orderBy(desc(flags.createdAt), flags.id)
      .limit(size + 1)
      .offset((input.page - 1) * size);
    return paginated(rows, input.page);
  });
  app.get("/api/admin/flags/:id", { config: { adminPermission: "flags:read" } }, async (req) => {
    const { id } = parse(idParams, req.params),
      input = parse(pageQuery, req.query);
    const [flag] = await db().select().from(flags).where(eq(flags.id, id));
    if (!flag) throw new AdminError("NOT_FOUND", 404);
    const notes = await db()
      .select()
      .from(flagNotes)
      .where(eq(flagNotes.flagId, id))
      .orderBy(desc(flagNotes.createdAt), flagNotes.id)
      .limit(size + 1)
      .offset((input.page - 1) * size);
    return { flag, notes: paginated(notes, input.page) };
  });
  app.post("/api/admin/flags", { config: { adminPermission: "flags:write" } }, async (req) => {
    const input = parse(z.object({ userId: uuid, note: reason }).strict(), req.body);
    return write(req, "flags:write", async (tx, ctx) => {
      await targetUser(tx, input.userId);
      const [row] = await tx
        .insert(flags)
        .values({ ...input, raisedBy: ctx.actor.userId, createdAt: ctx.now })
        .returning();
      await event(tx, ctx, "flag.raised", "flag", row!.id, input.userId, { reason: input.note });
      return { ok: true };
    });
  });
  app.post(
    "/api/admin/flags/:id/note",
    { config: { adminPermission: "flags:write" } },
    async (req) => {
      const { id } = parse(idParams, req.params),
        input = parse(z.object({ note: reason }).strict(), req.body);
      return write(req, "flags:write", async (tx, ctx) => {
        const [flag] = await tx.select().from(flags).where(eq(flags.id, id)).for("update");
        if (!flag) throw new AdminError("NOT_FOUND", 404);
        await tx
          .insert(flagNotes)
          .values({ flagId: id, actorId: ctx.actor.userId, note: input.note, createdAt: ctx.now });
        await event(tx, ctx, "flag.noted", "flag", id, flag.userId, { reason: input.note });
        return { ok: true };
      });
    },
  );
  app.post(
    "/api/admin/flags/:id/resolve",
    { config: { adminPermission: "flags:resolve" } },
    async (req) => {
      const { id } = parse(idParams, req.params);
      const input = parse(
        z.discriminatedUnion("action", [
          z.object({ action: z.literal("clear"), reason }).strict(),
          z.object({ action: z.enum(["suspend", "ban"]), reason }).strict(),
          adjustment.extend({ action: z.literal("adjust") }).strict(),
        ]),
        req.body,
      );
      return write(req, "flags:resolve", async (tx, ctx) => {
        const [flag] = await tx.select().from(flags).where(eq(flags.id, id)).for("update");
        if (!flag) throw new AdminError("NOT_FOUND", 404);
        if (flag.state !== "open") throw new AdminError("FLAG_CLOSED");
        if (input.action === "adjust") {
          await activeActor(tx, ctx, "points:write");
          await adjust(tx, ctx, flag.userId, input);
        } else if (input.action !== "clear") {
          await activeActor(tx, ctx, "players:write");
          await changeStatus(tx, ctx, flag.userId, {
            status: input.action === "ban" ? "banned" : "suspended",
            reason: input.reason,
          });
        }
        const state = input.action === "clear" ? "cleared" : "actioned";
        await tx.update(flags).set({ state }).where(eq(flags.id, id));
        await event(tx, ctx, "flag.resolved", "flag", id, flag.userId, {
          action: input.action,
          state,
          reason: input.reason,
        });
        return { ok: true };
      });
    },
  );
}
