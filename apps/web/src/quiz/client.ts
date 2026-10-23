import { z } from "zod";
import type { QuizView } from "@stock-arena/game-core";
import type { Session } from "../platform/types.js";

const index = z.number().int().min(0).max(3);
const content = z.string();
const options = z.tuple([content, content, content, content]);
export const quizViewSchema: z.ZodType<QuizView> = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    serverTime: z.string().datetime(),
    maintenance: z.boolean().optional(),
    status: z.enum(["ready", "question", "feedback", "completed"]),
    total: z.number().int().positive(),
    answered: z.number().int().nonnegative(),
    score: z.number().int().nonnegative(),
    question: z
      .object({
        id: z.string().uuid(),
        position: z.number().int().nonnegative(),
        topic: content,
        prompt: content,
        options,
        servedAt: z.string().datetime(),
        deadline: z.string().datetime(),
      })
      .strict()
      .nullable(),
    feedback: z
      .object({
        prompt: content,
        options,
        questionId: z.string().uuid(),
        position: z.number().int().nonnegative(),
        choice: index.nullable(),
        correct: z.boolean(),
        timedOut: z.boolean(),
        correctOption: index,
        explanation: content,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .refine(
    (view) =>
      (view.status === "question") === Boolean(view.question) && view.answered <= view.total,
  );
export class QuizClientError extends Error {
  constructor(public readonly code: "unavailable" | "session" | "network") {
    super(code);
  }
}
export type QuizAction = "read" | "start" | "next" | "answer";
export function createQuizClient(session: () => Session | null, request: typeof fetch = fetch) {
  async function call(
    action: QuizAction,
    answer?: { day: string; questionId: string; position: number; choice: number | null },
  ): Promise<QuizView> {
    const current = session();
    if (!current || Date.parse(current.expiresAt) <= Date.now())
      throw new QuizClientError("session");
    try {
      const response = await request(action === "read" ? "/api/quiz" : `/api/quiz/${action}`, {
        method: action === "read" ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${current.token}`,
          ...(action === "read" ? {} : { "Content-Type": "application/json" }),
        },
        ...(action === "read" ? {} : { body: JSON.stringify(answer ?? {}) }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401 || response.status === 403) throw new QuizClientError("session");
      if (response.status === 409 && action !== "read") return call("read");
      if (response.status === 503) throw new QuizClientError("unavailable");
      if (!response.ok) throw new QuizClientError("network");
      return quizViewSchema.parse(await response.json());
    } catch (error) {
      throw error instanceof QuizClientError ? error : new QuizClientError("network");
    }
  }
  return { call };
}
