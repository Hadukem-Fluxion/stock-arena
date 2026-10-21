import { z } from "zod";
import { en } from "../../../web/src/copy/en.js";
import { telegramWebAppUrl, telegramWebhookUrl, webhookSecretSchema } from "./config.js";

const resultSchema = z.object({ ok: z.literal(true), result: z.literal(true) });

/** Explicit operator action only; never called by API startup, a worker or CI. */
export async function setupTelegram(
  env: Record<string, string | undefined>,
  request: typeof fetch = fetch,
): Promise<number> {
  try {
    const token = z
      .string()
      .max(1024)
      .regex(/^\d+:[A-Za-z0-9_-]+$/)
      .parse(env.TELEGRAM_BOT_TOKEN);
    const secret = webhookSecretSchema.parse(env.TELEGRAM_WEBHOOK_SECRET);
    const settings = [
      [
        "setWebhook",
        { url: telegramWebhookUrl, secret_token: secret, allowed_updates: ["message"] },
      ],
      [
        "setMyCommands",
        {
          commands: [
            { command: "start", description: en.telegramBot.startDescription },
            { command: "help", description: en.telegramBot.helpDescription },
          ],
        },
      ],
      [
        "setChatMenuButton",
        {
          menu_button: {
            type: "web_app",
            text: en.telegramBot.play,
            web_app: { url: telegramWebAppUrl },
          },
        },
      ],
    ] as const;
    for (const [method, body] of settings) {
      const response = await request(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Setup request failed.");
      resultSchema.parse(await response.json());
    }
    return settings.length;
  } catch {
    // Telegram URLs contain the bot token; never expose errors, causes or responses.
    throw new Error("Telegram setup failed.");
  }
}
