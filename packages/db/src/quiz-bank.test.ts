import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalDatabase } from "./client.js";
import { seedQuizBank } from "./quiz-bank.js";
import { quizQuestions } from "./schema.js";

// Invented content only: never import or snapshot the private campaign bank.
const fake = {
  id: "synthetic-one",
  topic: "synthetic",
  prompt: "Which test marker is first?",
  options: ["Marker A", "Marker B", "Marker C", "Marker D"],
  answer_index: 0,
  explanation: "This synthetic fixture chooses marker A.",
};
const connection = createLocalDatabase();
beforeAll(() => connection.migrate(), 30_000);
afterAll(() => connection.close());
describe("private quiz bank import", () => {
  it("upserts by slug, keeps the UUID and does not duplicate repeat imports", async () => {
    expect(await seedQuizBank(connection, "\uFEFF" + JSON.stringify([fake]))).toBe(1);
    const [first] = await connection.db.select().from(quizQuestions);
    expect(await seedQuizBank(connection, JSON.stringify([fake]))).toBe(1);
    await seedQuizBank(
      connection,
      JSON.stringify([{ ...fake, prompt: "An edited synthetic prompt.", answer_index: 2 }]),
    );
    const rows = await connection.db.select().from(quizQuestions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first?.id,
      slug: fake.id,
      answerIndex: 2,
      prompt: "An edited synthetic prompt.",
      explanation: fake.explanation,
    });
  });
  it.each([
    "not json",
    "[]",
    JSON.stringify([fake, fake]),
    JSON.stringify([{ ...fake, options: ["A", "B", "C"] }]),
    JSON.stringify([{ ...fake, answer_index: 4 }]),
    JSON.stringify([{ ...fake, explanation: "" }]),
    JSON.stringify([fake, { ...fake, id: "bad", answer_index: -1 }]),
  ])("rejects invalid banks atomically without changing existing rows", async (source) => {
    await expect(seedQuizBank(connection, source)).rejects.toThrow();
    expect(await connection.db.select().from(quizQuestions)).toHaveLength(1);
  });
});
