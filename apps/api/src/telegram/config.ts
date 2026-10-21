import { z } from "zod";

export const telegramWebAppUrl = "https://mstocks-arena.vercel.app";
export const telegramWebhookUrl = `${telegramWebAppUrl}/api/telegram/webhook`;
// Telegram accepts only these URL-safe characters, up to 256 characters.
export const webhookSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/);
