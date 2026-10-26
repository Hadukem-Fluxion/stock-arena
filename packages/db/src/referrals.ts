import { GAME_CONFIG, gameDay } from "@stock-arena/game-core";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DatabaseConnection } from "./client.js";
import { gamePaused } from "./controls.js";
import { checkins, inviteCodes, pointsLedger, referrals, users } from "./schema.js";

type Tx = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];

/** Call after a game award in the same transaction; lock the invitee with NO KEY UPDATE.
 * This serializes their actions while allowing FK KEY SHARE checks for concurrent
 * referral credits (including mutual referrals) and audited reversals.
 */
export async function rewardReferral(tx: Tx, inviteeId: string, now: Date) {
  const [candidate] = await tx.select().from(referrals).where(eq(referrals.inviteeId, inviteeId));
  if (!candidate || candidate.status === "void") return;
  if (await gamePaused(tx, "invite")) return;
  // Different invitees share this gate. Never lock the inviter's user row: two
  // players can invite each other, and game actions already lock their own user.
  await tx
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.userId, candidate.inviterId))
    .for("update");
  const [current] = await tx
    .select()
    .from(referrals)
    .where(eq(referrals.inviteeId, inviteeId))
    .for("update");
  if (!current || current.status === "void") return;
  const [inviter] = await tx
    .select()
    .from(users)
    .where(eq(users.id, current.inviterId))
    .for("key share");
  if (inviter?.status !== "active") return;
  const [checkedIn] = await tx
    .select()
    .from(checkins)
    .where(eq(checkins.userId, inviteeId))
    .limit(1);
  if (checkedIn && !current.inviteeBonusAt) {
    await tx.insert(pointsLedger).values({
      userId: inviteeId,
      amount: GAME_CONFIG.referrals.pointsPerInvitee,
      reason: "referral",
      refId: `ref:${inviteeId}`,
      createdAt: now,
    });
    await tx
      .update(referrals)
      .set({ inviteeBonusAt: now })
      .where(eq(referrals.inviteeId, inviteeId));
  }
  if (current.status === "rewarded") return;
  const gameReasons = [
    "checkin",
    "quiz",
    "higher_lower",
    "flyer_best",
    ...GAME_CONFIG.checkin.streakBonuses.map((b) => `streak_bonus_${b.day}`),
  ];
  const [earned] = await tx
    .select({ points: sql<string>`coalesce(sum(${pointsLedger.amount}),0)::text` })
    .from(pointsLedger)
    .where(and(eq(pointsLedger.userId, inviteeId), inArray(pointsLedger.reason, gameReasons)));
  if (BigInt(earned?.points ?? "0") < BigInt(GAME_CONFIG.referrals.qualifyingGamePoints)) return;
  const start = new Date(`${gameDay(now)}T00:00:00Z`),
    end = new Date(start.getTime() + 86_400_000);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(referrals)
    .where(
      and(
        eq(referrals.inviterId, current.inviterId),
        gte(referrals.qualifiedAt, start),
        lt(referrals.qualifiedAt, end),
      ),
    );
  // A capped claim stays pending; a later game action can retry on a new UTC day.
  // Voids retain qualifiedAt so reversing an award never frees daily quota.
  if ((count?.n ?? 0) >= GAME_CONFIG.referrals.maxRewardsPerDay) return;
  await tx.insert(pointsLedger).values({
    userId: current.inviterId,
    amount: GAME_CONFIG.referrals.pointsPerQualifiedFriend,
    reason: "referral",
    refId: `ref:${inviteeId}`,
    createdAt: now,
  });
  await tx
    .update(referrals)
    .set({ status: "rewarded", qualifiedAt: now })
    .where(eq(referrals.inviteeId, inviteeId));
}
