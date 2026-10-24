import { sql } from "drizzle-orm";
import type { DatabaseConnection } from "./client.js";
import { quizBankControl, quizQuestions } from "./schema.js";

/** Explicit operator copy: only game content, never player/point/admin history. */
export async function copyGameContent(
  source: DatabaseConnection,
  target: DatabaseConnection,
  dryRun = false,
) {
  const content = await source.db.transaction(
    async (tx) => {
      const questions = await tx.select().from(quizQuestions).orderBy(quizQuestions.id);
      const table = await tx.execute<{ present: boolean }>(
        sql`SELECT to_regclass('public.quiz_bank_control') IS NOT NULL AS present`,
      );
      const control = table.rows[0]?.present ? await tx.select().from(quizBankControl) : [];
      if (!questions.length || control.some((row) => row.id !== 1))
        throw new Error("Invalid source content.");
      return { questions, control };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return target.db.transaction(async (tx) => {
    // Prevent the first player/owner or a bank editor from racing the fresh-target check.
    await tx.execute(sql`LOCK TABLE users, quiz_questions, quiz_bank_control IN EXCLUSIVE MODE`);
    const emptyTables = [
      "users",
      "identities",
      "checkins",
      "quiz_attempts",
      "quiz_daily_sets",
      "hl_runs",
      "hl_rounds",
      "hl_predictions",
      "points_ledger",
      "referrals",
      "staff",
      "flags",
      "flag_notes",
      "admin_actions",
      "admin_sessions",
      "admin_oauth_states",
      "reward_destinations",
      "reward_destination_history",
      "reward_locks",
      "reward_prizes",
      "reward_snapshots",
      "reward_entries",
      "reward_events",
    ];
    const occupied = await tx.execute(
      sql.join(
        emptyTables.map(
          (table) =>
            sql`SELECT ${table}::text AS occupied WHERE EXISTS (SELECT 1 FROM ${sql.identifier(table)})`,
        ),
        sql` UNION ALL `,
      ),
    );
    if (occupied.rows.length) throw new Error("Destination must be a fresh staging database.");
    const previous = await tx.select({ id: quizQuestions.id }).from(quizQuestions);
    const ids = new Set(content.questions.map((row) => row.id));
    if (previous.some((row) => !ids.has(row.id)))
      throw new Error("Destination has unrelated content.");
    if (!dryRun) {
      for (let offset = 0; offset < content.questions.length; offset += 500) {
        await tx
          .insert(quizQuestions)
          .values(content.questions.slice(offset, offset + 500))
          .onConflictDoUpdate({
            target: quizQuestions.id,
            set: {
              slug: sql`excluded.slug`,
              explanation: sql`excluded.explanation`,
              prompt: sql`excluded.prompt`,
              options: sql`excluded.options`,
              answerIndex: sql`excluded.answer_index`,
              topic: sql`excluded.topic`,
              active: sql`excluded.active`,
              scheduledDay: sql`excluded.scheduled_day`,
            },
          });
      }
      // Older staging schemas have no bank-control table; migration 0010 seeds this singleton.
      await tx
        .insert(quizBankControl)
        .values(content.control.length ? content.control : [{ id: 1 }])
        .onConflictDoNothing();
      const copied = await tx.select().from(quizQuestions).orderBy(quizQuestions.id);
      if (JSON.stringify(copied) !== JSON.stringify(content.questions))
        throw new Error("Content verification failed.");
    }
    return { quiz_questions: content.questions.length, quiz_bank_control: 1 };
  });
}

export function gameContentUrls(env: Record<string, string | undefined>) {
  const settings = [
    [env.OLD_DATABASE_URL, "aws-1-sa-east-1.pooler.supabase.com", "postgres.djlyrllwnvvljxexusbw"],
    [env.NEW_DATABASE_URL, "aws-0-us-east-2.pooler.supabase.com", "postgres.fhslaelrgoiibblgfinu"],
  ] as const;
  try {
    return settings.map(([value, host, user]) => {
      const url = new URL(value ?? "");
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        url.hostname !== host ||
        url.username !== user ||
        url.port !== "5432" ||
        url.pathname !== "/postgres" ||
        !url.password ||
        /^(?:SENHA|<SENHA>|SUA[-_ ]SENHA|PLACEHOLDER|CHANGE_ME)$/i.test(
          decodeURIComponent(url.password),
        ) ||
        url.searchParams.get("sslmode") !== "require"
      )
        throw new Error();
      return url.toString();
    });
  } catch {
    throw new Error("Invalid content-copy configuration.");
  }
}
