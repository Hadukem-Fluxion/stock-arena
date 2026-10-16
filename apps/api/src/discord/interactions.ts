import { createPublicKey, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError } from "../auth/types.js";
import { discordCopy } from "./copy.js";

const headersSchema = z.object({
  "x-signature-ed25519": z.string().regex(/^[a-f0-9]{128}$/i),
  "x-signature-timestamp": z.string().regex(/^\d{1,20}$/),
});
const interactionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(1) }),
  z.object({
    type: z.literal(2),
    data: z.object({ name: z.string().min(1).max(32), type: z.number().int().optional() }),
  }),
]);

export function registerDiscordInteractions(app: FastifyInstance, publicKey: string | undefined) {
  let key: KeyObject | undefined;
  if (publicKey && /^[a-f0-9]{64}$/i.test(publicKey)) {
    // Discord publishes the raw 32-byte Ed25519 key. Node expects its SPKI envelope.
    key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(publicKey, "hex"),
      ]),
      format: "der",
      type: "spki",
    });
  }
  app.register(async (scope) => {
    // Encapsulation keeps auth/game JSON parsers unchanged. Verify these exact bytes
    // before decoding JSON; JSON.stringify(request.body) is not the signed payload.
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) =>
      done(null, body),
    );
    scope.post(
      "/api/discord/interactions",
      {
        onRequest: async (request, reply) => {
          reply.header("Cache-Control", "no-store");
          if (!headersSchema.safeParse(request.headers).success)
            throw new AuthError("UNAUTHORIZED", 401);
          if (!key) throw new AuthError("AUTH_UNAVAILABLE", 503);
        },
      },
      async (request) => {
        const headers = headersSchema.parse(request.headers);
        if (
          !key ||
          !Buffer.isBuffer(request.body) ||
          !verify(
            null,
            Buffer.concat([Buffer.from(headers["x-signature-timestamp"], "utf8"), request.body]),
            key,
            Buffer.from(headers["x-signature-ed25519"], "hex"),
          )
        )
          throw new AuthError("UNAUTHORIZED", 401);
        let body: unknown;
        try {
          body = JSON.parse(request.body.toString("utf8")) as unknown;
        } catch {
          throw new AuthError("INVALID_INPUT", 400);
        }
        const parsed = interactionSchema.safeParse(body);
        if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
        if (parsed.data.type === 1) return { type: 1 };
        const command = parsed.data.data;
        if (
          (command.type === undefined || command.type === 1) &&
          (command.name === "arena" || command.name === "start")
        )
          return { type: 12 };
        return {
          type: 4,
          data: { content: discordCopy.unknownCommand, flags: 64, allowed_mentions: { parse: [] } },
        };
      },
    );
  });
}
