import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createLocalDatabase } from "./client.js";
import { copyGameContent, gameContentUrls } from "./game-content.js";
import { quizQuestions, quizBankControl, users, identities, pointsLedger } from "./schema.js";

const source = createLocalDatabase(),
  target = createLocalDatabase();
const question = {
  id: randomUUID(),
  slug: "synthetic-copy",
  prompt: "Fictional copy marker?",
  options: ["Mock A", "Mock B", "Mock C", "Mock D"] as [string, string, string, string],
  answerIndex: 1,
  explanation: "An invented test explanation.",
  topic: "synthetic",
  active: true,
  scheduledDay: null,
};
beforeAll(async () => {
  await source.migrate();
  await target.migrate();
}, 30000);
afterAll(async () => {
  await source.close();
  await target.close();
});
describe("Ohio operator game-content copy", () => {
  it("CLI refuses missing/invalid URLs without reading .env or echoing configuration", () => {
    const marker = "synthetic-sensitive-copy-marker";
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "packages/db/src/copy-game-content.ts"],
      {
        encoding: "utf8",
        env: { ...process.env, OLD_DATABASE_URL: marker, NEW_DATABASE_URL: marker },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(marker);
    expect(result.stderr).toContain("Game content copy failed.");
  });
  it("copies only content, supports dry-run/retry and leaves the source intact", async () => {
    await source.db.insert(quizQuestions).values(question);
    const [player] = await source.db
      .insert(users)
      .values({ displayName: "Private synthetic player" })
      .returning();
    await source.db
      .insert(identities)
      .values({ userId: player!.id, platform: "discord", platformUserId: "111111111111111111" });
    await source.db
      .insert(pointsLedger)
      .values({ userId: player!.id, amount: 10, reason: "checkin", refId: "synthetic-copy" });
    expect(await copyGameContent(source, target, true)).toEqual({
      quiz_questions: 1,
      quiz_bank_control: 1,
    });
    expect(await target.db.select().from(quizQuestions)).toEqual([]);
    for (let i = 0; i < 2; i++)
      expect(await copyGameContent(source, target)).toEqual({
        quiz_questions: 1,
        quiz_bank_control: 1,
      });
    expect(await target.db.select().from(quizQuestions)).toEqual(
      await source.db.select().from(quizQuestions),
    );
    expect(await target.db.select().from(quizBankControl)).toEqual([{ id: 1 }]);
    for (const table of [users, identities, pointsLedger])
      expect(await target.db.select().from(table)).toEqual([]);
    expect(await source.db.select().from(users)).toHaveLength(1);
    expect(await source.db.select().from(pointsLedger)).toHaveLength(1);
  });
  it("supports a source older than migration 0010 without modifying it", async () => {
    await source.db.execute(sql.raw("DROP TABLE quiz_bank_control"));
    expect(await copyGameContent(source, target)).toEqual({
      quiz_questions: 1,
      quiz_bank_control: 1,
    });
    const table = await source.db.execute(
      sql`SELECT to_regclass('public.quiz_bank_control') AS name`,
    );
    expect(table.rows[0]?.name).toBeNull();
  });
  it("rolls back a failed content write and refuses unrelated target content", async () => {
    const other = createLocalDatabase();
    await other.migrate();
    try {
      await other.db.execute(
        sql.raw(
          "CREATE FUNCTION fail_copy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure'; END $$",
        ),
      );
      await other.db.execute(
        sql.raw(
          "CREATE TRIGGER fail_copy BEFORE INSERT ON quiz_questions FOR EACH ROW EXECUTE FUNCTION fail_copy()",
        ),
      );
      await expect(copyGameContent(source, other)).rejects.toThrow();
      expect(await other.db.select().from(quizQuestions)).toEqual([]);
      await other.db.execute(sql.raw("DROP TRIGGER fail_copy ON quiz_questions"));
      await other.db
        .insert(quizQuestions)
        .values({ ...question, id: randomUUID(), slug: "unrelated-synthetic" });
      await expect(copyGameContent(source, other)).rejects.toThrow(
        "Destination has unrelated content.",
      );
    } finally {
      await other.close();
    }
  });
  it("refuses a destination after the first player/owner exists", async () => {
    await target.db.insert(users).values({ displayName: "New synthetic owner" });
    await expect(copyGameContent(source, target)).rejects.toThrow("fresh staging");
  });
  it("validates explicit project/session-pooler URLs without exposing invalid inputs", () => {
    const env = {
      OLD_DATABASE_URL:
        "postgresql://postgres.djlyrllwnvvljxexusbw:synthetic@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require",
      NEW_DATABASE_URL:
        "postgresql://postgres.fhslaelrgoiibblgfinu:synthetic@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require",
    };
    expect(gameContentUrls(env)).toHaveLength(2);
    expect(
      gameContentUrls({
        ...env,
        NEW_DATABASE_URL: env.NEW_DATABASE_URL.replace(":synthetic@", ":syntheticSenhaMarker@"),
      }),
    ).toHaveLength(2);
    for (const invalid of [
      {},
      { ...env, NEW_DATABASE_URL: env.OLD_DATABASE_URL },
      {
        ...env,
        NEW_DATABASE_URL: env.NEW_DATABASE_URL.replace("sslmode=require", "sslmode=disable"),
      },
      { ...env, OLD_DATABASE_URL: "synthetic-sensitive-marker" },
    ])
      expect(() => gameContentUrls(invalid)).toThrow("Invalid content-copy configuration.");
  });
});
