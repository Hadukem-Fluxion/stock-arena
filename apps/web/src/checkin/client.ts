import { z } from "zod";
import type { CheckinView, ProviderId } from "@stock-arena/game-core";
import type { Session } from "../platform/types.js";
import { en } from "../copy/en.js";

const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:");
const assetSchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1),
  provider: z
    .string()
    .refine((value) => Object.hasOwn(en.providers, value))
    .transform((value) => value as ProviderId),
  referenceTicker: z.string().min(1),
  tradeUrl: httpsUrl,
  logo: httpsUrl,
  token: z
    .string()
    .regex(/^0x[0-9a-f]{40}$/i)
    .transform((value) => value as `0x${string}`),
  wrapped: z
    .string()
    .regex(/^0x[0-9a-f]{40}$/i)
    .transform((value) => value as `0x${string}`),
  pool: z
    .string()
    .regex(/^0x[0-9a-f]{40}$/i)
    .transform((value) => value as `0x${string}`)
    .optional(),
});
export const checkinViewSchema: z.ZodType<CheckinView, z.ZodTypeDef, unknown> = z
  .object({
    serverTime: z.string().datetime(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkedIn: z.boolean(),
    streak: z.number().int().nonnegative(),
    balance: z.number().int().safe(),
    awardsToday: z.array(z.object({ amount: z.number().int(), reason: z.string().min(1) })),
    catalog: z.record(assetSchema).refine((value) => Object.keys(value).length > 0),
    stock: z.object({
      ticker: z.string().min(1),
      asset: assetSchema,
      fact: z.string().nullable(),
      price: z.object({
        usd: z
          .string()
          .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0)
          .nullable(),
        change24hPct: z.number().finite().nullable(),
        takenAt: z.string().datetime().nullable(),
        state: z.enum(["live", "paused"]),
        reason: z.string().nullable(),
      }),
    }),
  })
  .refine((value) => Boolean(value.catalog[value.stock.ticker]));

export class CheckinError extends Error {
  constructor(public readonly code: "unavailable" | "session" | "duplicate") {
    super(code);
  }
}
export function createCheckinClient(session: () => Session | null, request: typeof fetch = fetch) {
  async function call(award: boolean): Promise<CheckinView> {
    const current = session();
    if (!current || Date.parse(current.expiresAt) <= Date.now()) throw new CheckinError("session");
    try {
      const response = await request("/api/checkin", {
        method: award ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${current.token}`,
          ...(award ? { "Content-Type": "application/json" } : {}),
        },
        ...(award ? { body: "{}" } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401) throw new CheckinError("session");
      if (response.status === 409) {
        const parsed = z
          .object({ error: z.object({ code: z.literal("ALREADY_CHECKED_IN") }) })
          .safeParse(await response.json());
        if (parsed.success) throw new CheckinError("duplicate");
      }
      if (!response.ok) throw new CheckinError("unavailable");
      const parsed = checkinViewSchema.safeParse(await response.json());
      if (!parsed.success) throw new CheckinError("unavailable");
      return parsed.data;
    } catch (error) {
      throw error instanceof CheckinError ? error : new CheckinError("unavailable");
    }
  }
  return {
    read: () => call(false),
    award: async () => {
      try {
        return await call(true);
      } catch (error) {
        if (error instanceof CheckinError && error.code === "duplicate") return call(false);
        throw error;
      }
    },
  };
}
