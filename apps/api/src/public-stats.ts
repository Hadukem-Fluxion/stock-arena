import { BlockList, isIP } from "node:net";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DatabaseConnection } from "@stock-arena/db";
import { addDays, gameDay, GAME_CONFIG } from "@stock-arena/game-core";

const origin = "https://mantle-synch.netlify.app";
const ttl = 60_000;
const count = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const iso = z.coerce.date().transform((date) => date.toISOString());
const state = z.enum(["active", "paused"]);
const statsSchema = z
  .object({
    updatedAt: z.string().datetime(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    season: z
      .object({ id: z.string(), name: z.string(), startsAt: iso, endsAt: iso.nullable() })
      .strict()
      .nullable(),
    players: z.object({ total: count, activeToday: count }).strict(),
    today: z.object({ checkins: count, quizCompleted: count, hlPredictions: count }).strict(),
    games: z.object({ checkin: state, quiz: state, higherLower: state }).strict(),
  })
  .strict();
export type PublicStats = z.output<typeof statsSchema>;

/** One read-only SQL statement and one in-flight refresh per process/window. */
export function createPublicStatsStore(connection: DatabaseConnection, now = () => new Date()) {
  let cache: { value: PublicStats; expiresAt: number } | undefined;
  let failure: { day: string; expiresAt: number } | undefined;
  let pending: { day: string; promise: Promise<PublicStats> } | undefined;
  return async (): Promise<PublicStats> => {
    const instant = now(),
      day = gameDay(instant);
    if (cache && cache.value.day === day && cache.expiresAt > instant.getTime()) return cache.value;
    if (failure?.day === day && failure.expiresAt > instant.getTime())
      throw new Error("Stats are unavailable.");
    if (pending?.day === day) return pending.promise;
    const start = `${day}T00:00:00Z`,
      end = `${addDays(day, 1)}T00:00:00Z`;
    const query = (async () => {
      const result = await connection.db.execute<{
        total: string;
        active: string;
        checkins: string;
        quizzes: string;
        predictions: string;
        season: unknown;
        games: unknown;
      }>(sql`
        WITH predictions_today AS (
          SELECT r.user_id FROM hl_predictions p JOIN hl_runs r ON r.id=p.run_id
          WHERE p.locked_at >= ${start}::timestamptz AND p.locked_at < ${end}::timestamptz
            AND p.locked_at <= ${instant.toISOString()}::timestamptz
        ), active_players AS (
          SELECT user_id FROM checkins WHERE day=${day}::date
          UNION SELECT user_id FROM quiz_attempts WHERE day=${day}::date
          UNION SELECT user_id FROM hl_runs WHERE created_at >= ${start}::timestamptz
            AND created_at < ${end}::timestamptz AND created_at <= ${instant.toISOString()}::timestamptz
          UNION SELECT user_id FROM predictions_today
        )
        SELECT (SELECT count(*)::text FROM users) AS total,
          (SELECT count(*)::text FROM active_players) AS active,
          (SELECT count(*)::text FROM checkins WHERE day=${day}::date) AS checkins,
          (SELECT count(*)::text FROM quiz_attempts WHERE day=${day}::date
            AND cardinality(answers)=${GAME_CONFIG.quiz.questionsPerDay}) AS quizzes,
          (SELECT count(*)::text FROM predictions_today) AS predictions,
          (SELECT json_build_object('id',id,'name',name,'startsAt',starts_at,'endsAt',ends_at)
            FROM seasons WHERE starts_at <= ${instant.toISOString()}::timestamptz
            ORDER BY starts_at DESC LIMIT 1) AS season,
          json_build_object(
            'checkin',CASE WHEN coalesce((SELECT paused FROM game_controls WHERE game='checkin'),true) THEN 'paused' ELSE 'active' END,
            'quiz',CASE WHEN coalesce((SELECT paused FROM game_controls WHERE game='quiz'),true) THEN 'paused' ELSE 'active' END,
            'higherLower',CASE WHEN coalesce((SELECT paused FROM game_controls WHERE game='higher_lower'),true) THEN 'paused' ELSE 'active' END
          ) AS games
      `);
      const row = result.rows[0];
      if (!row) throw new Error("Stats are unavailable.");
      return statsSchema.parse({
        updatedAt: instant.toISOString(),
        day,
        season: row.season,
        games: row.games,
        players: { total: row.total, activeToday: row.active },
        today: {
          checkins: row.checkins,
          quizCompleted: row.quizzes,
          hlPredictions: row.predictions,
        },
      });
    })();
    const refresh = { day, promise: query };
    pending = refresh;
    try {
      const value = await query;
      // A refresh begun yesterday must not overwrite a newer day's cache.
      if (pending === refresh)
        cache = { value, expiresAt: Math.min(instant.getTime() + ttl, Date.parse(end)) };
      return value;
    } catch {
      if (pending === refresh)
        failure = { day, expiresAt: Math.min(instant.getTime() + ttl, Date.parse(end)) };
      throw new Error("Stats are unavailable.");
    } finally {
      if (pending === refresh) pending = undefined;
    }
  };
}

const proxyPeers = new BlockList();
for (const [network, prefix] of [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const)
  proxyPeers.addSubnet(network, prefix, "ipv4");
proxyPeers.addAddress("::1", "ipv6");
proxyPeers.addSubnet("fc00::", 7, "ipv6");
function rateKey(request: FastifyRequest) {
  const peer = (request.raw.socket.remoteAddress ?? request.ip).replace(/^::ffff:/i, "");
  const version = isIP(peer);
  const forwarded = request.headers["x-forwarded-for"];
  // Only this route trusts the nearest Caddy hop on the private API network.
  // Caddy replaces untrusted incoming XFF; never take a client-controlled prefix.
  const last = typeof forwarded === "string" ? forwarded.split(",").at(-1)?.trim() : undefined;
  return version && proxyPeers.check(peer, version === 4 ? "ipv4" : "ipv6") && last && isIP(last)
    ? last
    : peer;
}

export function registerPublicStats(
  app: FastifyInstance,
  options: {
    database: () => DatabaseConnection;
    now?: () => Date;
    env?: Record<string, string | undefined>;
  },
) {
  const now = options.now ?? (() => new Date());
  const limit = z.coerce
    .number()
    .int()
    .positive()
    .max(100_000)
    .default(60)
    .safeParse((options.env ?? process.env).PUBLIC_STATS_RATE_LIMIT_PER_MINUTE);
  let window = -1;
  const hits = new Map<string, number>();
  let store: ReturnType<typeof createPublicStatsStore> | undefined;
  app.all(
    "/api/public/stats",
    {
      exposeHeadRoute: false,
      onRequest: async (request, reply) => {
        reply.header("Cache-Control", "no-store").header("Vary", "Origin");
        if (request.headers.origin === origin)
          reply
            .header("Access-Control-Allow-Origin", origin)
            .header("Access-Control-Allow-Methods", "GET, OPTIONS");
        if (!["GET", "OPTIONS"].includes(request.method))
          return reply
            .header("Allow", "GET, OPTIONS")
            .code(405)
            .send({ error: { code: "METHOD_NOT_ALLOWED" } });
        if (!limit.success) return reply.code(503).send({ error: { code: "STATS_UNAVAILABLE" } });
        const instant = now().getTime(),
          bucket = Math.floor(instant / ttl);
        if (window !== bucket) {
          hits.clear();
          window = bucket;
        }
        const key = rateKey(request),
          used = hits.get(key) ?? 0;
        // Bound memory for a public endpoint, without evicting existing IP quotas.
        if (used >= limit.data || (used === 0 && hits.size >= 10_000))
          return reply
            .header("Retry-After", String(Math.ceil(((bucket + 1) * ttl - instant) / 1000)))
            .code(429)
            .send({ error: { code: "RATE_LIMITED" } });
        hits.set(key, used + 1);
        if (request.method === "OPTIONS") return reply.code(204).send();
      },
    },
    async (request, reply) => {
      if (!z.object({}).strict().safeParse(request.query).success)
        return reply.code(400).send({ error: { code: "INVALID_INPUT" } });
      try {
        store ??= createPublicStatsStore(options.database(), now);
        const value = await store();
        return reply.header("Cache-Control", "public, max-age=60").send(value);
      } catch {
        return reply.code(503).send({ error: { code: "STATS_UNAVAILABLE" } });
      }
    },
  );
}
