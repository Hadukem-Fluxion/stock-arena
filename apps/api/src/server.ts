import Fastify, { type FastifyInstance } from "fastify";
import { TICKERS } from "@stock-arena/game-core";

export const VERSION = "0.1.0";

/** Builds the API. Routes are registered under /api so Discord's proxy mapping stays simple. */
export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // Never log credentials, init data or OAuth codes (see AGENTS.md).
      redact: ["req.headers.authorization", "req.body.initData", "req.body.code"],
    },
  });

  app.get("/api/health", async () => ({ ok: true, version: VERSION, tickers: TICKERS }));

  return app;
}
