import { identities, users } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { and, eq } from "drizzle-orm";
import { AuthError } from "./types.js";
import type { AuthenticatedUser, VerifiedIdentity } from "./types.js";
import { claimReferral, ReferralError } from "../referrals.js";
import { GameControlError } from "../game-control.js";

export function createIdentityStore(connection: DatabaseConnection) {
  const selectIdentity = {
    id: users.id,
    displayName: users.displayName,
    avatarUrl: users.avatarUrl,
    status: users.status,
  };
  function activeUser(
    user:
      | typeof users.$inferSelect
      | Pick<typeof users.$inferSelect, "id" | "displayName" | "avatarUrl" | "status">,
    identity: Pick<VerifiedIdentity, "platform" | "platformUserId">,
  ): AuthenticatedUser {
    if (user.status !== "active") throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
    return {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      identity: { platform: identity.platform, platformUserId: identity.platformUserId },
    };
  }
  return {
    async login(
      identity: VerifiedIdentity,
      invite?: { code?: string; now: Date },
    ): Promise<AuthenticatedUser> {
      return connection.db.transaction(async (tx) => {
        const identityWhere = and(
          eq(identities.platform, identity.platform),
          eq(identities.platformUserId, identity.platformUserId),
        );
        const [existing] = await tx
          .select(selectIdentity)
          .from(identities)
          .innerJoin(users, eq(users.id, identities.userId))
          .where(identityWhere);
        if (existing) return activeUser(existing, identity);
        const [created] = await tx
          .insert(users)
          .values({
            displayName: identity.displayName,
            avatarUrl: identity.avatarUrl,
            ...(invite ? { createdAt: invite.now } : {}),
          })
          .returning();
        if (!created) throw new AuthError("INTERNAL_ERROR", 500);
        const inserted = await tx
          .insert(identities)
          .values({
            userId: created.id,
            platform: identity.platform,
            platformUserId: identity.platformUserId,
            platformCreatedAt: identity.platformCreatedAt,
          })
          .onConflictDoNothing()
          .returning();
        if (inserted.length) {
          if (invite?.code) {
            // An invalid/paused invite never prevents an otherwise valid login.
            try {
              await claimReferral(tx, created.id, invite.code, identity.platform, invite.now);
            } catch (error) {
              if (!(error instanceof ReferralError || error instanceof GameControlError))
                throw error;
            }
          }
          return activeUser(created, identity);
        }
        // Another login won the unique identity race; discard only this unused user.
        await tx.delete(users).where(eq(users.id, created.id));
        const [winner] = await tx
          .select(selectIdentity)
          .from(identities)
          .innerJoin(users, eq(users.id, identities.userId))
          .where(identityWhere);
        if (!winner) throw new AuthError("INTERNAL_ERROR", 500);
        return activeUser(winner, identity);
      });
    },
    async find(
      userId: string,
      identity: Pick<VerifiedIdentity, "platform" | "platformUserId">,
    ): Promise<AuthenticatedUser> {
      const [user] = await connection.db
        .select(selectIdentity)
        .from(identities)
        .innerJoin(users, eq(users.id, identities.userId))
        .where(
          and(
            eq(identities.platform, identity.platform),
            eq(identities.platformUserId, identity.platformUserId),
            eq(identities.userId, userId),
          ),
        );
      if (!user) throw new AuthError("UNAUTHORIZED", 401);
      return activeUser(user, identity);
    },
  };
}
