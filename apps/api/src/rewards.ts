import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAddress } from "viem/utils";
import {
  rewardControl,
  rewardDestinationHistory,
  rewardDestinations,
  rewardLocks,
  users,
} from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { AuthError } from "./auth/types.js";
import { AdminError } from "./admin/permissions.js";

export type RewardTx = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];
export const destinationInput = z
  .object({
    bybitUid: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{5,12}$/.test(v)),
    mantleAddress: z
      .string()
      .trim()
      .refine((v) => {
        if (v === "") return true;
        if (!/^0x[\da-fA-F]{40}$/.test(v)) return false;
        const letters = v.slice(2);
        return (
          letters === letters.toLowerCase() ||
          letters === letters.toUpperCase() ||
          getAddress(v) === v
        );
      })
      .transform((v) => (v ? getAddress(v) : "")),
    confirmed: z.literal(true),
    expectedChangedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export function rewardParse<O, I>(schema: z.ZodType<O, z.ZodTypeDef, I>, value: unknown): O {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
  return parsed.data;
}
export function masked(value: string) {
  return value ? `••••${value.slice(-4)}` : "";
}
export function maskedDestination(value: { bybitUid: string; mantleAddress: string }) {
  return { bybitUid: masked(value.bybitUid), mantleAddress: masked(value.mantleAddress) };
}
export async function lockRewards(tx: RewardTx, exclusive = false) {
  const [control] = await tx
    .select()
    .from(rewardControl)
    .where(eq(rewardControl.id, 1))
    .for(exclusive ? "update" : "share");
  if (!control) throw new Error("Reward control is not configured.");
}
export async function saveDestination(
  tx: RewardTx,
  userId: string,
  input: z.infer<typeof destinationInput>,
  now: Date,
  actorId = userId,
  actor: "player" | "staff" = "player",
) {
  // Lock order is shared control -> player; season payout locks serialize with registration.
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
  if (!user) throw new AdminError("NOT_FOUND", 404);
  if (actor === "player" && user.status !== "active")
    throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
  const locks = await tx.select().from(rewardLocks).where(eq(rewardLocks.locked, true));
  if (locks.length) throw new AdminError("REWARDS_LOCKED");
  const [before] = await tx
    .select()
    .from(rewardDestinations)
    .where(eq(rewardDestinations.userId, userId));
  if (
    (before?.changedAt.toISOString() ?? null) !==
    (input.expectedChangedAt ? new Date(input.expectedChangedAt).toISOString() : null)
  )
    throw new AdminError("REQUEST_CONFLICT");
  const after = { bybitUid: input.bybitUid, mantleAddress: input.mantleAddress };
  if (before && before.bybitUid === after.bybitUid && before.mantleAddress === after.mantleAddress)
    return false;
  const changedAt = new Date(Math.max(now.getTime(), (before?.changedAt.getTime() ?? -1) + 1));
  await tx
    .insert(rewardDestinations)
    .values({ userId, ...after, changedAt })
    .onConflictDoUpdate({ target: rewardDestinations.userId, set: { ...after, changedAt } });
  await tx.insert(rewardDestinationHistory).values({
    userId,
    actorId,
    actor,
    oldValues: maskedDestination(before ?? { bybitUid: "", mantleAddress: "" }),
    newValues: maskedDestination(after),
    changedAt,
  });
  return true;
}
export function registerRewardProfile(
  app: FastifyInstance,
  options: { database: () => DatabaseConnection; now?: () => Date },
) {
  const now = options.now ?? (() => new Date());
  app.get("/api/rewards/destination", async (req, reply) => {
    rewardParse(z.object({}).strict(), req.query);
    reply.header("Cache-Control", "no-store");
    if (!req.user) throw new AuthError("UNAUTHORIZED", 401);
    return options.database().db.transaction(async (tx) => {
      await lockRewards(tx);
      const [row] = await tx
        .select()
        .from(rewardDestinations)
        .where(eq(rewardDestinations.userId, req.user!.id));
      const locks = await tx
        .select({ seasonId: rewardLocks.seasonId })
        .from(rewardLocks)
        .where(eq(rewardLocks.locked, true));
      const history = await tx
        .select({
          id: rewardDestinationHistory.id,
          oldValues: rewardDestinationHistory.oldValues,
          newValues: rewardDestinationHistory.newValues,
          changedAt: rewardDestinationHistory.changedAt,
          actor: rewardDestinationHistory.actor,
        })
        .from(rewardDestinationHistory)
        .where(eq(rewardDestinationHistory.userId, req.user!.id))
        .orderBy(desc(rewardDestinationHistory.changedAt), desc(rewardDestinationHistory.id))
        .limit(25);
      return {
        bybitUid: row?.bybitUid ?? "",
        mantleAddress: row?.mantleAddress ?? "",
        changedAt: row?.changedAt ?? null,
        locked: locks.length > 0,
        lockedSeasons: locks.map((l) => l.seasonId),
        history,
      };
    });
  });
  app.post("/api/rewards/destination", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    rewardParse(z.object({}).strict(), req.query);
    const input = rewardParse(destinationInput, req.body);
    if (!req.user) throw new AuthError("UNAUTHORIZED", 401);
    await options.database().db.transaction(async (tx) => {
      await lockRewards(tx);
      await saveDestination(tx, req.user!.id, input, now());
    });
    return { ok: true };
  });
}
