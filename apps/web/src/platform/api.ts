import { z } from "zod";
import { PlatformError, sessionSchema } from "./types.js";

export function createLoginClient(request: typeof fetch = fetch) {
  return async function exchange<P extends "discord" | "telegram">(
    platform: P,
    input: P extends "discord" ? { code: string } : { initData: string },
  ) {
    let response: Response;
    try {
      response = await request(`/api/auth/${platform}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PlatformError("NETWORK_ERROR");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PlatformError("INVALID_RESPONSE");
    }
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
      const code = error.success ? error.data.error.code : "";
      if (code === "ACCOUNT_UNAVAILABLE") throw new PlatformError("ACCOUNT_UNAVAILABLE");
      if (code === "AUTH_UNAVAILABLE") throw new PlatformError("CONFIGURATION_REQUIRED");
      throw new PlatformError("LOGIN_FAILED");
    }
    const parsed = sessionSchema.safeParse(
      typeof body === "object" && body !== null && "session" in body ? body.session : null,
    );
    const token = z.object({ access_token: z.string().min(1) }).safeParse(body);
    if (
      !parsed.success ||
      parsed.data.user.identity.platform !== platform ||
      Date.parse(parsed.data.expiresAt) <= Date.now() ||
      (platform === "discord" && !token.success)
    ) {
      throw new PlatformError("INVALID_RESPONSE");
    }
    return { session: parsed.data, accessToken: token.success ? token.data.access_token : null };
  };
}
