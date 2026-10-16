import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createLocalDatabase } from "./client.js";
import { quizQuestions } from "./schema.js";

describe("T10 quiz storage migration", () => {
  it("preserves pre-T10 rows, adds import slugs/explanations and enforces unique slugs", async () => {
    const connection = createLocalDatabase();
    try {
      const client = connection.db.$client;
      for (const file of [
        "0000_season-one.sql",
        "0001_immutable-ledger.sql",
        "0002_price-source.sql",
      ]) {
        await client.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
      }
      await client.query(
        'INSERT INTO quiz_questions (prompt, options, answer_index, topic) VALUES (\'Synthetic legacy question\', \'["A","B","C","D"]\', 0, \'synthetic\')',
      );
      await client.exec(
        await readFile(new URL("../drizzle/0003_quiz-storage.sql", import.meta.url), "utf8"),
      );
      const [legacy] = await connection.db.select().from(quizQuestions);
      expect(legacy).toMatchObject({
        prompt: "Synthetic legacy question",
        answerIndex: 0,
        slug: null,
        explanation: "",
      });
      await client.query(
        "UPDATE quiz_questions SET slug='synthetic-legacy', explanation='Invented explanation'",
      );
      await expect(
        client.query(
          "INSERT INTO quiz_questions (slug,prompt,options,answer_index,topic) VALUES ('synthetic-legacy','Another invented prompt','[\"A\",\"B\",\"C\",\"D\"]',1,'synthetic')",
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(client.query("UPDATE points_ledger SET amount=0")).rejects.toMatchObject({
        code: "55000",
      });
    } finally {
      await connection.close();
    }
  }, 30_000);
});
