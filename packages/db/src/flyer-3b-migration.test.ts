import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createLocalDatabase } from "./client.js";
import { flyerV3DailyCourses, flyerSessions, pointsLedger, users } from "./schema.js";
import { syntheticV3Course } from "../../game-core/src/testing/flyer-v3-fixture.js";
it("upgrades frozen v3 courses without rewriting sessions or ledger and permits v3b", async () => {
  const db = createLocalDatabase();
  try {
    const journal = JSON.parse(
      await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter((e) => e.idx < 17))
      await db.db.$client.exec(
        await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"),
      );
    const course = syntheticV3Course(),
      day = course.day!,
      now = new Date(`${day}T12:00:00Z`),
      [user] = await db.db
        .insert(users)
        .values({ displayName: "Synthetic migration player" })
        .returning();
    await db.db.insert(flyerV3DailyCourses).values({ day, course, createdAt: now });
    await db.db.insert(flyerSessions).values({
      userId: user!.id,
      startedAt: now,
      expiresAt: new Date(now.getTime() + 600000),
      maxTicks: 36000,
      course: { version: "flyer-3", dailyDay: day, seed: course.seed },
    });
    await db.db
      .insert(pointsLedger)
      .values({ userId: user!.id, amount: 7, reason: "flyer_best", refId: "synthetic:upgrade" });
    const before = await db.db.select().from(flyerSessions),
      ledger = await db.db.select().from(pointsLedger);
    await db.db.$client.exec(
      await readFile(new URL("../drizzle/0017_flyer-3b.sql", import.meta.url), "utf8"),
    );
    expect(await db.db.select().from(flyerSessions)).toEqual(before);
    expect(await db.db.select().from(pointsLedger)).toEqual(ledger);
    expect((await db.db.select().from(flyerV3DailyCourses))[0]?.course).toEqual(course);
    await db.db.insert(flyerV3DailyCourses).values({
      day: "2026-10-27",
      course: { ...course, day: "2026-10-27", version: "flyer-3b" },
      createdAt: now,
    });
    await expect(db.db.update(flyerV3DailyCourses).set({ course })).rejects.toThrow();
    await expect(db.db.delete(flyerV3DailyCourses)).rejects.toThrow();
    await expect(db.db.execute(sql`TRUNCATE flyer_v3_daily_courses CASCADE`)).rejects.toThrow();
  } finally {
    await db.close();
  }
});
