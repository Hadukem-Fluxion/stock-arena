import {
  adminActions,
  adminControl,
  adminSessions,
  identities,
  staff,
  users,
} from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { en } from "../../../web/src/copy/en.js";
import { AuthError } from "../auth/types.js";
import { AdminError } from "./permissions.js";
import type { Role } from "./permissions.js";

type Transaction = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];
export type Actor = { userId: string; displayName: string; role: Role };
export type AuditContext = { actor: Actor; ipHash: string; now: Date; tokenHash?: string };

export async function lockTeam(tx: Transaction) {
  await tx.select().from(adminControl).where(eq(adminControl.id, 1)).for("update");
}
export async function audit(
  tx: Transaction,
  context: AuditContext,
  action: string,
  targetUserId: string | null,
  details: Record<string, unknown> = {},
) {
  await tx.insert(adminActions).values({
    adminId: context.actor.userId,
    action,
    targetUserId,
    reason: action,
    targetType: targetUserId ? "staff" : "system",
    targetId: targetUserId,
    details,
    ipHash: context.ipHash,
    createdAt: context.now,
  });
}
async function owner(tx: Transaction, actor: Actor) {
  const [current] = await tx
    .select()
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId))
    .where(and(eq(staff.userId, actor.userId), isNull(staff.revokedAt)));
  if (!current || current.staff.role !== "owner" || current.users.status !== "active")
    throw new AuthError("FORBIDDEN", 403);
}
async function guardLastOwner(
  tx: Transaction,
  target: typeof staff.$inferSelect,
  nextRole: Role | null,
) {
  if (target.role !== "owner" || target.revokedAt || nextRole === "owner") return;
  const owners = await tx
    .select({ id: staff.userId })
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId))
    .where(and(eq(staff.role, "owner"), isNull(staff.revokedAt), eq(users.status, "active")));
  if (owners.some((entry) => entry.id === target.userId) && owners.length <= 1)
    throw new AdminError("LAST_OWNER");
}
async function invalidate(tx: Transaction, userId: string, now: Date) {
  await tx
    .update(adminSessions)
    .set({ revokedAt: now })
    .where(and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)));
}

export function createTeamStore(database: () => DatabaseConnection) {
  return {
    async list() {
      return database()
        .db.select({
          userId: staff.userId,
          role: staff.role,
          grantedBy: staff.grantedBy,
          grantedAt: staff.grantedAt,
          revokedAt: staff.revokedAt,
          displayName: users.displayName,
          discordId: identities.platformUserId,
        })
        .from(staff)
        .innerJoin(users, eq(users.id, staff.userId))
        .innerJoin(
          identities,
          and(eq(identities.userId, staff.userId), eq(identities.platform, "discord")),
        )
        .orderBy(staff.grantedAt, staff.userId);
    },
    async grant(
      context: AuditContext,
      input: { discordId: string; role: Role; confirmation?: string },
    ) {
      return database().db.transaction(async (tx) => {
        await lockTeam(tx);
        await owner(tx, context.actor);
        let [target] = await tx
          .select({ id: users.id, displayName: users.displayName, status: users.status })
          .from(identities)
          .innerJoin(users, eq(users.id, identities.userId))
          .where(
            and(eq(identities.platform, "discord"), eq(identities.platformUserId, input.discordId)),
          );
        if (!target) {
          const [created] = await tx
            .insert(users)
            .values({ displayName: en.admin.pendingName(input.discordId) })
            .returning();
          if (!created) throw new AuthError("INTERNAL_ERROR", 500);
          // A concurrent player login may already have claimed this identity.
          const inserted = await tx
            .insert(identities)
            .values({
              userId: created.id,
              platform: "discord",
              platformUserId: input.discordId,
              platformCreatedAt: new Date(
                Number((BigInt(input.discordId) >> 22n) + 1420070400000n),
              ),
            })
            .onConflictDoNothing()
            .returning();
          if (!inserted.length) {
            await tx.delete(users).where(eq(users.id, created.id));
            [target] = await tx
              .select({ id: users.id, displayName: users.displayName, status: users.status })
              .from(identities)
              .innerJoin(users, eq(users.id, identities.userId))
              .where(
                and(
                  eq(identities.platform, "discord"),
                  eq(identities.platformUserId, input.discordId),
                ),
              );
          } else target = created;
        }
        if (!target) throw new AuthError("INTERNAL_ERROR", 500);
        if (input.role === "owner" && target.status !== "active")
          throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
        if (input.role === "owner" && input.confirmation !== target.displayName)
          throw new AdminError("CONFIRMATION_REQUIRED");
        const [previous] = await tx.select().from(staff).where(eq(staff.userId, target.id));
        if (previous) await guardLastOwner(tx, previous, input.role);
        await tx
          .insert(staff)
          .values({
            userId: target.id,
            role: input.role,
            grantedBy: context.actor.userId,
            grantedAt: context.now,
          })
          .onConflictDoUpdate({
            target: staff.userId,
            set: {
              role: input.role,
              grantedBy: context.actor.userId,
              grantedAt: context.now,
              revokedAt: null,
            },
          });
        await invalidate(tx, target.id, context.now);
        await audit(
          tx,
          context,
          previous && !previous.revokedAt ? "team.role_changed" : "team.granted",
          target.id,
          { before: previous?.revokedAt ? null : (previous?.role ?? null), after: input.role },
        );
        return { ok: true };
      });
    },
    async revoke(context: AuditContext, userId: string) {
      return database().db.transaction(async (tx) => {
        await lockTeam(tx);
        await owner(tx, context.actor);
        const [target] = await tx
          .select()
          .from(staff)
          .where(and(eq(staff.userId, userId), isNull(staff.revokedAt)));
        if (!target) throw new AdminError("MEMBER_NOT_FOUND", 404);
        await guardLastOwner(tx, target, null);
        await tx.update(staff).set({ revokedAt: context.now }).where(eq(staff.userId, userId));
        await invalidate(tx, userId, context.now);
        await audit(tx, context, "team.revoked", userId, { before: target.role });
        return { ok: true };
      });
    },
    async transfer(context: AuditContext, userId: string, confirmation: string) {
      return database().db.transaction(async (tx) => {
        await lockTeam(tx);
        await owner(tx, context.actor);
        const [target] = await tx
          .select({ name: users.displayName, role: staff.role })
          .from(staff)
          .innerJoin(users, eq(users.id, staff.userId))
          .where(
            and(eq(staff.userId, userId), isNull(staff.revokedAt), eq(users.status, "active")),
          );
        if (!target || userId === context.actor.userId)
          throw new AdminError("MEMBER_NOT_FOUND", 404);
        if (confirmation !== target.name) throw new AdminError("CONFIRMATION_REQUIRED");
        await tx
          .update(staff)
          .set({ role: "owner", grantedBy: context.actor.userId, grantedAt: context.now })
          .where(eq(staff.userId, userId));
        await tx
          .update(staff)
          .set({ role: "admin", grantedBy: context.actor.userId, grantedAt: context.now })
          .where(eq(staff.userId, context.actor.userId));
        await invalidate(tx, userId, context.now);
        await invalidate(tx, context.actor.userId, context.now);
        await audit(tx, context, "team.ownership_transferred", userId, {
          previousOwner: context.actor.userId,
          previousTargetRole: target.role,
          previousOwnerRole: "admin",
        });
        return { ok: true };
      });
    },
  };
}

export const auditOrder = sql`${adminActions.createdAt} DESC, ${adminActions.id} DESC`;
