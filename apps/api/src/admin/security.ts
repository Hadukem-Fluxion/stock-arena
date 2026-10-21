import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthError } from "../auth/types.js";

export const SESSION_COOKIE = "__Secure-mstocks-admin";
export const STATE_COOKIE = "__Secure-mstocks-admin-state";
export const SESSION_SECONDS = 12 * 60 * 60;
export const randomToken = () => randomBytes(32).toString("base64url");
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function hmac(secret: string | undefined, value: string): string {
  if (!secret || Buffer.byteLength(secret) < 32) throw new AuthError("AUTH_UNAVAILABLE", 503);
  return createHmac("sha256", secret).update(value).digest("base64url");
}
export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header || header.length > 16_384) return undefined;
  const matches = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
export function sessionCookie(value: string, maxAge = SESSION_SECONDS): string {
  return `${SESSION_COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function stateCookie(value: string, maxAge = 600): string {
  // Only the transient OAuth handshake uses Lax to allow Discord's top-level callback.
  return `${STATE_COOKIE}=${value}; Path=/api/admin/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function webOrigin(value: string | undefined): string {
  try {
    const parsed = new URL(value ?? "");
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new Error();
    return parsed.origin;
  } catch {
    throw new AuthError("AUTH_UNAVAILABLE", 503);
  }
}
