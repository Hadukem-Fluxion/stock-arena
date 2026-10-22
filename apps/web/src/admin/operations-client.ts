import { z } from "zod";
import { AdminClientError } from "./client.js";

const id = z.string().uuid(),
  instant = z.string().datetime({ offset: true });
const status = z.enum(["active", "suspended", "banned"]);
const user = z.object({
  id,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: instant,
  status,
});
const question = z.object({
  id,
  slug: z.string().nullable(),
  topic: z.string(),
  prompt: z.string(),
  options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  active: z.boolean(),
  scheduledDay: z.string().nullable(),
  frozenToday: z.boolean(),
});
const paged = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ entries: z.array(item), page: z.number().int(), hasMore: z.boolean() });
const flag = z.object({
  id,
  userId: id,
  raisedBy: id,
  note: z.string(),
  state: z.enum(["open", "cleared", "actioned"]),
  createdAt: instant,
});
const profile = z.object({
  user,
  balance: z.string(),
  accountAgeDays: z.number(),
  eligibility: z.object({ accountActive: z.boolean(), verification: z.literal("pending") }),
  identities: z.array(
    z.object({
      userId: id,
      platform: z.enum(["discord", "telegram"]),
      platformUserId: z.string(),
      platformCreatedAt: instant.nullable(),
    }),
  ),
  ledger: paged(
    z.object({
      id,
      userId: id,
      amount: z.number().int(),
      reason: z.string(),
      refId: z.string(),
      createdAt: instant,
    }),
  ),
  runs: paged(
    z.object({
      id,
      model: z.enum(["classic", "prediction"]),
      day: z.string(),
      correctCount: z.number(),
      endedAt: instant.nullable(),
    }),
  ),
  predictions: z.array(
    z.object({
      id,
      runId: id,
      ticker: z.string(),
      state: z.string(),
      direction: z.string().nullable(),
      lockedAt: instant.nullable(),
      settledAt: instant.nullable(),
    }),
  ),
  classic: z.array(
    z.object({
      id,
      runId: id,
      position: z.number(),
      choice: z.string().nullable(),
      answeredAt: instant.nullable(),
    }),
  ),
  attempts: paged(
    z.object({
      day: z.string(),
      score: z.number(),
      answers: z.array(z.number()),
      startedAt: z.array(instant),
    }),
  ),
  checkins: paged(z.object({ day: z.string(), streak: z.number() })),
});
const flagsPage = paged(flag.extend({ displayName: z.string() }));
const flagDetail = z.object({
  flag,
  notes: paged(z.object({ id, flagId: id, actorId: id, note: z.string(), createdAt: instant })),
});
const ok = z.object({ ok: z.literal(true), count: z.number().optional() });
export type Question = z.infer<typeof question>;
export type QuestionInput = Pick<
  Question,
  "slug" | "topic" | "prompt" | "options" | "answerIndex" | "explanation"
> & { id?: string };
export type Player = z.infer<typeof user>;
export type Profile = z.infer<typeof profile>;
export type FlagsPage = z.infer<typeof flagsPage>;
export type FlagDetail = z.infer<typeof flagDetail>;
export type PageView<T> = { entries: T[]; page: number; hasMore: boolean };
export function createOperationsClient(fetcher: typeof fetch = fetch) {
  async function request<T>(path: string, schema: z.ZodType<T>, csrf?: string, body?: unknown) {
    let response: Response;
    try {
      response = await fetcher(`/api/admin/${path}`, {
        method: csrf ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: csrf
          ? { "Content-Type": "application/json", "X-Admin-CSRF": csrf }
          : { Accept: "application/json" },
        ...(csrf ? { body: JSON.stringify(body) } : {}),
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
  const query = (search: string, page: number) =>
    new URLSearchParams({ search, page: String(page) });
  return {
    quiz: (search = "", page = 1) => request(`quiz?${query(search, page)}`, paged(question)),
    saveQuestion: (csrf: string, input: QuestionInput) => request("quiz/save", ok, csrf, input),
    deactivate: (csrf: string, id: string) => request("quiz/deactivate", ok, csrf, { id }),
    schedule: (csrf: string, id: string, day: string | null) =>
      request("quiz/schedule", ok, csrf, { id, day }),
    importQuiz: (csrf: string, rows: unknown) => request("quiz/import", ok, csrf, rows),
    players: (search = "", page = 1) => request(`players?${query(search, page)}`, paged(user)),
    profile: (id: string, page = 1) =>
      request(`players/${encodeURIComponent(id)}?page=${page}`, profile),
    status: (csrf: string, id: string, status: Player["status"], reason: string) =>
      request(`players/${encodeURIComponent(id)}/status`, ok, csrf, { status, reason }),
    adjust: (csrf: string, id: string, amount: number, reason: string, requestId: string) =>
      request(`players/${encodeURIComponent(id)}/adjust`, ok, csrf, { amount, reason, requestId }),
    flags: (state = "open", page = 1) =>
      request(`flags?${new URLSearchParams({ state, page: String(page) })}`, flagsPage),
    flag: (id: string, page = 1) =>
      request(`flags/${encodeURIComponent(id)}?page=${page}`, flagDetail),
    raise: (csrf: string, userId: string, note: string) =>
      request("flags", ok, csrf, { userId, note }),
    note: (csrf: string, id: string, note: string) =>
      request(`flags/${encodeURIComponent(id)}/note`, ok, csrf, { note }),
    resolve: (
      csrf: string,
      id: string,
      body: { action: string; reason: string; amount?: number; requestId?: string },
    ) => request(`flags/${encodeURIComponent(id)}/resolve`, ok, csrf, body),
  };
}
