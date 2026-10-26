import { z } from "zod";
import type { Host } from "./detect.js";

export const sessionSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  user: z.object({
    id: z.string().uuid(),
    displayName: z.string().min(1),
    avatarUrl: z.string().url().nullable(),
    identity: z.object({
      platform: z.enum(["discord", "telegram"]),
      platformUserId: z.string().min(1),
    }),
  }),
});

export type Session = z.infer<typeof sessionSchema>;
export type PlatformUser = Omit<Session["user"], "identity"> & {
  identity: { platform: Host; platformUserId: string };
};

export interface PlatformAdapter {
  readonly host: Host;
  readonly user: PlatformUser | null;
  readonly session: Session | null;
  init(): Promise<void>;
  login(): Promise<PlatformUser>;
  openExternal(url: string): Promise<void>;
  shareInvite?(code: string, url: string, message: string): Promise<void>;
  setBackButton?(handler: (() => void) | null): () => void;
  haptic?(kind: "score" | "collision"): void;
}

export type PlatformErrorCode =
  | "BROWSER_DISABLED"
  | "CONFIGURATION_REQUIRED"
  | "HOST_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "LOGIN_FAILED"
  | "ACCOUNT_UNAVAILABLE"
  | "LINK_FAILED";

export class PlatformError extends Error {
  constructor(public readonly code: PlatformErrorCode) {
    super(code);
  }
}

export async function waitForHost<T>(operation: Promise<T>, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new PlatformError("HOST_UNAVAILABLE")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Do not pass javascript:, credentials or custom schemes to a host bridge. */
export function externalUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    throw new PlatformError("LINK_FAILED");
  }
}
