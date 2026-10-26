import { flyerSessions, pointsLedger } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { GAME_CONFIG } from "@stock-arena/game-core";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError } from "../auth/types.js";
import { flyerDayTotals } from "../flyer.js";
import { activeActor, event } from "./operations.js";
import { AdminError } from "./permissions.js";
import type { AuditContext } from "./store.js";
import { users } from "@stock-arena/db";

export function registerAdminFlyer(
  app: FastifyInstance,
  options: { database: () => DatabaseConnection; context: (req: FastifyRequest) => AuditContext },
) {
  const db = () => options.database().db;
  app.get("/api/admin/flyer", { config: { adminPermission: "players:read" } }, async (req) => {
    const input = z
      .object({
        userId: z.string().uuid(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .strict()
      .safeParse(req.query);
    if (!input.success) throw new AuthError("INVALID_INPUT", 400);
    const rows = await db()
      .select({
        id: flyerSessions.id,
        userId: flyerSessions.userId,
        startedAt: flyerSessions.startedAt,
        finishedAt: flyerSessions.finishedAt,
        state: flyerSessions.state,
        score: flyerSessions.score,
        day: flyerSessions.day,
        ticks: flyerSessions.ticks,
      })
      .from(flyerSessions)
      .where(eq(flyerSessions.userId, input.data.userId))
      .orderBy(desc(flyerSessions.startedAt), flyerSessions.id)
      .limit(26)
      .offset((input.data.page - 1) * 25);
    return { entries: rows.slice(0, 25), page: input.data.page, hasMore: rows.length > 25 };
  });
  app.post(
    "/api/admin/flyer/void",
    { config: { adminPermission: "points:write" } },
    async (req) => {
      const input = z
        .object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(2000) })
        .strict()
        .safeParse(req.body);
      if (!input.success || !z.object({}).strict().safeParse(req.query).success)
        throw new AuthError("INVALID_INPUT", 400);
      return db().transaction(async (tx) => {
        const ctx = options.context(req);
        await activeActor(tx, ctx, "points:write");
        const [candidate] = await tx
          .select()
          .from(flyerSessions)
          .where(eq(flyerSessions.id, input.data.id));
        if (!candidate) throw new AdminError("NOT_FOUND", 404);
        await tx.select().from(users).where(eq(users.id, candidate.userId)).for("no key update");
        const [before] = await tx
          .select()
          .from(flyerSessions)
          .where(eq(flyerSessions.id, candidate.id))
          .for("update");
        if (!before) throw new AdminError("NOT_FOUND", 404);
        if (before.state === "void") return { ok: true };
        await tx
          .update(flyerSessions)
          .set({ state: "void" })
          .where(eq(flyerSessions.id, before.id));
        let correction = 0;
        if (before.day) {
          const totals = await flyerDayTotals(tx, before.userId, before.day);
          correction =
            Math.min(
              GAME_CONFIG.flyer.dailyPointsCap,
              totals.best * GAME_CONFIG.flyer.pointsPerPipe,
            ) - totals.pointsToday;
          if (correction < 0)
            await tx.insert(pointsLedger).values({
              userId: before.userId,
              amount: correction,
              reason: "admin_adjustment",
              refId: `flyer-void:${before.day}:${before.id}`,
              createdAt: ctx.now,
            });
        }
        await event(tx, ctx, "flyer.voided", "flyer", before.id, before.userId, {
          reason: input.data.reason,
          before: before.state,
          correction,
        });
        return { ok: true };
      });
    },
  );
}
