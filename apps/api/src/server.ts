import Fastify, { type FastifyInstance } from "fastify";
import { TICKERS } from "@stock-arena/game-core";
import type { Writable } from "node:stream";
import { registerAuth } from "./auth/index.js";
import type { AuthOptions } from "./auth/index.js";
import { AuthError } from "./auth/types.js";
import { GameError, registerCheckin } from "./checkin.js";
import type { CheckinOptions } from "./checkin.js";
import { QuizError, registerQuiz } from "./quiz.js";
import { registerDiscordInteractions } from "./discord/interactions.js";
import { HlError, registerHl } from "./higher-lower.js";
import type { HlOptions } from "./higher-lower.js";

export const VERSION = "0.1.0";

/** Builds the API. Routes are registered under /api so Discord's proxy mapping stays simple. */
export function buildServer(
  options: {
    auth?: AuthOptions;
    checkin?: CheckinOptions;
    higherLower?: HlOptions;
    discord?: { publicKey?: string };
    logger?: false | { stream: Writable };
  } = {},
): FastifyInstance {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
            ...(options.logger ? { stream: options.logger.stream } : {}),
            // Never log credentials, init data or OAuth codes (see AGENTS.md).
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.body.initData",
              "req.body.code",
            ],
            serializers: {
              // Log only the path: query strings can contain credentials too.
              req: (request: { method: string; url: string }) => ({
                method: request.method,
                url: request.url.split("?")[0],
              }),
            },
          },
  });

  app.get("/api/health", async () => ({ ok: true, version: VERSION, tickers: TICKERS }));
  const auth = registerAuth(app, options.auth);
  registerCheckin(app, { ...options.checkin, database: auth.database, now: options.auth?.now });
  registerQuiz(app, { database: auth.database, now: options.auth?.now });
  registerHl(app, { ...options.higherLower, database: auth.database, now: options.auth?.now });
  registerDiscordInteractions(
    app,
    options.discord ? options.discord.publicKey : process.env.DISCORD_PUBLIC_KEY,
  );
  app.setErrorHandler((error, _request, reply) => {
    if (
      error instanceof AuthError ||
      error instanceof GameError ||
      error instanceof QuizError ||
      error instanceof HlError
    ) {
      return reply.code(error.statusCode).send({ error: { code: error.code } });
    }
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
    if (statusCode === 400 || statusCode === 413 || statusCode === 415) {
      return reply.code(statusCode).send({ error: { code: "INVALID_INPUT" } });
    }
    // Raw DB/provider errors can include credentials or player data.
    app.log.error({ code: "INTERNAL_ERROR" }, "API request failed");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR" } });
  });

  return app;
}
