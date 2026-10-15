import { z } from "zod";

export const identitySchema = z.object({
  platform: z.enum(["discord", "telegram"]),
  platformUserId: z.string().min(1).max(64),
});

export type VerifiedIdentity = z.infer<typeof identitySchema> & {
  displayName: string;
  avatarUrl: string | null;
  platformCreatedAt: Date | null;
};

export type AuthenticatedUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  identity: z.infer<typeof identitySchema>;
};

export type AuthErrorCode =
  | "INVALID_INPUT"
  | "INVALID_IDENTITY"
  | "AUTH_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "ACCOUNT_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    public readonly statusCode: number,
  ) {
    super(code);
  }
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}
