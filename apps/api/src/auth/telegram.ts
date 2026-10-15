import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AuthError } from "./types.js";
import type { VerifiedIdentity } from "./types.js";

const telegramUser = z.object({
  id: z.number().int().positive().safe(),
  first_name: z.string().min(1).max(256),
  last_name: z.string().max(256).optional(),
  photo_url: z
    .string()
    .url()
    .refine((url) => new URL(url).protocol === "https:")
    .optional(),
});

export function verifyTelegram(
  initData: string,
  botToken: string,
  now = new Date(),
): VerifiedIdentity {
  const params = new URLSearchParams(initData);
  const entries = [...params.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw new AuthError("INVALID_IDENTITY", 401);
  const hash = params.get("hash");
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) throw new AuthError("INVALID_IDENTITY", 401);
  const checkString = entries
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex")))
    throw new AuthError("INVALID_IDENTITY", 401);

  const authDate = params.get("auth_date") ?? "";
  const timestamp = /^\d+$/.test(authDate) ? Number(authDate) : NaN;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp > nowSeconds ||
    nowSeconds - timestamp > 24 * 60 * 60
  ) {
    throw new AuthError("INVALID_IDENTITY", 401);
  }
  let user: z.infer<typeof telegramUser>;
  try {
    user = telegramUser.parse(JSON.parse(params.get("user") ?? ""));
  } catch {
    throw new AuthError("INVALID_IDENTITY", 401);
  }
  return {
    platform: "telegram",
    platformUserId: String(user.id),
    displayName: [user.first_name, user.last_name].filter(Boolean).join(" "),
    avatarUrl: user.photo_url ?? null,
    platformCreatedAt: null,
  };
}
