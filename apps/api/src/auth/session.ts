import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { AuthError, identitySchema } from "./types.js";
import type { AuthenticatedUser } from "./types.js";

const claimsSchema = identitySchema.extend({
  sub: z.string().uuid(),
  exp: z.number().int(),
  iat: z.number().int(),
});
const issuer = "stock-arena-api";
const audience = "stock-arena-web";

export function createSessions(secret: string, now: () => Date = () => new Date()) {
  if (Buffer.byteLength(secret) < 32) throw new AuthError("AUTH_UNAVAILABLE", 503);
  const key = new TextEncoder().encode(secret);
  return {
    async issue(user: AuthenticatedUser) {
      const issuedAt = Math.floor(now().getTime() / 1000);
      const expiresAt = issuedAt + 24 * 60 * 60;
      const token = await new SignJWT(user.identity)
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(user.id)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(key);
      return { token, expiresAt: new Date(expiresAt * 1000).toISOString(), user };
    },
    async verify(token: string) {
      try {
        const verified = await jwtVerify(token, key, {
          algorithms: ["HS256"],
          issuer,
          audience,
          currentDate: now(),
          requiredClaims: ["sub", "exp", "iat"],
        });
        const claims = claimsSchema.parse(verified.payload);
        if (claims.iat > Math.floor(now().getTime() / 1000)) throw new Error("Future session");
        return claims;
      } catch {
        throw new AuthError("UNAUTHORIZED", 401);
      }
    },
  };
}
