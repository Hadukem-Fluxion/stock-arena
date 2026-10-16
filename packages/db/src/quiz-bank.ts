import { z } from "zod";
import type { DatabaseConnection } from "./client.js";
import { quizQuestions } from "./schema.js";

const content = z.string().trim().min(1).max(16_000);
const bankSchema = z
  .array(
    z
      .object({
        id: z.string().trim().min(1).max(200),
        topic: content,
        prompt: content,
        options: z.tuple([content, content, content, content]),
        answer_index: z.number().int().min(0).max(3),
        explanation: content,
      })
      .strict(),
  )
  .min(1)
  .max(10_000)
  .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length);

/** Never include parser issues, source text or SQL errors in seed output. */
export async function seedQuizBank(
  connection: DatabaseConnection,
  source: string,
): Promise<number> {
  const rows = bankSchema.parse(JSON.parse(source.replace(/^\uFEFF/, "")));
  return connection.db.transaction(async (tx) => {
    for (const row of rows) {
      const values = {
        slug: row.id,
        topic: row.topic,
        prompt: row.prompt,
        options: row.options,
        answerIndex: row.answer_index,
        explanation: row.explanation,
      };
      await tx.insert(quizQuestions).values(values).onConflictDoUpdate({
        target: quizQuestions.slug,
        set: values,
      });
    }
    return rows.length;
  });
}
