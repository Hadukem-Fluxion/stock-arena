import { z } from "zod";
import type { PlatformAdapter } from "../platform/types.js";

export const referralView = z.object({
  code: z.string(),
  joined: z.number().int().nonnegative(),
  points: z.number().int(),
  claim: z.enum(["pending", "rewarded", "void"]).nullable(),
  maintenance: z.boolean(),
  telegramUrl: z.string().url().nullable(),
  discordUrl: z.string().url().nullable(),
});
export type ReferralView = z.infer<typeof referralView>;
export class ReferralClientError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export function createReferralClient(platform: PlatformAdapter) {
  async function request(code?: string) {
    if (!platform.session) throw new ReferralClientError("UNAUTHORIZED");
    let response: Response;
    try {
      response = await fetch(`/api/referral${code === undefined ? "" : "/claim"}`, {
        method: code === undefined ? "GET" : "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${platform.session.token}`,
          ...(code === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(code === undefined ? {} : { body: JSON.stringify({ code }) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ReferralClientError("NETWORK_ERROR");
    }
    const raw: unknown = await response.json();
    if (!response.ok) {
      const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(raw);
      throw new ReferralClientError(parsed.success ? parsed.data.error.code : "INVALID_RESPONSE");
    }
    return raw;
  }
  return {
    read: async () => referralView.parse(await request()),
    claim: async (code: string) => z.object({ ok: z.literal(true) }).parse(await request(code)),
  };
}
