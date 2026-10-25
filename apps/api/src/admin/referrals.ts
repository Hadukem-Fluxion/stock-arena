import { inviteCodes, pointsLedger, referrals, users } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError } from "../auth/types.js";
import { activeActor, event } from "./operations.js";
import { AdminError } from "./permissions.js";
import type { AuditContext } from "./store.js";

export function registerAdminReferrals(
  app: FastifyInstance,
  options: {
    database: () => DatabaseConnection;
    context: (req: FastifyRequest) => AuditContext;
  },
) {
  const db = () => options.database().db;
  const query = z
    .object({
      inviter: z.string().uuid().optional(),
      invitee: z.string().uuid().optional(),
      status: z.enum(["pending", "rewarded", "void"]).optional(),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    })
    .strict();
  app.get(
    "/api/admin/referrals",
    { config: { adminPermission: "referrals:read" } },
    async (req) => {
      const parsed = query.safeParse(req.query);
      if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
      const input = parsed.data,
        inviter = alias(users, "inviter"),
        invitee = alias(users, "invitee");
      const rows = await db()
        .select({
          inviterId: referrals.inviterId,
          inviteeId: referrals.inviteeId,
          inviterName: inviter.displayName,
          inviteeName: invitee.displayName,
          code: referrals.code,
          platform: referrals.platform,
          status: referrals.status,
          createdAt: referrals.createdAt,
          qualifiedAt: referrals.qualifiedAt,
        })
        .from(referrals)
        .innerJoin(inviter, eq(inviter.id, referrals.inviterId))
        .innerJoin(invitee, eq(invitee.id, referrals.inviteeId))
        .where(
          and(
            input.inviter ? eq(referrals.inviterId, input.inviter) : undefined,
            input.invitee ? eq(referrals.inviteeId, input.invitee) : undefined,
            input.status ? eq(referrals.status, input.status) : undefined,
          ),
        )
        .orderBy(desc(referrals.createdAt), referrals.inviteeId)
        .limit(26)
        .offset((input.page - 1) * 25);
      return { entries: rows.slice(0, 25), page: input.page, hasMore: rows.length > 25 };
    },
  );
  app.post(
    "/api/admin/referrals/void",
    { config: { adminPermission: "referrals:write" } },
    async (req) => {
      const parsed = z
        .object({ inviteeId: z.string().uuid(), reason: z.string().trim().min(1).max(2000) })
        .strict()
        .safeParse(req.body);
      if (!parsed.success || !z.object({}).strict().safeParse(req.query).success)
        throw new AuthError("INVALID_INPUT", 400);
      const input = parsed.data;
      return db().transaction(async (tx) => {
        const ctx = options.context(req);
        await activeActor(tx, ctx, "referrals:write");
        const [candidate] = await tx
          .select()
          .from(referrals)
          .where(eq(referrals.inviteeId, input.inviteeId));
        if (!candidate) throw new AdminError("NOT_FOUND", 404);
        // Same code -> referral lock order as check-in qualification.
        await tx
          .select()
          .from(inviteCodes)
          .where(eq(inviteCodes.userId, candidate.inviterId))
          .for("update");
        const [before] = await tx
          .select()
          .from(referrals)
          .where(eq(referrals.inviteeId, input.inviteeId))
          .for("update");
        if (!before || before.status === "void") return { ok: true };
        const awards = await tx
          .select()
          .from(pointsLedger)
          .where(
            and(
              eq(pointsLedger.reason, "referral"),
              eq(pointsLedger.refId, `ref:${input.inviteeId}`),
              sql`${pointsLedger.userId} IN (${before.inviterId}, ${before.inviteeId})`,
            ),
          );
        if (awards.length)
          await tx.insert(pointsLedger).values(
            awards.map((award) => ({
              userId: award.userId,
              amount: -award.amount,
              reason: "admin_adjustment",
              refId: award.refId,
              createdAt: ctx.now,
            })),
          );
        await tx
          .update(referrals)
          .set({ status: "void" })
          .where(eq(referrals.inviteeId, input.inviteeId));
        await event(tx, ctx, "referral.voided", "referral", input.inviteeId, input.inviteeId, {
          reason: input.reason,
          before: before.status,
          reversedAwards: awards.map((a) => ({ userId: a.userId, amount: -a.amount })),
        });
        return { ok: true };
      });
    },
  );
}
