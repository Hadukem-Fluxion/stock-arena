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
  "referrals:read",
  "referrals:write",
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
    "referrals:read",
    "referrals:write",
  ],
  moderator: [
    "overview:read",
    "audit:read",
    "players:read",
    "flags:read",
    "flags:write",
    "rewards:read",
    "referrals:read",
  ],
  support: [
    "overview:read",
    "audit:read",
    "players:read",
    "flags:read",
    "rewards:read",
    "referrals:read",
  ],
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
      | "FLAG_CLOSED"
      | "SEASON_ORDER"
      | "SEASON_OVERLAP"
      | "SEASON_EXISTS"
      | "REWARDS_LOCKED"
      | "REWARDS_FROZEN"
      | "PRIZE_OVERLAP"
      | "PRIZE_MISSING"
      | "SEASON_NOT_ENDED"
      | "REWARD_TRANSITION"
      | "PLAYER_INACTIVE",
    public readonly statusCode = 409,
  ) {
    super(code);
  }
}
