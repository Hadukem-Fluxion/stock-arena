import { z } from "zod";
import type { HlView } from "@stock-arena/game-core";
import type { Session } from "../platform/types.js";
import { assetSchema } from "../checkin/client.js";

const stock = z
  .object({
    ticker: z.string().min(1),
    asset: assetSchema,
    priceUsd: z.string().refine((value) => Number.isFinite(Number(value)) && Number(value) > 0),
  })
  .strict();
const number = z.number().int().nonnegative();
export const hlViewSchema: z.ZodType<HlView, z.ZodTypeDef, unknown> = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    serverTime: z.string().datetime(),
    mode: z.enum(["live", "last_session"]).optional(),
    status: z.enum(["ready", "round", "feedback", "completed", "paused"]),
    runsUsed: number,
    runsLimit: number,
    maxCorrect: number,
    pointsPerCorrect: number,
    run: z
      .object({ id: z.string().uuid(), number, correctCount: number, score: number })
      .strict()
      .nullable(),
    round: z
      .object({ id: z.string().uuid(), position: number, stocks: z.tuple([stock, stock]) })
      .strict()
      .nullable(),
    feedback: z
      .object({
        correct: z.boolean(),
        choice: z.string(),
        winner: z.string(),
        stocks: z.tuple([
          stock.extend({ change24hPct: z.number().finite() }).strict(),
          stock.extend({ change24hPct: z.number().finite() }).strict(),
        ]),
      })
      .strict()
      .nullable(),
    paused: z.array(
      z
        .object({
          ticker: z.string(),
          reason: z.string(),
          nextChangeAt: z.string().datetime().nullable().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export class HlClientError extends Error {
  constructor(public readonly code: "session" | "network") {
    super(code);
  }
}
export type HlAction = "read" | "start" | "next" | "pick";
export function createHlClient(session: () => Session | null, request: typeof fetch = fetch) {
  async function call(
    action: HlAction,
    pick?: { runId: string; roundId: string; ticker: string },
  ): Promise<HlView> {
    const current = session();
    if (!current || Date.parse(current.expiresAt) <= Date.now()) throw new HlClientError("session");
    try {
      const response = await request(action === "read" ? "/api/hl" : `/api/hl/${action}`, {
        method: action === "read" ? "GET" : "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${current.token}`,
          ...(action === "read" ? {} : { "Content-Type": "application/json" }),
        },
        ...(action === "read" ? {} : { body: JSON.stringify(pick ?? {}) }),
      });
      if (response.status === 401 || response.status === 403) throw new HlClientError("session");
      if (response.status === 409 && action !== "read") return call("read");
      if (!response.ok) throw new HlClientError("network");
      return hlViewSchema.parse(await response.json());
    } catch (error) {
      throw error instanceof HlClientError ? error : new HlClientError("network");
    }
  }
  return { call };
}
