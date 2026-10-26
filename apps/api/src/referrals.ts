import { randomBytes } from "node:crypto";
import {
  checkins,
  gamePaused,
  hlRuns,
  flyerSessions,
  inviteCodes,
  pointsLedger,
  quizAttempts,
  referrals,
  users,
} from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError } from "./auth/types.js";
import { GameControlError } from "./game-control.js";

export type ReferralTx = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];
export const referralCode = z.string().regex(/^ref_[A-Za-z0-9_-]{16,64}$/);
export class ReferralError extends Error {
  readonly statusCode = 409;
  constructor(public readonly code: "INVITE_INVALID" | "INVITE_INELIGIBLE" | "INVITE_CLAIMED") {
    super(code);
  }
}

export async function ensureInviteCode(tx: ReferralTx, userId: string) {
  const [existing] = await tx.select().from(inviteCodes).where(eq(inviteCodes.userId, userId));
  if (existing) return existing.code;
  // Conflict handling also covers a concurrent read for the same player.
  await tx
    .insert(inviteCodes)
    .values({ userId, code: `ref_${randomBytes(18).toString("base64url")}` })
    .onConflictDoNothing();
  const [created] = await tx.select().from(inviteCodes).where(eq(inviteCodes.userId, userId));
  if (!created) throw new Error("Invite code could not be created.");
  return created.code;
}

export async function claimReferral(
  tx: ReferralTx,
  userId: string,
  code: string,
  platform: "discord" | "telegram",
  now: Date,
) {
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("no key update");
  if (!user || user.status !== "active") throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
  if (await gamePaused(tx, "invite")) throw new GameControlError();
  const [existing] = await tx.select().from(referrals).where(eq(referrals.inviteeId, userId));
  if (existing) throw new ReferralError("INVITE_CLAIMED");
  if (now < user.createdAt || now.getTime() - user.createdAt.getTime() >= 86_400_000)
    throw new ReferralError("INVITE_INELIGIBLE");
  const played = await tx.execute<{ played: boolean }>(sql`SELECT
    EXISTS(SELECT 1 FROM ${checkins} WHERE user_id = ${userId}) OR
    EXISTS(SELECT 1 FROM ${quizAttempts} WHERE user_id = ${userId}) OR
    EXISTS(SELECT 1 FROM ${hlRuns} WHERE user_id = ${userId}) OR
    EXISTS(SELECT 1 FROM ${flyerSessions} WHERE user_id = ${userId}) OR
    EXISTS(SELECT 1 FROM ${pointsLedger} WHERE user_id = ${userId}) AS played`);
  if (played.rows[0]?.played) throw new ReferralError("INVITE_INELIGIBLE");
  const [inviter] = await tx
    .select({ id: inviteCodes.userId, status: users.status })
    .from(inviteCodes)
    .innerJoin(users, eq(users.id, inviteCodes.userId))
    .where(eq(inviteCodes.code, code))
    .for("key share");
  if (!inviter || inviter.id === userId || inviter.status !== "active")
    throw new ReferralError("INVITE_INVALID");
  await tx
    .insert(referrals)
    .values({ inviterId: inviter.id, inviteeId: userId, code, platform, createdAt: now });
}

export function registerReferrals(
  app: FastifyInstance,
  options: {
    database: () => DatabaseConnection;
    now: () => Date;
    env: Record<string, string | undefined>;
  },
) {
  app.get("/api/referral", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!req.user) throw new AuthError("UNAUTHORIZED", 401);
    if (!z.object({}).strict().safeParse(req.query).success)
      throw new AuthError("INVALID_INPUT", 400);
    return options.database().db.transaction(async (tx) => {
      const userId = req.user!.id,
        code = await ensureInviteCode(tx, userId);
      const [counts] = await tx
        .select({ joined: sql<number>`count(*)::int` })
        .from(referrals)
        .where(and(eq(referrals.inviterId, userId), sql`${referrals.status} <> 'void'`));
      const [earned] = await tx
        .select({ points: sql<number>`coalesce(sum(amount),0)::int` })
        .from(pointsLedger)
        .where(
          and(
            eq(pointsLedger.userId, userId),
            sql`EXISTS(SELECT 1 FROM referrals r WHERE r.inviter_id = ${userId} AND ${pointsLedger.refId} = 'ref:' || r.invitee_id::text)`,
            sql`${pointsLedger.reason} IN ('referral','admin_adjustment')`,
          ),
        );
      const [claim] = await tx
        .select({ status: referrals.status })
        .from(referrals)
        .where(eq(referrals.inviteeId, userId));
      const bot = z
        .string()
        .regex(/^[A-Za-z0-9_]{5,32}$/)
        .safeParse(options.env.TELEGRAM_BOT_USERNAME);
      const discordId = z
        .string()
        .regex(/^\d{10,25}$/)
        .safeParse(options.env.DISCORD_CLIENT_ID);
      return {
        code,
        joined: counts?.joined ?? 0,
        points: earned?.points ?? 0,
        claim: claim?.status ?? null,
        maintenance: await gamePaused(tx, "invite"),
        telegramUrl: bot.success ? `https://t.me/${bot.data}?startapp=${code}` : null,
        discordUrl: discordId.success
          ? `https://discord.com/activities/${discordId.data}?custom_id=${code}`
          : null,
      };
    });
  });
  app.post("/api/referral/claim", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!req.user) throw new AuthError("UNAUTHORIZED", 401);
    const input = z.object({ code: referralCode }).strict().safeParse(req.body);
    if (!input.success || !z.object({}).strict().safeParse(req.query).success)
      throw new AuthError("INVALID_INPUT", 400);
    await options
      .database()
      .db.transaction((tx) =>
        claimReferral(
          tx,
          req.user!.id,
          input.data.code,
          req.user!.identity.platform,
          options.now(),
        ),
      );
    return { ok: true };
  });
}
