import { createHash, createHmac } from "node:crypto";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { GAME_CONFIG, gameDay, quizAnswerInTime, quizPoints } from "@stock-arena/game-core";
import type { QuizFeedback, QuizView } from "@stock-arena/game-core";
import {
  pointsLedger,
  quizAttempts,
  quizDailySets,
  quizQuestions,
  quizBankControl,
  gamePaused,
  users,
} from "@stock-arena/db";
import type { DatabaseConnection, QuizQuestionSnapshot } from "@stock-arena/db";
import { AuthError } from "./auth/types.js";
import { GameControlError } from "./game-control.js";

export class QuizError extends Error {
  constructor(
    public readonly code:
      "QUIZ_UNAVAILABLE" | "QUIZ_NOT_STARTED" | "QUIZ_OUT_OF_ORDER" | "QUIZ_DAY_EXPIRED",
    public readonly statusCode = 409,
  ) {
    super(code);
  }
}
type Answer = { day: string; questionId: string; position: number; choice: number | null };
type Action = { type: "read" | "start" | "next" } | { type: "answer"; answer: Answer };

function presentOptions(question: QuizQuestionSnapshot, userId: string, day: string) {
  // Private metadata in the existing frozen JSON survives restarts/key rotation.
  // Unmarked pre-update sets retain their original order for in-flight clients.
  const seed = (question as QuizQuestionSnapshot & { optionOrderSeed?: string }).optionOrderSeed;
  if (seed !== undefined && (typeof seed !== "string" || !/^[a-f0-9]{64}$/.test(seed)))
    throw new Error("Invalid quiz presentation state.");
  const order = [0, 1, 2, 3];
  if (seed) {
    const rank = (index: number) =>
      createHmac("sha256", seed)
        .update(JSON.stringify(["quiz-options-v1", userId, day, question.id, index]))
        .digest();
    const ranks = order.map(rank);
    order.sort((a, b) => Buffer.compare(ranks[a]!, ranks[b]!) || a - b);
  }
  return {
    order,
    // A validated question always has exactly four options.
    options: order.map((index) => question.options[index]!) as [string, string, string, string],
  };
}

/** Global UTC-day selection is frozen once, so edits to the seed cannot change it. */
export function createQuizStore(
  connection: DatabaseConnection,
  optionOrderSecret: string,
  now = () => new Date(),
) {
  if (Buffer.byteLength(optionOrderSecret) < 32) throw new AuthError("AUTH_UNAVAILABLE", 503);
  return async (userId: string, action: Action): Promise<QuizView> =>
    connection.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw new AuthError("UNAUTHORIZED", 401);
      if (user.status !== "active") throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
      const maintenance = await gamePaused(tx, "quiz");
      if (maintenance && action.type !== "read") throw new GameControlError();
      const instant = now();
      const day = gameDay(instant);
      const total = GAME_CONFIG.quiz.questionsPerDay;
      if (action.type === "answer" && action.answer.day !== day)
        throw new QuizError("QUIZ_DAY_EXPIRED");
      let [attempt] = await tx
        .select()
        .from(quizAttempts)
        .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.day, day)));
      let [daily] = await tx.select().from(quizDailySets).where(eq(quizDailySets.day, day));
      if (!attempt && action.type === "start") {
        await tx.select().from(quizBankControl).where(eq(quizBankControl.id, 1)).for("update");
        [daily] = await tx.select().from(quizDailySets).where(eq(quizDailySets.day, day));
        if (!daily) {
          const candidates = await tx
            .select()
            .from(quizQuestions)
            .where(
              and(
                eq(quizQuestions.active, true),
                or(eq(quizQuestions.scheduledDay, day), isNull(quizQuestions.scheduledDay)),
              ),
            )
            .orderBy(asc(quizQuestions.id));
          const rank = (id: string) => createHash("sha256").update(`${day}:${id}`).digest("hex");
          candidates.sort(
            (a, b) =>
              Number(b.scheduledDay === day) - Number(a.scheduledDay === day) ||
              rank(a.id).localeCompare(rank(b.id)),
          );
          if (candidates.length < total) throw new QuizError("QUIZ_UNAVAILABLE", 503);
          const questions: QuizQuestionSnapshot[] = candidates
            .slice(0, total)
            .map(({ id, topic, prompt, options, answerIndex, explanation }) => ({
              id,
              topic,
              prompt,
              options,
              answerIndex,
              explanation,
              optionOrderSeed: createHmac("sha256", optionOrderSecret)
                .update(JSON.stringify(["quiz-option-seed-v1", day, id]))
                .digest("hex"),
            }));
          await tx.insert(quizDailySets).values({ day, questions }).onConflictDoNothing();
          // Concurrent players converge on the same committed winner of the daily PK.
          [daily] = await tx.select().from(quizDailySets).where(eq(quizDailySets.day, day));
        }
        if (!daily || daily.questions.length !== total)
          throw new QuizError("QUIZ_UNAVAILABLE", 503);
        [attempt] = await tx
          .insert(quizAttempts)
          .values({
            userId,
            day,
            questionIds: daily.questions.map((question) => question.id),
            answers: [],
            startedAt: [instant],
            score: 0,
          })
          .returning();
      }
      if (!attempt) {
        if (action.type !== "read") throw new QuizError("QUIZ_NOT_STARTED");
        return {
          maintenance,
          day,
          serverTime: instant.toISOString(),
          status: "ready",
          total,
          answered: 0,
          score: 0,
          question: null,
          feedback: null,
        };
      }
      if (!daily || daily.questions.length !== total) throw new QuizError("QUIZ_UNAVAILABLE", 503);
      const questions = daily.questions;
      const presented = questions.map((question) => presentOptions(question, userId, day));
      const feedback = (index: number): QuizFeedback => {
        const question = questions[index];
        const choice = attempt!.answers[index];
        if (!question || choice === undefined) throw new Error("Invalid quiz state.");
        const presentation = presented[index]!;
        return {
          prompt: question.prompt,
          options: presentation.options,
          questionId: question.id,
          position: index,
          choice: choice < 0 ? null : presentation.order.indexOf(choice),
          correct: choice === question.answerIndex,
          timedOut: choice < 0,
          correctOption: presentation.order.indexOf(question.answerIndex),
          explanation: question.explanation,
        };
      };
      if (
        action.type === "next" &&
        attempt.answers.length < total &&
        attempt.startedAt.length === attempt.answers.length
      ) {
        const startedAt = [...attempt.startedAt, instant];
        await tx
          .update(quizAttempts)
          .set({ startedAt })
          .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.day, day)));
        attempt = { ...attempt, startedAt };
      }
      if (action.type === "answer") {
        const { position, questionId, choice } = action.answer;
        const question = questions[position];
        if (!question || question.id !== questionId || position > attempt.answers.length)
          throw new QuizError("QUIZ_OUT_OF_ORDER");
        // Replayed replies return the original verdict, never a second try or award.
        if (position < attempt.answers.length) {
          return {
            day,
            serverTime: instant.toISOString(),
            status: attempt.answers.length === total ? "completed" : "feedback",
            total,
            answered: attempt.answers.length,
            score: attempt.score,
            question: null,
            feedback: feedback(position),
          };
        }
        const servedAt = attempt.startedAt[position];
        if (!servedAt) throw new QuizError("QUIZ_OUT_OF_ORDER");
        const inTime = quizAnswerInTime(servedAt, instant);
        // A null choice records expiry only after the full server window, including grace.
        if (choice === null && inTime) throw new QuizError("QUIZ_OUT_OF_ORDER");
        // Persist original bank indices, preserving historical answers/admin reads.
        const answers = [
          ...attempt.answers,
          inTime && choice !== null ? presented[position]!.order[choice]! : -1,
        ];
        const correctCount = answers.filter(
          (answer, index) => answer === questions[index]?.answerIndex,
        ).length;
        const score = quizPoints(correctCount);
        await tx
          .update(quizAttempts)
          .set({ answers, score })
          .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.day, day)));
        if (answers.length === total && score > 0)
          await tx.insert(pointsLedger).values({
            userId,
            amount: score,
            reason: "quiz",
            refId: `quiz:${day}`,
            createdAt: instant,
          });
        attempt = { ...attempt, answers, score };
      }
      const answered = attempt.answers.length;
      const servedAt = attempt.startedAt[answered];
      const question = questions[answered];
      const current =
        answered < total && servedAt && question
          ? {
              id: question.id,
              position: answered,
              topic: question.topic,
              prompt: question.prompt,
              options: presented[answered]!.options,
              servedAt: servedAt.toISOString(),
              deadline: new Date(
                servedAt.getTime() + GAME_CONFIG.quiz.secondsPerQuestion * 1000,
              ).toISOString(),
            }
          : null;
      return {
        maintenance,
        day,
        serverTime: instant.toISOString(),
        status: answered === total ? "completed" : current ? "question" : "feedback",
        total,
        answered,
        score: attempt.score,
        question: current,
        feedback: answered ? feedback(answered - 1) : null,
      };
    });
}

export function registerQuiz(
  app: FastifyInstance,
  options: { database: () => DatabaseConnection; now?: () => Date; optionOrderSecret: string },
) {
  let store: ReturnType<typeof createQuizStore> | undefined;
  const empty = z.object({}).strict();
  const body = z
    .object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      questionId: z.string().uuid(),
      position: z
        .number()
        .int()
        .min(0)
        .max(GAME_CONFIG.quiz.questionsPerDay - 1),
      choice: z.number().int().min(0).max(3).nullable(),
    })
    .strict();
  for (const action of ["read", "start", "next", "answer"] as const)
    app.route({
      method: action === "read" ? "GET" : "POST",
      url: action === "read" ? "/api/quiz" : `/api/quiz/${action}`,
      handler: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        if (!empty.safeParse(request.query).success) throw new AuthError("INVALID_INPUT", 400);
        if (!request.user) throw new AuthError("UNAUTHORIZED", 401);
        store ??= createQuizStore(options.database(), options.optionOrderSecret, options.now);
        if (action === "answer") {
          const parsed = body.safeParse(request.body);
          if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
          return store(request.user.id, { type: "answer", answer: parsed.data });
        }
        if (action !== "read" && !empty.safeParse(request.body ?? {}).success)
          throw new AuthError("INVALID_INPUT", 400);
        return store(request.user.id, { type: action });
      },
    });
}
