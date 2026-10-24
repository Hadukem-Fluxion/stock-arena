import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalDatabase,
  identities,
  pointsLedger,
  quizAttempts,
  quizDailySets,
  quizQuestions,
  users,
} from "@stock-arena/db";
import type { QuizView } from "@stock-arena/game-core";
import { eq, sql } from "drizzle-orm";
import { buildServer } from "./server.js";
import { createSessions } from "./auth/session.js";
import { createQuizStore } from "./quiz.js";

const connection = createLocalDatabase();
const secret = "synthetic-quiz-session-secret-never-used-in-production";
let now = new Date("2026-10-16T12:00:00Z");
beforeAll(() => connection.migrate(), 30_000);
afterAll(() => connection.close());
beforeEach(async () => {
  now = new Date("2026-10-16T12:00:00Z");
  await connection.db.delete(quizDailySets);
  await connection.db.delete(quizQuestions);
  await connection.db.insert(quizQuestions).values(
    Array.from({ length: 3 }, (_, index) => ({
      slug: `synthetic-${index}`,
      topic: "synthetic",
      prompt: `Pick the synthetic marker ${index}.`,
      options: ["Test A", "Test B", "Test C", "Test D"] as [string, string, string, string],
      answerIndex: 0,
      explanation: "This is invented test content, with marker A as the key.",
    })),
  );
});
async function player(id = randomUUID()) {
  const [user] = await connection.db
    .insert(users)
    .values({ id, displayName: "Quiz test player" })
    .returning();
  if (!user) throw new Error("Missing fixture user");
  const identity = { platform: "telegram" as const, platformUserId: randomUUID() };
  await connection.db.insert(identities).values({ userId: user.id, ...identity });
  const session = await createSessions(secret, () => now).issue({
    id: user.id,
    displayName: user.displayName,
    avatarUrl: null,
    identity,
  });
  const app = buildServer({
    auth: { database: connection, env: { SESSION_SECRET: secret }, now: () => now },
    logger: false,
  });
  const call = (route = "start", body: Record<string, unknown> = {}) =>
    app.inject({
      method: route === "read" ? "GET" : "POST",
      url: route === "read" ? "/api/quiz" : `/api/quiz/${route}`,
      headers: { authorization: `Bearer ${session.token}` },
      ...(route === "read" ? {} : { payload: body }),
    });
  const answer = (
    view: QuizView,
    choice: number | null = view.question?.options.indexOf("Test A") ?? 0,
  ) =>
    call("answer", {
      day: view.day,
      position: view.question?.position,
      questionId: view.question?.id,
      choice,
    });
  return { app, user, call, answer };
}
describe("daily quiz", () => {
  it("keeps a player's daily order across reads/restarts/key rotation and varies it by player/day", async () => {
    now = new Date("2026-10-16T23:59:30Z");
    const questionId = "10000000-0000-4000-8000-000000000001";
    await connection.db.insert(quizQuestions).values({
      id: questionId,
      topic: "synthetic",
      prompt: "Choose an invented marker for this ordering test.",
      options: ["Test A", "Test B", "Test C", "Test D"],
      answerIndex: 0,
      scheduledDay: "2026-10-16",
    });
    const first = await player("20000000-0000-4000-8000-000000000001");
    const second = await player("20000000-0000-4000-8000-000000000002");
    try {
      const initial = (await first.call()).json<QuizView>();
      const other = (await second.call()).json<QuizView>();
      expect(initial.question?.id).toBe(questionId);
      expect(other.question?.id).toBe(questionId);
      expect([...initial.question!.options].sort()).toEqual([
        "Test A",
        "Test B",
        "Test C",
        "Test D",
      ]);
      expect(other.question?.options).not.toEqual(initial.question?.options);
      for (const action of ["read", "start", "next"])
        expect((await first.call(action)).json<QuizView>().question).toEqual(initial.question);
      const resumed = await createQuizStore(
        connection,
        "rotated-synthetic-session-secret-for-this-test-only",
        () => now,
      )(first.user.id, { type: "read" });
      expect(resumed.question).toEqual(initial.question);
      const [frozen] = await connection.db.select().from(quizDailySets);
      expect(JSON.stringify(frozen?.questions)).toContain("optionOrderSeed");
      expect(JSON.stringify(initial)).not.toContain("optionOrderSeed");
      await connection.db
        .update(quizQuestions)
        .set({ scheduledDay: "2026-10-17" })
        .where(eq(quizQuestions.id, questionId));
      now = new Date("2026-10-17T00:00:01Z");
      const tomorrow = (await first.call()).json<QuizView>();
      expect(tomorrow.question?.id).toBe(questionId);
      expect(tomorrow.question?.options).not.toEqual(initial.question?.options);
      expect((await first.call("read")).json<QuizView>().question).toEqual(tomorrow.question);
    } finally {
      await first.app.close();
      await second.app.close();
    }
  });

  it.each([0, 1, 2, 3])(
    "maps the displayed answer to original key %s and awards the same perfect score once",
    async (originalIndex) => {
      await connection.db.update(quizQuestions).set({ answerIndex: originalIndex });
      const bank = await connection.db.select().from(quizQuestions);
      const p = await player();
      try {
        let view = (await p.call()).json<QuizView>();
        let lastQuestion = view;
        for (let position = 0; position < 3; position++) {
          lastQuestion = view;
          const options = view.question!.options;
          const choice = options.indexOf(["Test A", "Test B", "Test C", "Test D"][originalIndex]!);
          view = (await p.answer(view, choice)).json<QuizView>();
          expect(JSON.stringify(view)).not.toContain("optionOrderSeed");
          expect(JSON.stringify(view)).not.toContain(secret);
          expect(view.feedback).toMatchObject({
            options,
            correct: true,
            choice,
            correctOption: choice,
            timedOut: false,
          });
          const [attempt] = await connection.db
            .select()
            .from(quizAttempts)
            .where(eq(quizAttempts.userId, p.user.id));
          expect(attempt?.answers).toEqual(Array(position + 1).fill(originalIndex));
          if (position < 2) view = (await p.call("next")).json<QuizView>();
        }
        expect(view).toMatchObject({ status: "completed", score: 75, answered: 3 });
        const replay = (
          await p.answer(lastQuestion, (view.feedback!.correctOption + 1) % 4)
        ).json<QuizView>();
        expect(replay.feedback).toEqual(view.feedback);
        const ledger = await connection.db
          .select()
          .from(pointsLedger)
          .where(eq(pointsLedger.userId, p.user.id));
        expect(ledger.map((row) => row.amount)).toEqual([75]);
        expect(await connection.db.select().from(quizQuestions)).toEqual(bank);
      } finally {
        await p.app.close();
      }
    },
  );

  it.each([0, 1, 3])(
    "preserves pre-update frozen sets and %s original answers without rewriting the bank",
    async (answered) => {
      const bank = await connection.db.select().from(quizQuestions);
      const questions = bank.map(({ id, topic, prompt, options, answerIndex, explanation }) => ({
        id,
        topic,
        prompt,
        options,
        answerIndex,
        explanation,
      }));
      await connection.db.insert(quizDailySets).values({ day: "2026-10-16", questions });
      const p = await player();
      try {
        await connection.db.insert(quizAttempts).values({
          userId: p.user.id,
          day: "2026-10-16",
          questionIds: questions.map((q) => q.id),
          answers: Array(answered).fill(0),
          startedAt: Array(Math.max(1, answered)).fill(now),
          score: answered === 3 ? 75 : answered * 20,
        });
        if (answered === 3)
          await connection.db
            .insert(pointsLedger)
            .values({ userId: p.user.id, amount: 75, reason: "quiz", refId: "quiz:2026-10-16" });
        let view = (await p.call("read")).json<QuizView>();
        if (answered > 0)
          expect(view.feedback).toMatchObject({
            correct: true,
            choice: 0,
            correctOption: 0,
            options: questions[0]!.options,
          });
        if (answered === 1) view = (await p.call("next")).json<QuizView>();
        for (let i = answered; i < 3; i++) {
          expect(view.question?.options).toEqual(questions[i]!.options);
          view = (await p.answer(view, 0)).json<QuizView>();
          expect(view.feedback).toMatchObject({ correct: true, choice: 0, correctOption: 0 });
          if (i < 2) view = (await p.call("next")).json<QuizView>();
        }
        expect(view.score).toBe(75);
        expect((await p.call("read")).json<QuizView>().feedback).toEqual(view.feedback);
        const [frozen] = await connection.db.select().from(quizDailySets);
        expect(frozen?.questions).toEqual(questions);
        expect(await connection.db.select().from(quizQuestions)).toEqual(bank);
        expect(
          (
            await connection.db
              .select()
              .from(pointsLedger)
              .where(eq(pointsLedger.userId, p.user.id))
          ).map((row) => row.amount),
        ).toEqual([75]);
      } finally {
        await p.app.close();
      }
    },
  );

  it("uses scheduled questions first, freezes one selection for all players and exposes no future key", async () => {
    const scheduledId = randomUUID();
    await connection.db.insert(quizQuestions).values([
      {
        id: scheduledId,
        slug: "scheduled",
        topic: "synthetic",
        prompt: "Scheduled synthetic marker?",
        options: ["A", "B", "C", "D"],
        answerIndex: 0,
        scheduledDay: "2026-10-16",
      },
      {
        slug: "future",
        topic: "synthetic",
        prompt: "Future test",
        options: ["A", "B", "C", "D"],
        answerIndex: 0,
        scheduledDay: "2026-10-17",
      },
      {
        slug: "inactive",
        topic: "synthetic",
        prompt: "Inactive test",
        options: ["A", "B", "C", "D"],
        answerIndex: 0,
        active: false,
      },
    ]);
    const first = await player();
    const second = await player();
    try {
      const start = await first.call();
      const view = start.json<QuizView>();
      expect(start.statusCode).toBe(200);
      expect(start.headers["cache-control"]).toBe("no-store");
      expect(view.question?.id).toBe(scheduledId);
      expect(view.feedback).toBeNull();
      expect(Object.keys(view.question!).sort()).toEqual([
        "deadline",
        "id",
        "options",
        "position",
        "prompt",
        "servedAt",
        "topic",
      ]);
      expect(start.body).not.toMatch(
        /answer_index|answerIndex|correctOption|explanation|optionOrderSeed/,
      );
      await connection.db
        .update(quizQuestions)
        .set({ prompt: "Changed after selection", answerIndex: 3, active: false });
      const other = (await second.call()).json<QuizView>().question!;
      expect({ ...other, options: undefined }).toEqual({ ...view.question, options: undefined });
      expect([...other.options].sort()).toEqual([...view.question!.options].sort());
      const [daily] = await connection.db.select().from(quizDailySets);
      expect(daily?.questions).toHaveLength(3);
      expect(new Set(daily?.questions.map((question) => question.id)).size).toBe(3);
      expect(
        daily?.questions.some((question) =>
          ["Future test", "Inactive test"].includes(question.prompt),
        ),
      ).toBe(false);
      expect(
        (await first.answer(view, view.question!.options.indexOf("A"))).json<QuizView>().feedback
          ?.correct,
      ).toBe(true);
    } finally {
      await first.app.close();
      await second.app.close();
    }
  });
  it("resumes one attempt and cannot reset the first or subsequent question clocks", async () => {
    const p = await player();
    try {
      const first = (await p.call()).json<QuizView>();
      now = new Date(now.getTime() + 10_000);
      const starts = await Promise.all([p.call(), p.call(), p.call("read")]);
      for (const response of starts)
        expect(response.json<QuizView>().question?.servedAt).toBe(first.question?.servedAt);
      expect(
        await connection.db.select().from(quizAttempts).where(eq(quizAttempts.userId, p.user.id)),
      ).toHaveLength(1);
      const replied = (await p.answer(first)).json<QuizView>();
      expect(replied.status).toBe("feedback");
      expect(replied.question).toBeNull();
      now = new Date(now.getTime() + 90_000);
      const next = (await p.call("next")).json<QuizView>();
      expect(next.question?.servedAt).toBe(now.toISOString());
      now = new Date(now.getTime() + 4_000);
      expect((await p.call("next")).json<QuizView>().question?.servedAt).toBe(
        next.question?.servedAt,
      );
    } finally {
      await p.app.close();
    }
  });
  it("converges on one daily set when different players start concurrently", async () => {
    const a = await player();
    const b = await player();
    try {
      const results = await Promise.all([a.call(), b.call()]);
      expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
      expect(results[0]!.json<QuizView>().question?.id).toBe(
        results[1]!.json<QuizView>().question?.id,
      );
      expect(await connection.db.select().from(quizDailySets)).toHaveLength(1);
    } finally {
      await a.app.close();
      await b.app.close();
    }
  });
  it.each([
    [30_000, true],
    [32_000, true],
    [32_001, false],
  ])("validates the server timer at %sms", async (elapsed, correct) => {
    const p = await player();
    try {
      const view = (await p.call()).json<QuizView>();
      now = new Date(now.getTime() + Number(elapsed));
      const result = (await p.answer(view)).json<QuizView>();
      expect(result.feedback).toMatchObject({ correct, timedOut: !correct });
      expect(result.score).toBe(correct ? 20 : 0);
      expect(result.feedback?.correctOption).toBe(view.question!.options.indexOf("Test A"));
      expect(result.feedback?.explanation).toContain("invented test content");
    } finally {
      await p.app.close();
    }
  });
  it.each([
    [0, 0, 0, 75],
    [0, 1, 1, 20],
    [1, 1, 1, 0],
  ])("awards only the final server score (%s,%s,%s -> %s)", async (a, b, c, total) => {
    const p = await player();
    try {
      let view = (await p.call()).json<QuizView>();
      for (const choice of [a, b, c]) {
        const displayChoice = view.question!.options.indexOf(["Test A", "Test B"][choice]!);
        view = (await p.answer(view, displayChoice)).json<QuizView>();
        if (view.status !== "completed") {
          expect(
            await connection.db
              .select()
              .from(pointsLedger)
              .where(eq(pointsLedger.userId, p.user.id)),
          ).toHaveLength(0);
          view = (await p.call("next")).json<QuizView>();
        }
      }
      expect(view).toMatchObject({
        status: "completed",
        score: total,
        answered: 3,
        question: null,
      });
      const ledger = await connection.db
        .select()
        .from(pointsLedger)
        .where(eq(pointsLedger.userId, p.user.id));
      expect(ledger.map((row) => row.amount)).toEqual(total ? [total] : []);
      expect((await p.call()).json<QuizView>().status).toBe("completed");
    } finally {
      await p.app.close();
    }
  });
  it("rejects future questions, invalid choices and unauthorized or suspended players", async () => {
    const p = await player();
    try {
      expect(
        (await p.app.inject({ method: "POST", url: "/api/quiz/start", payload: {} })).statusCode,
      ).toBe(401);
      expect((await p.call("answer", { choice: 0 })).statusCode).toBe(400);
      const view = (await p.call()).json<QuizView>();
      const future = { day: view.day, questionId: randomUUID(), position: 2, choice: 0 };
      expect((await p.call("answer", future)).statusCode).toBe(409);
      expect((await p.call("start", { score: 75 })).statusCode).toBe(400);
      expect((await p.answer(view, null)).statusCode).toBe(409);
      await connection.db.update(users).set({ status: "suspended" }).where(eq(users.id, p.user.id));
      expect((await p.answer(view)).statusCode).toBe(403);
    } finally {
      await p.app.close();
    }
  });
  it("serializes concurrent starts and replies, and final award retries cannot double points", async () => {
    const p = await player();
    try {
      const starts = await Promise.all([p.call(), p.call(), p.call()]);
      expect(starts.every((response) => response.statusCode === 200)).toBe(true);
      let view = starts[0]!.json<QuizView>();
      for (let index = 0; index < 3; index++) {
        const replies = await Promise.all([p.answer(view), p.answer(view), p.answer(view)]);
        expect(replies.every((response) => response.json<QuizView>().answered === index + 1)).toBe(
          true,
        );
        expect((await p.answer(view, 3)).json<QuizView>().feedback?.correct).toBe(true);
        if (index < 2) view = (await p.call("next")).json<QuizView>();
      }
      const ledger = await connection.db
        .select()
        .from(pointsLedger)
        .where(eq(pointsLedger.userId, p.user.id));
      expect(ledger.map((row) => row.amount)).toEqual([75]);
    } finally {
      await p.app.close();
    }
  });
  it("rolls back the last answer when the ledger insert fails", async () => {
    const p = await player();
    try {
      let view = (await p.call()).json<QuizView>();
      for (let i = 0; i < 2; i++) {
        await p.answer(view);
        view = (await p.call("next")).json<QuizView>();
      }
      await connection.db
        .insert(pointsLedger)
        .values({ userId: p.user.id, amount: 75, reason: "quiz", refId: `quiz:${view.day}` });
      expect((await p.answer(view)).statusCode).toBe(500);
      const [attempt] = await connection.db
        .select()
        .from(quizAttempts)
        .where(eq(quizAttempts.userId, p.user.id));
      expect(attempt?.answers).toHaveLength(2);
    } finally {
      await p.app.close();
    }
  });
  it("uses the UTC day and rejects a reply from yesterday", async () => {
    const p = await player();
    try {
      now = new Date("2026-10-16T23:59:59Z");
      const view = (await p.call()).json<QuizView>();
      now = new Date("2026-10-17T00:00:00Z");
      expect((await p.answer(view)).json()).toEqual({ error: { code: "QUIZ_DAY_EXPIRED" } });
      expect((await p.call()).json<QuizView>()).toMatchObject({
        day: "2026-10-17",
        answered: 0,
        status: "question",
      });
    } finally {
      await p.app.close();
    }
  });
  it("does not consume an attempt when fewer than three active questions exist", async () => {
    const p = await player();
    try {
      await connection.db.execute(sql`DELETE FROM quiz_questions`);
      expect((await p.call()).json()).toEqual({ error: { code: "QUIZ_UNAVAILABLE" } });
      expect(
        await connection.db.select().from(quizAttempts).where(eq(quizAttempts.userId, p.user.id)),
      ).toHaveLength(0);
      expect((await p.call("read")).json<QuizView>().status).toBe("ready");
    } finally {
      await p.app.close();
    }
  });
});
