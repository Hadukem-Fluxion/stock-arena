import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { createLocalDatabase } from "./client.js";
import { flyerSessions, flyerDailyCourses, pointsLedger } from "./schema.js";
import { syntheticFlyerCourse } from "../../game-core/src/testing/flyer-fixture.js";
import { syntheticDaylightCourse } from "../../game-core/src/testing/daylight-fixture.js";
it("adds bounded extended data and immutable daily courses while preserving v1 sessions and ledger", async () => {
  const db = createLocalDatabase();
  try {
    const journal = JSON.parse(
      await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter((e) => e.idx < 15))
      await db.db.$client.exec(
        await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"),
      );
    const id = "00000000-0000-4000-8000-000000000001",
      legacy = syntheticFlyerCourse();
    await db.db.execute(sql`INSERT INTO users (id,display_name) VALUES (${id},'Synthetic player')`);
    await db.db.execute(
      sql`INSERT INTO points_ledger(user_id,amount,reason,ref_id) VALUES (${id},4,'flyer_best','synthetic:legacy')`,
    );
    await db.db.execute(
      sql`INSERT INTO flyer_sessions(user_id,started_at,expires_at,max_ticks,course) VALUES (${id},now(),now()+interval '10 minutes',36000,${JSON.stringify(legacy)}::jsonb)`,
    );
    await db.db.$client.exec(
      await readFile(new URL("../drizzle/0015_daylight-market.sql", import.meta.url), "utf8"),
    );
    expect((await db.db.select().from(flyerSessions))[0]).toMatchObject({
      course: legacy,
      dailyCourseDay: null,
      state: "active",
    });
    expect((await db.db.select().from(pointsLedger))[0]).toMatchObject({
      amount: 4,
      refId: "synthetic:legacy",
    });
    const course = syntheticDaylightCourse(),
      day = course.day!;
    await db.db.insert(flyerDailyCourses).values({ day, course, createdAt: new Date() });
    await expect(
      db.db.update(flyerDailyCourses).set({ course: { ...course, seed: 999 } }),
    ).rejects.toThrow();
    await expect(db.db.delete(flyerDailyCourses)).rejects.toThrow();
    await expect(db.db.$client.exec("TRUNCATE flyer_daily_courses CASCADE")).rejects.toThrow();
    const [session] = await db.db
      .insert(flyerSessions)
      .values({
        userId: id,
        state: "cancelled",
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 600000),
        maxTicks: 36000,
        course: { version: "flyer-2", dailyDay: day, seed: course.seed },
        dailyCourseDay: day,
      })
      .returning();
    await expect(
      db.db
        .update(flyerSessions)
        .set({ dailyCourseDay: null })
        .where(eq(flyerSessions.id, session!.id)),
    ).rejects.toThrow();
    await expect(db.db.$client.exec("DELETE FROM points_ledger")).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 30000);
