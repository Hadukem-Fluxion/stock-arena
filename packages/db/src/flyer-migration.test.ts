import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createLocalDatabase } from "./client.js";
import { flyerSessions, gameControls, pointsLedger } from "./schema.js";
import { syntheticFlyerCourse } from "../../game-core/src/testing/flyer-fixture.js";
import { eq } from "drizzle-orm";
it("adds Flyer without rewriting historical points and protects its frozen session", async () => {
  const db = createLocalDatabase();
  try {
    const journal = JSON.parse(
      await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter((e) => e.idx < 14))
      await db.db.$client.exec(
        await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"),
      );
    await db.db.$client
      .exec(`INSERT INTO users (id,display_name) VALUES ('00000000-0000-4000-8000-000000000001','Synthetic migration player');
      INSERT INTO points_ledger (user_id,amount,reason,ref_id) VALUES ('00000000-0000-4000-8000-000000000001',17,'checkin','synthetic:before-flyer');`);
    await db.db.$client.exec(
      await readFile(new URL("../drizzle/0014_flyer.sql", import.meta.url), "utf8"),
    );
    expect(await db.db.select().from(pointsLedger)).toMatchObject([
      { amount: 17, refId: "synthetic:before-flyer" },
    ]);
    expect(await db.db.select().from(flyerSessions)).toEqual([]);
    expect((await db.db.select().from(gameControls)).map((r) => r.game).sort()).toEqual([
      "checkin",
      "flyer",
      "higher_lower",
      "invite",
      "quiz",
    ]);
    const [session] = await db.db
      .insert(flyerSessions)
      .values({
        userId: "00000000-0000-4000-8000-000000000001",
        startedAt: new Date("2026-10-25T12:00:00Z"),
        expiresAt: new Date("2026-10-25T12:10:00Z"),
        maxTicks: 36000,
        course: syntheticFlyerCourse(3),
      })
      .returning();
    await expect(
      db.db
        .update(flyerSessions)
        .set({ course: syntheticFlyerCourse(30) })
        .where(eq(flyerSessions.id, session!.id)),
    ).rejects.toThrow();
    await expect(
      db.db.delete(flyerSessions).where(eq(flyerSessions.id, session!.id)),
    ).rejects.toThrow();
    await expect(db.db.$client.exec("TRUNCATE flyer_sessions")).rejects.toThrow();
    await expect(db.db.$client.exec("DELETE FROM points_ledger")).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 30000);
