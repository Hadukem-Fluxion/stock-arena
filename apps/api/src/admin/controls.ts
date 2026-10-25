import { ASSETS, GAME_CONFIG } from "@stock-arena/game-core";
import type { AssetCatalog } from "@stock-arena/game-core";
import {
  gameControls,
  priceSnapshots,
  seasons,
  tickerControls,
  tickerStatus,
} from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError } from "../auth/types.js";
import { activeActor, event } from "./operations.js";
import { AdminError } from "./permissions.js";
import type { Permission } from "./permissions.js";
import type { AuditContext } from "./store.js";

const reason = z.string().trim().min(1).max(2000);
const toggle = z.object({ paused: z.boolean(), reason });
const seasonInput = z
  .object({
    create: z.boolean(),
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
    name: z.string().trim().min(1).max(160),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }).nullable(),
    reason,
  })
  .strict()
  .refine((v) => v.endsAt === null || Date.parse(v.endsAt) > Date.parse(v.startsAt));
function parse<O, I>(schema: z.ZodType<O, z.ZodTypeDef, I>, value: unknown): O {
  const result = schema.safeParse(value);
  if (!result.success) throw new AuthError("INVALID_INPUT", 400);
  return result.data;
}
export function registerControls(
  app: FastifyInstance,
  options: {
    database: () => DatabaseConnection;
    now: () => Date;
    context: (req: FastifyRequest) => AuditContext;
    catalog?: AssetCatalog;
  },
) {
  const catalog = options.catalog ?? ASSETS,
    refs = [...new Set(Object.values(catalog).map((a) => a.referenceTicker))];
  const db = () => options.database().db;
  const write = (
    req: FastifyRequest,
    permission: Permission,
    fn: (tx: Parameters<typeof activeActor>[0], ctx: AuditContext) => Promise<unknown>,
  ) =>
    db().transaction(async (tx) => {
      const ctx = options.context(req);
      await activeActor(tx, ctx, permission);
      return fn(tx, ctx);
    });
  app.get("/api/admin/games", { config: { adminPermission: "games:write" } }, async (req) => {
    parse(z.object({}).strict(), req.query);
    return { entries: await db().select().from(gameControls).orderBy(gameControls.game) };
  });
  app.post("/api/admin/games", { config: { adminPermission: "games:write" } }, async (req) => {
    const input = parse(
      toggle.extend({ game: z.enum(["checkin", "quiz", "higher_lower", "invite"]) }).strict(),
      req.body,
    );
    return write(req, "games:write", async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(gameControls)
        .where(eq(gameControls.game, input.game))
        .for("update");
      if (!before) throw new AdminError("NOT_FOUND", 404);
      await tx
        .update(gameControls)
        .set({ paused: input.paused, reason: input.reason, updatedAt: ctx.now })
        .where(eq(gameControls.game, input.game));
      await event(tx, ctx, "game.control_changed", "game", input.game, null, {
        before: before.paused,
        after: input.paused,
        reason: input.reason,
      });
      return { ok: true };
    });
  });
  app.get("/api/admin/tickers", { config: { adminPermission: "games:write" } }, async (req) => {
    parse(z.object({}).strict(), req.query);
    const statuses = refs.length
      ? await db().select().from(tickerStatus).where(inArray(tickerStatus.ticker, refs))
      : [];
    const controls = refs.length
      ? await db().select().from(tickerControls).where(inArray(tickerControls.ticker, refs))
      : [];
    const latest = refs.length
      ? await db()
          .selectDistinctOn([priceSnapshots.ticker])
          .from(priceSnapshots)
          .where(
            and(
              inArray(priceSnapshots.ticker, refs),
              eq(priceSnapshots.source, "xstocks"),
              lte(priceSnapshots.takenAt, options.now()),
            ),
          )
          .orderBy(priceSnapshots.ticker, desc(priceSnapshots.takenAt))
      : [];
    return {
      catalog,
      entries: refs.map((ticker) => {
        const status = statuses.find((r) => r.ticker === ticker),
          control = controls.find((r) => r.ticker === ticker),
          price = latest.find((r) => r.ticker === ticker);
        const stale =
          !status ||
          !price ||
          status.updatedAt > options.now() ||
          options.now().getTime() - status.updatedAt.getTime() >
            GAME_CONFIG.prices.staleAfterSeconds * 1000 ||
          options.now().getTime() - price.takenAt.getTime() >
            GAME_CONFIG.prices.staleAfterSeconds * 1000;
        return {
          ticker,
          manualPaused: control?.paused ?? false,
          manualReason: control?.reason ?? "",
          state: control?.paused || stale ? "paused" : status!.state,
          reason: control?.paused ? "manual" : stale ? "stale" : status!.reason,
          oracleState: status?.oracleState ?? null,
          oracleReason: status?.oracleReason ?? null,
          updatedAt: status?.updatedAt ?? null,
          priceUsd: price?.priceUsd ?? null,
        };
      }),
    };
  });
  app.post("/api/admin/tickers", { config: { adminPermission: "games:write" } }, async (req) => {
    const input = parse(toggle.extend({ ticker: z.string().min(1).max(100) }).strict(), req.body);
    if (!refs.includes(input.ticker)) throw new AuthError("INVALID_INPUT", 400);
    return write(req, "games:write", async (tx, ctx) => {
      await tx.insert(tickerControls).values({ ticker: input.ticker }).onConflictDoNothing();
      const [before] = await tx
        .select()
        .from(tickerControls)
        .where(eq(tickerControls.ticker, input.ticker))
        .for("update");
      const [status] = await tx
        .select()
        .from(tickerStatus)
        .where(eq(tickerStatus.ticker, input.ticker))
        .for("update");
      const [price] = await tx
        .select()
        .from(priceSnapshots)
        .where(
          and(
            eq(priceSnapshots.ticker, input.ticker),
            eq(priceSnapshots.source, "xstocks"),
            lte(priceSnapshots.takenAt, ctx.now),
          ),
        )
        .orderBy(desc(priceSnapshots.takenAt))
        .limit(1);
      const fresh =
        status &&
        price &&
        status.updatedAt <= ctx.now &&
        ctx.now.getTime() - status.updatedAt.getTime() <=
          GAME_CONFIG.prices.staleAfterSeconds * 1000 &&
        ctx.now.getTime() - price.takenAt.getTime() <= GAME_CONFIG.prices.staleAfterSeconds * 1000;
      const state = input.paused ? "paused" : fresh ? (status.oracleState ?? "paused") : "paused";
      const autoReason = fresh
        ? (status.oracleReason ?? (status.oracleState === "live" ? null : "stale"))
        : "stale";
      await tx
        .update(tickerControls)
        .set({ paused: input.paused, reason: input.reason, updatedAt: ctx.now })
        .where(eq(tickerControls.ticker, input.ticker));
      await tx
        .insert(tickerStatus)
        .values({
          ticker: input.ticker,
          state,
          reason: input.paused ? "manual" : autoReason,
          updatedAt: new Date(0),
        })
        .onConflictDoUpdate({
          target: tickerStatus.ticker,
          set: { state, reason: input.paused ? "manual" : autoReason },
        });
      await event(tx, ctx, "ticker.control_changed", "ticker", input.ticker, null, {
        before: before!.paused,
        after: input.paused,
        reason: input.reason,
      });
      return { ok: true };
    });
  });
  app.get("/api/admin/seasons", { config: { adminPermission: "seasons:write" } }, async (req) => {
    parse(z.object({}).strict(), req.query);
    return {
      serverTime: options.now(),
      entries: await db().select().from(seasons).orderBy(desc(seasons.startsAt)),
    };
  });
  app.post("/api/admin/seasons", { config: { adminPermission: "seasons:write" } }, async (req) => {
    const input = parse(seasonInput, req.body);
    return write(req, "seasons:write", async (tx, ctx) => {
      const rows = await tx.select().from(seasons).orderBy(desc(seasons.startsAt));
      const before = rows.find((r) => r.id === input.id),
        startsAt = new Date(input.startsAt),
        endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (input.create && before) throw new AdminError("SEASON_EXISTS");
      if (!input.create && !before) throw new AdminError("NOT_FOUND", 404);
      if (!before && (startsAt <= ctx.now || rows.some((r) => r.startsAt >= startsAt)))
        throw new AdminError("SEASON_ORDER");
      if (
        before &&
        before.startsAt.getTime() !== startsAt.getTime() &&
        (before.startsAt <= ctx.now || startsAt <= ctx.now)
      )
        await activeActor(tx, ctx, "seasons:past-start");
      if (
        rows.some(
          (r) =>
            r.id !== input.id &&
            (!r.endsAt || startsAt < r.endsAt) &&
            (!endsAt || r.startsAt < endsAt),
        )
      )
        throw new AdminError("SEASON_OVERLAP");
      const values = { id: input.id, name: input.name, startsAt, endsAt };
      if (before) await tx.update(seasons).set(values).where(eq(seasons.id, input.id));
      else await tx.insert(seasons).values(values);
      await event(tx, ctx, before ? "season.updated" : "season.created", "season", input.id, null, {
        before: before ?? null,
        after: values,
        reason: input.reason,
      });
      return { ok: true };
    });
  });
}
