import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createLocalDatabase } from "./client.js";
import { inviteCodes, pointsLedger, referrals } from "./schema.js";

it("upgrades legacy referrals sharing an inviter without deleting history or changing points", async () => {
  const connection = createLocalDatabase();
  try {
    const client = connection.db.$client;
    const journal = JSON.parse(
      await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter((e) => e.idx < 13))
      await client.exec(
        await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"),
      );
    await client.exec(`INSERT INTO users (id,display_name) VALUES
      ('00000000-0000-4000-8000-000000000001','Synthetic inviter'),
      ('00000000-0000-4000-8000-000000000002','Synthetic legacy friend A'),
      ('00000000-0000-4000-8000-000000000003','Synthetic legacy friend B');
      INSERT INTO referrals (inviter_id,invitee_id,qualified_at) VALUES
      ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',NULL),
      ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','2026-10-24T12:00:00Z');
      INSERT INTO points_ledger (user_id,amount,reason,ref_id) VALUES
      ('00000000-0000-4000-8000-000000000001',50,'referral','synthetic:legacy-referral');`);
    await client.exec(
      await readFile(new URL("../drizzle/0013_referrals.sql", import.meta.url), "utf8"),
    );
    const codes = await connection.db.select().from(inviteCodes);
    expect(codes).toHaveLength(1);
    expect(codes[0]!.code).toMatch(/^ref_[a-f0-9]{32}$/);
    const rows = await connection.db.select().from(referrals);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.code === codes[0]!.code && r.platform === null)).toBe(true);
    expect(rows.find((r) => r.inviteeId.endsWith("3"))).toMatchObject({
      status: "rewarded",
      qualifiedAt: new Date("2026-10-24T12:00:00Z"),
    });
    expect(await connection.db.select().from(pointsLedger)).toMatchObject([
      { amount: 50, refId: "synthetic:legacy-referral" },
    ]);
    await expect(client.exec("UPDATE invite_codes SET code='reassigned'")).rejects.toThrow();
    await expect(client.exec("DELETE FROM referrals")).rejects.toThrow();
  } finally {
    await connection.close();
  }
}, 30000);
