import { z } from "zod";

export const roleSchema = z.enum(["owner", "admin", "moderator", "support"]);
export type AdminRole = z.infer<typeof roleSchema>;
const instant = z.string().datetime({ offset: true });
const sessionSchema = z.object({
  user: z.object({ id: z.string().uuid(), displayName: z.string(), role: roleSchema }),
  permissions: z.array(z.string()),
  legacy: z.boolean(),
  expiresAt: instant.nullable(),
  csrf: z.string().min(1),
});
const memberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  discordId: z.string(),
  role: roleSchema,
  grantedBy: z.string().uuid(),
  grantedAt: instant,
  revokedAt: instant.nullable(),
});
const teamSchema = z.object({ members: z.array(memberSchema) });
const auditSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string().uuid(),
      actorId: z.string().uuid(),
      actorName: z.string(),
      action: z.string(),
      targetUserId: z.string().uuid().nullable(),
      targetType: z.string().nullable(),
      targetId: z.string().nullable(),
      details: z.record(z.unknown()),
      ipHash: z.string().nullable(),
      createdAt: instant,
    }),
  ),
  page: z.number().int().positive(),
  hasMore: z.boolean(),
});
const okSchema = z.object({ ok: z.literal(true) });
export type AdminSession = z.infer<typeof sessionSchema>;
export type TeamMember = z.infer<typeof memberSchema>;
export type AuditView = z.infer<typeof auditSchema>;
export type AuditFilters = {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
};
export class AdminClientError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export function createAdminClient(fetcher: typeof fetch = fetch) {
  async function request<Output, Input>(
    path: string,
    schema: z.ZodType<Output, z.ZodTypeDef, Input>,
    csrf?: string,
    body?: object,
  ): Promise<Output> {
    let response: Response;
    try {
      response = await fetcher(`/api/admin/${path}`, {
        method: csrf ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: csrf
          ? { "Content-Type": "application/json", "X-Admin-CSRF": csrf }
          : { Accept: "application/json" },
        ...(csrf ? { body: JSON.stringify(body ?? {}) } : {}),
      });
    } catch {
      throw new AdminClientError("NETWORK_ERROR");
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new AdminClientError("INVALID_RESPONSE");
    }
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(raw);
      throw new AdminClientError(error.success ? error.data.error.code : "INVALID_RESPONSE");
    }
    const result = schema.safeParse(raw);
    if (!result.success) throw new AdminClientError("INVALID_RESPONSE");
    return result.data;
  }
  return {
    session: () => request("session", sessionSchema),
    team: () => request("team", teamSchema),
    audit: (filters: AuditFilters = {}) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters))
        if (value !== undefined && value !== "") query.set(key, String(value));
      return request(`audit?${query}`, auditSchema);
    },
    grant: (csrf: string, body: { discordId: string; role: AdminRole; confirmation?: string }) =>
      request("team", okSchema, csrf, body),
    revoke: (csrf: string, userId: string) => request("team/revoke", okSchema, csrf, { userId }),
    transfer: (csrf: string, userId: string, confirmation: string) =>
      request("team/transfer", okSchema, csrf, { userId, confirmation }),
    logout: (csrf: string) => request("logout", okSchema, csrf),
  };
}
