export const ROLES = ["owner", "admin", "moderator", "support"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "overview:read",
  "team:read",
  "team:write",
  "ownership:transfer",
  "audit:read",
  "players:read",
  "players:write",
  "flags:write",
  "flags:read",
  "flags:resolve",
  "quiz:read",
  "quiz:write",
  "points:write",
  "games:write",
  "seasons:write",
  "seasons:past-start",
  "rewards:read",
  "rewards:write",
  "rewards:export",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: [
    "overview:read",
    "audit:read",
    "players:read",
    "players:write",
    "flags:write",
    "flags:read",
    "flags:resolve",
    "quiz:read",
    "quiz:write",
    "points:write",
    "games:write",
    "seasons:write",
    "rewards:read",
    "rewards:write",
    "rewards:export",
  ],
  moderator: [
    "overview:read",
    "audit:read",
    "players:read",
    "flags:read",
    "flags:write",
    "rewards:read",
  ],
  support: ["overview:read", "audit:read", "players:read", "flags:read", "rewards:read"],
};

export function allowed(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export class AdminError extends Error {
  constructor(
    public readonly code:
      | "LAST_OWNER"
      | "CONFIRMATION_REQUIRED"
      | "MEMBER_NOT_FOUND"
      | "CSRF_REJECTED"
      | "NOT_FOUND"
      | "QUIZ_FROZEN"
      | "SLUG_EXISTS"
      | "REQUEST_CONFLICT"
      | "FLAG_CLOSED",
    public readonly statusCode = 409,
  ) {
    super(code);
  }
}
