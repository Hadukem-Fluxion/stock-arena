import { z } from "zod";
import { AuthError } from "./types.js";
import type { VerifiedIdentity } from "./types.js";

const tokenSchema = z.object({ access_token: z.string().min(1), token_type: z.literal("Bearer") });
const discordUser = z.object({
  id: z
    .string()
    .regex(/^\d{1,20}$/)
    .refine((id) => /^\d{1,20}$/.test(id) && BigInt(id) > 0n && BigInt(id) < 2n ** 64n),
  username: z.string().min(1).max(256),
  global_name: z.string().min(1).max(256).nullish(),
  avatar: z
    .string()
    .regex(/^(a_)?[a-fA-F0-9]+$/)
    .nullish(),
});

export async function exchangeDiscordCode(
  code: string,
  config: { clientId: string; clientSecret: string; redirectUri?: string },
  fetcher: typeof fetch = fetch,
): Promise<{ accessToken: string; identity: VerifiedIdentity }> {
  async function request(url: string, options: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(url, { ...options, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new AuthError("PROVIDER_UNAVAILABLE", 502);
    }
    if (!response.ok)
      throw new AuthError(
        response.status >= 500 || response.status === 429
          ? "PROVIDER_UNAVAILABLE"
          : "INVALID_IDENTITY",
        response.status >= 500 || response.status === 429 ? 502 : 401,
      );
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new AuthError("PROVIDER_UNAVAILABLE", 502);
    }
  }
  const rawToken = await request("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
    }),
  });
  const token = tokenSchema.safeParse(rawToken);
  if (!token.success) throw new AuthError("PROVIDER_UNAVAILABLE", 502);
  const user = discordUser.safeParse(
    await request("https://discord.com/api/v10/users/@me", {
      headers: { authorization: `Bearer ${token.data.access_token}` },
    }),
  );
  if (!user.success) throw new AuthError("PROVIDER_UNAVAILABLE", 502);
  return {
    accessToken: token.data.access_token,
    identity: {
      platform: "discord",
      platformUserId: user.data.id,
      displayName: user.data.global_name ?? user.data.username,
      avatarUrl: user.data.avatar
        ? `https://cdn.discordapp.com/avatars/${user.data.id}/${user.data.avatar}.${user.data.avatar.startsWith("a_") ? "gif" : "png"}`
        : null,
      platformCreatedAt: new Date(Number((BigInt(user.data.id) >> 22n) + 1420070400000n)),
    },
  };
}
