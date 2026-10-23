import { z } from "zod";
import type { PredictionView } from "@stock-arena/game-core";
import type { Session } from "../platform/types.js";
import { assetSchema } from "../checkin/client.js";
const instant = z.string().datetime();
const price = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .nullable();
const count = z.number().int().nonnegative();
export const hlViewSchema: z.ZodType<PredictionView, z.ZodTypeDef, unknown> = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    serverTime: instant,
    maintenance: z.boolean().optional(),
    runsUsed: count,
    runsLimit: count,
    maxCorrect: count,
    pointsPerCorrect: count,
    canStart: z.boolean(),
    runs: z.array(
      z
        .object({
          id: z.string().uuid(),
          day: z.string(),
          number: count,
          correctCount: count,
          score: count,
          canPick: z.boolean(),
          endedAt: instant.nullable(),
          expiresAt: instant,
          round: z
            .object({
              id: z.string().uuid(),
              ticker: z.string().min(1),
              asset: assetSchema,
              state: z.enum([
                "offered",
                "waiting_open",
                "waiting_start",
                "pending",
                "won",
                "lost",
                "equal",
                "void",
              ]),
              direction: z.enum(["up", "down"]).nullable(),
              lockedAt: instant.nullable(),
              scheduledOpenAt: instant.nullable(),
              startPrice: price,
              startTakenAt: instant.nullable(),
              targetAt: instant.nullable(),
              endPrice: price,
              endTakenAt: instant.nullable(),
              settledAt: instant.nullable(),
              changePct: z.string().nullable(),
            })
            .strict()
            .nullable(),
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
  let requestId: string | null = null;
  async function call(
    action: HlAction,
    payload?: { runId: string; roundId?: string; direction?: "up" | "down" },
  ): Promise<PredictionView> {
    const current = session();
    if (!current || Date.parse(current.expiresAt) <= Date.now()) throw new HlClientError("session");
    const body =
      action === "start" ? { requestId: (requestId ??= crypto.randomUUID()) } : (payload ?? {});
    try {
      const response = await request(action === "read" ? "/api/hl" : `/api/hl/${action}`, {
        method: action === "read" ? "GET" : "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${current.token}`,
          ...(action === "read" ? {} : { "Content-Type": "application/json" }),
        },
        ...(action === "read" ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 401 || response.status === 403) throw new HlClientError("session");
      if (response.status === 409 && action !== "read") return call("read");
      if (!response.ok) throw new HlClientError("network");
      const result = hlViewSchema.parse(await response.json());
      if (action === "start") requestId = null;
      return result;
    } catch (cause) {
      throw cause instanceof HlClientError ? cause : new HlClientError("network");
    }
  }
  return { call };
}
