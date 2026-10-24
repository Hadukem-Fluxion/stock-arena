import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createLocalDatabase } from "./client.js";
import { adminActions, pointsLedger, rewardControl, rewardSnapshots, seasons } from "./schema.js";
it("T31 migration preserves ledger, append-only audit and seasons without generating rewards", async () => {
  const connection = createLocalDatabase();
  try {
    const client = connection.db.$client;
    const journal = JSON.parse(
      await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter((e) => e.idx < 12))
      await client.exec(
        await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"),
      );
    await client.exec(`INSERT INTO users (id,display_name) VALUES ('00000000-0000-4000-8000-000000000001','Synthetic migration user');
      INSERT INTO points_ledger (user_id,amount,reason,ref_id) VALUES ('00000000-0000-4000-8000-000000000001',17,'synthetic','synthetic:reward-upgrade');
      INSERT INTO admin_actions (admin_id,action,reason) VALUES ('00000000-0000-4000-8000-000000000001','synthetic','Synthetic migration test');`);
    await client.exec(
      await readFile(new URL("../drizzle/0012_rewards.sql", import.meta.url), "utf8"),
    );
    expect(await connection.db.select().from(pointsLedger)).toMatchObject([
      { amount: 17, refId: "synthetic:reward-upgrade" },
    ]);
    expect(await connection.db.select().from(adminActions)).toHaveLength(1);
    expect(await connection.db.select().from(seasons)).toMatchObject([
      { id: "season-1", endsAt: null },
    ]);
    expect(await connection.db.select().from(rewardSnapshots)).toEqual([]);
    expect(await connection.db.select().from(rewardControl)).toEqual([{ id: 1 }]);
    for (const statement of ["UPDATE points_ledger SET amount=0", "DELETE FROM admin_actions"])
      await expect(client.query(statement)).rejects.toMatchObject({ code: "55000" });
  } finally {
    await connection.close();
  }
}, 30000);
