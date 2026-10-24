import { asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  rewardDestinationHistory,
  rewardDestinations,
  rewardEntries,
  rewardEvents,
  rewardLocks,
  rewardPrizes,
  rewardSnapshots,
  seasons,
  users,
} from "@stock-arena/db";
import type { DatabaseConnection, RewardIdentity } from "@stock-arena/db";
import {
  destinationInput,
  lockRewards,
  maskedDestination,
  rewardParse as parse,
  saveDestination,
} from "../rewards.js";
import type { RewardTx } from "../rewards.js";
import { activeActor, event } from "./operations.js";
import { AdminError } from "./permissions.js";
import type { Permission } from "./permissions.js";
import type { AuditContext } from "./store.js";

const reason = z.string().trim().min(1).max(2000),
  seasonId = z.string().min(1).max(100);
const seasonQuery = z.object({ seasonId }).strict();
const empty = z.object({}).strict();
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value !== "number" && (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)))
    text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function registerRewards(
  app: FastifyInstance,
  options: {
    database: () => DatabaseConnection;
    now: () => Date;
    context: (req: FastifyRequest) => AuditContext;
  },
) {
  const db = () => options.database().db;
  const write = (
    req: FastifyRequest,
    permission: Permission,
    fn: (tx: RewardTx, ctx: AuditContext) => Promise<unknown>,
  ) =>
    db().transaction(async (tx) => {
      const ctx = options.context(req);
      await activeActor(tx, ctx, permission);
      await lockRewards(tx, true);
      return fn(tx, ctx);
    });
  async function entries(tx: RewardTx, id: string) {
    const rows = await tx
      .select()
      .from(rewardEntries)
      .where(eq(rewardEntries.seasonId, id))
      .orderBy(asc(rewardEntries.rank));
    if (!rows.length) return [];
    const events = await tx
      .selectDistinctOn([rewardEvents.entryId])
      .from(rewardEvents)
      .where(
        inArray(
          rewardEvents.entryId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(rewardEvents.entryId, desc(rewardEvents.version));
    const byEntry = new Map(events.map((e) => [e.entryId, e]));
    return rows.map((row) => ({ ...row, event: byEntry.get(row.id)! }));
  }
  app.get("/api/admin/rewards", { config: { adminPermission: "rewards:read" } }, async (req) => {
    parse(empty, req.query);
    return { seasons: await db().select().from(seasons).orderBy(desc(seasons.startsAt)) };
  });
  app.get(
    "/api/admin/rewards/season",
    { config: { adminPermission: "rewards:read" } },
    async (req) => {
      const q = parse(seasonQuery, req.query);
      return db().transaction(async (tx) => {
        await lockRewards(tx);
        const [season] = await tx.select().from(seasons).where(eq(seasons.id, q.seasonId));
        if (!season) throw new AdminError("NOT_FOUND", 404);
        const [snapshot] = await tx
          .select()
          .from(rewardSnapshots)
          .where(eq(rewardSnapshots.seasonId, q.seasonId));
        const [lock] = await tx
          .select()
          .from(rewardLocks)
          .where(eq(rewardLocks.seasonId, q.seasonId));
        const prizes = await tx
          .select()
          .from(rewardPrizes)
          .where(eq(rewardPrizes.seasonId, q.seasonId))
          .orderBy(rewardPrizes.rankFrom);
        const rows = await entries(tx, q.seasonId);
        return {
          season,
          snapshot: snapshot ?? null,
          locked: lock?.locked ?? false,
          prizes,
          entries: rows,
        };
      });
    },
  );
  app.post(
    "/api/admin/rewards/prizes",
    { config: { adminPermission: "rewards:write" } },
    async (req) => {
      parse(empty, req.query);
      const input = parse(
        z
          .object({
            seasonId,
            rankFrom: z.number().int().positive().max(10000),
            rankTo: z.number().int().positive().max(10000),
            description: z.string().trim().min(1).max(2000),
            reason,
          })
          .strict()
          .refine((v) => v.rankTo >= v.rankFrom),
        req.body,
      );
      return write(req, "rewards:write", async (tx, ctx) => {
        const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId));
        if (!season) throw new AdminError("NOT_FOUND", 404);
        const [snapshot] = await tx
          .select()
          .from(rewardSnapshots)
          .where(eq(rewardSnapshots.seasonId, input.seasonId));
        if (snapshot) throw new AdminError("REWARDS_FROZEN");
        const bands = await tx
          .select()
          .from(rewardPrizes)
          .where(eq(rewardPrizes.seasonId, input.seasonId));
        if (bands.some((b) => b.rankFrom <= input.rankTo && input.rankFrom <= b.rankTo))
          throw new AdminError("PRIZE_OVERLAP");
        const [row] = await tx
          .insert(rewardPrizes)
          .values({
            seasonId: input.seasonId,
            rankFrom: input.rankFrom,
            rankTo: input.rankTo,
            description: input.description,
            createdAt: ctx.now,
          })
          .returning();
        await event(tx, ctx, "reward.prize_added", "reward_prize", row!.id, null, { ...input });
        return { ok: true };
      });
    },
  );
  app.post(
    "/api/admin/rewards/freeze",
    { config: { adminPermission: "rewards:write" } },
    async (req) => {
      parse(empty, req.query);
      const input = parse(
        z.object({ seasonId, topN: z.number().int().positive().max(10000), reason }).strict(),
        req.body,
      );
      return write(req, "rewards:write", async (tx, ctx) => {
        const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId));
        if (!season) throw new AdminError("NOT_FOUND", 404);
        if (!season.endsAt || season.endsAt > ctx.now) throw new AdminError("SEASON_NOT_ENDED");
        const [exists] = await tx
          .select()
          .from(rewardSnapshots)
          .where(eq(rewardSnapshots.seasonId, input.seasonId));
        if (exists) throw new AdminError("REWARDS_FROZEN");
        const prizes = await tx
          .select()
          .from(rewardPrizes)
          .where(eq(rewardPrizes.seasonId, input.seasonId));
        for (let rank = 1; rank <= input.topN; rank++)
          if (!prizes.some((p) => p.rankFrom <= rank && p.rankTo >= rank))
            throw new AdminError("PRIZE_MISSING");
        // Same score/first-attainment tie rules as the live leaderboard; a single
        // statement freezes score, name and identities without multiplying ledger rows.
        const result = await tx.execute<{
          user_id: string;
          display_name: string;
          score: string;
          rank: string;
          identities: RewardIdentity[];
        }>(sql`
        WITH running AS (
          SELECT l.user_id,l.created_at,u.display_name,
            sum(l.amount) OVER (PARTITION BY l.user_id ORDER BY l.created_at,l.id ROWS UNBOUNDED PRECEDING) AS running_score,
            sum(l.amount) OVER (PARTITION BY l.user_id) AS final_score
          FROM points_ledger l JOIN users u ON u.id=l.user_id
          WHERE l.created_at>=${season.startsAt.toISOString()}::timestamptz
            AND l.created_at<${season.endsAt.toISOString()}::timestamptz AND u.status='active'
        ), scores AS (
          SELECT user_id,display_name,final_score AS score,min(created_at) FILTER (WHERE running_score=final_score) AS reached_at
          FROM running GROUP BY user_id,display_name,final_score
        ), ranked AS (
          SELECT *,row_number() OVER (ORDER BY score DESC,reached_at ASC,user_id ASC) AS rank FROM scores
        ) SELECT user_id,display_name,score::text,rank::text,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('platform',i.platform,'platformUserId',i.platform_user_id) ORDER BY i.platform,i.platform_user_id) FROM identities i WHERE i.user_id=ranked.user_id),'[]'::jsonb) AS identities
        FROM ranked WHERE rank<=${input.topN} ORDER BY rank
      `);
        await tx.insert(rewardSnapshots).values({
          seasonId: season.id,
          seasonName: season.name,
          startsAt: season.startsAt,
          endsAt: season.endsAt,
          topN: input.topN,
          createdAt: ctx.now,
          createdBy: ctx.actor.userId,
        });
        const recipients = result.rows.map((row) => {
          const points = Number(row.score),
            rank = Number(row.rank);
          if (!Number.isSafeInteger(points)) throw new Error("Invalid reward score.");
          return {
            seasonId: season.id,
            userId: row.user_id,
            rank,
            points,
            displayName: row.display_name,
            identities: row.identities,
            prizeDescription: prizes.find((p) => p.rankFrom <= rank && p.rankTo >= rank)!
              .description,
          };
        });
        // Bound statement parameter counts without one network round-trip per recipient.
        for (let offset = 0; offset < recipients.length; offset += 500) {
          const inserted = await tx
            .insert(rewardEntries)
            .values(recipients.slice(offset, offset + 500))
            .returning();
          await tx.insert(rewardEvents).values(
            inserted.map((entry) => ({
              entryId: entry.id,
              version: 0,
              status: "pending" as const,
              note: input.reason,
              actorId: ctx.actor.userId,
              createdAt: ctx.now,
            })),
          );
        }
        await event(tx, ctx, "reward.snapshot_frozen", "reward_snapshot", season.id, null, {
          topN: input.topN,
          rowCount: result.rows.length,
          reason: input.reason,
          startsAt: season.startsAt,
          endsAt: season.endsAt,
        });
        return { ok: true };
      });
    },
  );
  app.post(
    "/api/admin/rewards/status",
    { config: { adminPermission: "rewards:write" } },
    async (req) => {
      parse(empty, req.query);
      const input = parse(
        z
          .object({
            entryId: z.string().uuid(),
            version: z.number().int().nonnegative(),
            status: z.enum(["approved", "delivered", "void"]),
            note: reason,
          })
          .strict(),
        req.body,
      );
      return write(req, "rewards:write", async (tx, ctx) => {
        const [entry] = await tx
          .select()
          .from(rewardEntries)
          .where(eq(rewardEntries.id, input.entryId));
        if (!entry) throw new AdminError("NOT_FOUND", 404);
        const [previous] = await tx
          .select()
          .from(rewardEvents)
          .where(eq(rewardEvents.entryId, entry.id))
          .orderBy(desc(rewardEvents.version))
          .limit(1);
        if (!previous || previous.version !== input.version)
          throw new AdminError("REQUEST_CONFLICT");
        const valid =
          previous.status === "pending"
            ? ["approved", "void"]
            : previous.status === "approved"
              ? ["delivered", "void"]
              : [];
        if (!valid.includes(input.status)) throw new AdminError("REWARD_TRANSITION");
        const [user] = await tx.select().from(users).where(eq(users.id, entry.userId)).for("share");
        if (input.status !== "void" && user?.status !== "active")
          throw new AdminError("PLAYER_INACTIVE");
        await tx.insert(rewardEvents).values({
          entryId: entry.id,
          version: previous.version + 1,
          status: input.status,
          note: input.note,
          actorId: ctx.actor.userId,
          createdAt: ctx.now,
        });
        await event(tx, ctx, "reward.status_changed", "reward_entry", entry.id, entry.userId, {
          before: previous.status,
          after: input.status,
          reason: input.note,
        });
        return { ok: true };
      });
    },
  );
  app.post(
    "/api/admin/rewards/lock",
    { config: { adminPermission: "rewards:write" } },
    async (req) => {
      parse(empty, req.query);
      const input = parse(z.object({ seasonId, locked: z.boolean(), reason }).strict(), req.body);
      return write(req, "rewards:write", async (tx, ctx) => {
        const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId));
        if (!season) throw new AdminError("NOT_FOUND", 404);
        const [before] = await tx
          .select()
          .from(rewardLocks)
          .where(eq(rewardLocks.seasonId, input.seasonId));
        await tx
          .insert(rewardLocks)
          .values({ seasonId: input.seasonId, locked: input.locked, updatedAt: ctx.now })
          .onConflictDoUpdate({
            target: rewardLocks.seasonId,
            set: { locked: input.locked, updatedAt: ctx.now },
          });
        await event(tx, ctx, "reward.destinations_locked", "season", input.seasonId, null, {
          before: before?.locked ?? false,
          after: input.locked,
          reason: input.reason,
        });
        return { ok: true };
      });
    },
  );
  app.get(
    "/api/admin/rewards/destinations",
    { config: { adminPermission: "rewards:read" } },
    async (req) => {
      const q = parse(
        z
          .object({
            search: z.string().trim().max(200).default(""),
            page: z.coerce.number().int().min(1).max(10000).default(1),
          })
          .strict(),
        req.query,
      );
      const full = req.admin!.role === "owner" || req.admin!.role === "admin";
      const rows = await db()
        .select({ id: users.id, displayName: users.displayName, destination: rewardDestinations })
        .from(users)
        .leftJoin(rewardDestinations, eq(users.id, rewardDestinations.userId))
        .where(ilike(users.displayName, `%${q.search.replace(/[\\%_]/g, "\\$&")}%`))
        .orderBy(users.displayName, users.id)
        .limit(26)
        .offset((q.page - 1) * 25);
      return {
        page: q.page,
        hasMore: rows.length > 25,
        entries: rows.slice(0, 25).map((r) => ({
          id: r.id,
          displayName: r.displayName,
          ...(full
            ? {
                bybitUid: r.destination?.bybitUid ?? "",
                mantleAddress: r.destination?.mantleAddress ?? "",
              }
            : maskedDestination(r.destination ?? { bybitUid: "", mantleAddress: "" })),
          changedAt: r.destination?.changedAt ?? null,
        })),
      };
    },
  );
  app.get(
    "/api/admin/rewards/destinations/:id",
    { config: { adminPermission: "rewards:read" } },
    async (req) => {
      parse(empty, req.query);
      const { id } = parse(z.object({ id: z.string().uuid() }).strict(), req.params);
      const history = await db()
        .select()
        .from(rewardDestinationHistory)
        .where(eq(rewardDestinationHistory.userId, id))
        .orderBy(desc(rewardDestinationHistory.changedAt), desc(rewardDestinationHistory.id))
        .limit(25);
      return { history };
    },
  );
  app.post(
    "/api/admin/rewards/destinations/:id",
    { config: { adminPermission: "rewards:write" } },
    async (req) => {
      parse(empty, req.query);
      const { id } = parse(z.object({ id: z.string().uuid() }).strict(), req.params);
      const body = parse(destinationInput.extend({ reason }), req.body);
      return write(req, "rewards:write", async (tx, ctx) => {
        await saveDestination(tx, id, body, ctx.now, ctx.actor.userId, "staff");
        await event(tx, ctx, "reward.destination_changed", "user", id, id, { reason: body.reason });
        return { ok: true };
      });
    },
  );
  app.post(
    "/api/admin/rewards/export",
    { config: { adminPermission: "rewards:export" } },
    async (req, reply) => {
      parse(empty, req.query);
      const input = parse(seasonQuery, req.body);
      const output = await write(req, "rewards:export", async (tx, ctx) => {
        const [snapshot] = await tx
          .select()
          .from(rewardSnapshots)
          .where(eq(rewardSnapshots.seasonId, input.seasonId));
        if (!snapshot) throw new AdminError("NOT_FOUND", 404);
        const rows = await entries(tx, input.seasonId);
        const destinations = rows.length
          ? await tx
              .select()
              .from(rewardDestinations)
              .where(
                inArray(
                  rewardDestinations.userId,
                  rows.map((r) => r.userId),
                ),
              )
          : [];
        const accounts = rows.length
          ? await tx
              .select({ id: users.id, status: users.status })
              .from(users)
              .where(
                inArray(
                  users.id,
                  rows.map((r) => r.userId),
                ),
              )
          : [];
        const columns = [
          "season_id",
          "rank",
          "points",
          "display_name",
          "discord_user_ids",
          "telegram_user_ids",
          "eligibility",
          "account_status",
          "bybit_uid",
          "mantle_address",
          "destination_changed_at",
          "prize",
          "reward_status",
        ];
        const byUser = new Map(destinations.map((d) => [d.userId, d]));
        const accountStatus = new Map(accounts.map((a) => [a.id, a.status]));
        const csv =
          [
            columns.map(csvCell).join(","),
            ...rows.map((row) => {
              const d = byUser.get(row.userId);
              return [
                input.seasonId,
                row.rank,
                row.points,
                row.displayName,
                row.identities
                  .filter((i) => i.platform === "discord")
                  .map((i) => i.platformUserId)
                  .join(";"),
                row.identities
                  .filter((i) => i.platform === "telegram")
                  .map((i) => i.platformUserId)
                  .join(";"),
                row.eligibility,
                accountStatus.get(row.userId) ?? "unknown",
                d?.bybitUid,
                d?.mantleAddress,
                d?.changedAt.toISOString(),
                row.prizeDescription,
                row.event.status,
              ]
                .map(csvCell)
                .join(",");
            }),
          ].join("\r\n") + "\r\n";
        await event(tx, ctx, "reward.exported", "reward_snapshot", input.seasonId, null, {
          rowCount: rows.length,
        });
        return csv;
      });
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="rewards.csv"')
        .send(output);
    },
  );
}
