import { z } from "zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ASSETS, GAME_CONFIG } from "@stock-arena/game-core";
import type { AssetCatalog, PricesView } from "@stock-arena/game-core";
import { priceSnapshots } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { readMarket } from "./market.js";
import { AuthError } from "./auth/types.js";

export type PricesOptions = { catalog?: AssetCatalog };
export function createPricesStore(
  connection: DatabaseConnection,
  options: PricesOptions & { now?: () => Date } = {},
) {
  const catalog: AssetCatalog = options.catalog ?? ASSETS;
  return async (): Promise<PricesView> =>
    connection.db.transaction(async (tx) => {
      const now = (options.now ?? (() => new Date()))();
      const prices = await readMarket(tx, catalog, now);
      const references = [...new Set(Object.values(catalog).map((asset) => asset.referenceTicker))];
      const pools = references.length
        ? await tx
            .selectDistinctOn([priceSnapshots.ticker])
            .from(priceSnapshots)
            .where(
              and(
                eq(priceSnapshots.source, "fluxion_pool"),
                inArray(priceSnapshots.ticker, references),
                lte(priceSnapshots.takenAt, now),
              ),
            )
            .orderBy(priceSnapshots.ticker, desc(priceSnapshots.takenAt))
        : [];
      return {
        catalog,
        serverTime: now.toISOString(),
        // Pool quotes are informational only; readMarket and HL use primary rows.
        prices: prices.map(({ ticker, priceUsd, takenAt, change24hPct, state, reason }) => {
          const pool =
            reason === "closed"
              ? pools.find((row) => row.ticker === catalog[ticker]!.referenceTicker)
              : undefined;
          return {
            ticker,
            priceUsd,
            takenAt,
            change24hPct,
            state,
            reason,
            pool:
              pool && Number.isFinite(Number(pool.priceUsd)) && Number(pool.priceUsd) > 0
                ? { priceUsd: pool.priceUsd, takenAt: pool.takenAt.toISOString() }
                : null,
          };
        }),
      };
    });
}
export function registerPrices(
  app: FastifyInstance,
  options: PricesOptions & { database: () => DatabaseConnection; now?: () => Date },
) {
  let store: ReturnType<typeof createPricesStore> | undefined;
  const streams = new Set<FastifyReply["raw"]>();
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
  });
  app.get("/api/prices/stream", async (request, reply) => {
    if (!request.user) throw new AuthError("UNAUTHORIZED", 401);
    if (!z.object({}).strict().safeParse(request.query).success)
      throw new AuthError("INVALID_INPUT", 400);
    store ??= createPricesStore(options.database(), options);
    const initial = await store();
    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    streams.add(stream);
    let busy = false;
    const write = (view: PricesView) => {
      if (stream.destroyed || stream.writableEnded) return;
      // A stalled reader cannot accumulate unbounded snapshots in server memory.
      if (stream.writableLength > 128 * 1024) {
        stream.destroy();
        return;
      }
      stream.write(`event: prices\ndata: ${JSON.stringify(view)}\n\n`);
    };
    write(initial);
    const timer = setInterval(() => {
      if (busy || stream.destroyed || stream.writableEnded) return;
      busy = true;
      void store!()
        .then(write, () => {
          app.log.warn({ code: "PRICE_STREAM_UNAVAILABLE" }, "Price stream closed");
          stream.end();
        })
        .finally(() => {
          busy = false;
        });
    }, GAME_CONFIG.prices.pollSeconds * 1000);
    // Reconnect through authentication regularly; tokens never enter query strings.
    const lifetime = setTimeout(() => stream.end(), 60_000);
    stream.once("close", () => {
      clearInterval(timer);
      clearTimeout(lifetime);
      streams.delete(stream);
    });
  });
}
