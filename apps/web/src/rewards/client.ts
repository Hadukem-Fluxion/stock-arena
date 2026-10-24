import { z } from "zod";
import { AdminClientError } from "../admin/client.js";
import type { PlatformAdapter } from "../platform/types.js";
const instant = z.string().datetime({ offset: true });
export const destination = z.object({
  bybitUid: z.string(),
  mantleAddress: z.string(),
  changedAt: instant.nullable(),
});
const values = z.object({ bybitUid: z.string(), mantleAddress: z.string() });
export const historyRow = z.object({
  id: z.string(),
  oldValues: values,
  newValues: values,
  changedAt: instant,
  actor: z.enum(["player", "staff"]),
});
export const profileSchema = destination.extend({
  locked: z.boolean(),
  lockedSeasons: z.array(z.string()),
  history: z.array(historyRow),
});
export type Destination = z.infer<typeof destination>;
export function createRewardProfileClient(platform: PlatformAdapter) {
  async function request(body?: Destination & { confirmed: true }) {
    if (!platform.session) throw new AdminClientError("UNAUTHORIZED");
    const response = await fetch("/api/rewards/destination", {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${platform.session.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body
        ? {
            body: JSON.stringify({
              bybitUid: body.bybitUid,
              mantleAddress: body.mantleAddress,
              expectedChangedAt: body.changedAt,
              confirmed: true,
            }),
          }
        : {}),
    });
    const raw: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(raw);
      throw new AdminClientError(error.success ? error.data.error.code : "INVALID_RESPONSE");
    }
    return body ? z.object({ ok: z.literal(true) }).parse(raw) : profileSchema.parse(raw);
  }
  return {
    read: async () => profileSchema.parse(await request()),
    save: (body: Destination & { confirmed: true }) => request(body),
  };
}
