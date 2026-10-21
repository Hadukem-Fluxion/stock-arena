import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { en } from "../../../web/src/copy/en.js";
import { AuthError } from "../auth/types.js";
import { telegramWebAppUrl, webhookSecretSchema } from "./config.js";

const updateSchema = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: z
    .object({
      chat: z.object({
        id: z.number().int().safe(),
        type: z.enum(["private", "group", "supergroup", "channel"]),
      }),
      text: z.string().max(4096).optional(),
    })
    .optional(),
});

/** T13 can consume startPayload later; never persist or log it in T16a. */
export function parseTelegramText(text: string) {
  const match = /^\/(start|help)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (match?.[1] === "start")
    return { command: "start" as const, startPayload: match[2]?.trim() || null };
  if (match?.[1] === "help") return { command: "help" as const, startPayload: null };
  return { command: "other" as const, startPayload: null };
}

export function registerTelegramWebhook(app: FastifyInstance, secret: string | undefined) {
  const configured = webhookSecretSchema.safeParse(secret);
  const expected = configured.success
    ? createHash("sha256").update(configured.data).digest()
    : null;
  app.post(
    "/api/telegram/webhook",
    {
      onRequest: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const received = z
          .string()
          .min(1)
          .max(256)
          .safeParse(request.headers["x-telegram-bot-api-secret-token"]);
        if (!expected || !received.success) throw new AuthError("UNAUTHORIZED", 401);
        // Fixed-size digests allow constant-time comparison even for unequal lengths.
        if (!timingSafeEqual(expected, createHash("sha256").update(received.data).digest()))
          throw new AuthError("UNAUTHORIZED", 401);
      },
    },
    async (request) => {
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
      const message = parsed.data.message;
      // Telegram permits inline web_app buttons only in private bot/user chats.
      if (!message?.text || message.chat.type !== "private") return { ok: true };
      const command = parseTelegramText(message.text);
      return {
        method: "sendMessage",
        chat_id: message.chat.id,
        text:
          command.command === "start"
            ? en.telegramBot.welcome
            : command.command === "help"
              ? en.telegramBot.help
              : en.telegramBot.open,
        reply_markup: {
          inline_keyboard: [[{ text: en.telegramBot.play, web_app: { url: telegramWebAppUrl } }]],
        },
      };
    },
  );
}
