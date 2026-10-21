import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createLocalDatabase } from "./client.js";
import { adminActions, pointsLedger } from "./schema.js";

describe("T28 admin foundation migration", () => {
  it("preserves existing audit and ledger rows and protects audit mutations including raw SQL", async () => {
    const connection = createLocalDatabase();
    try {
      const client = connection.db.$client;
      const journal = JSON.parse(
        await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
      ) as { entries: { idx: number; tag: string }[] };
      for (const entry of journal.entries.filter((entry) => entry.idx < 9)) {
        await client.exec(
          await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"),
        );
      }
      const id = "2de7ca4a-8c10-49a1-b3c7-a54d3e08c365";
      await client.query(
        "INSERT INTO users (id, display_name) VALUES ($1, 'Synthetic legacy operator')",
        [id],
      );
      await client.query(
        "INSERT INTO admin_actions (admin_id, action, target_user_id, reason) VALUES ($1, 'legacy.action', $1, 'Synthetic legacy reason')",
        [id],
      );
      await client.query(
        "INSERT INTO points_ledger (user_id, amount, reason, ref_id) VALUES ($1, 10, 'synthetic', 'synthetic:legacy')",
        [id],
      );
      await client.exec(
        await readFile(new URL("../drizzle/0009_admin-foundation.sql", import.meta.url), "utf8"),
      );
      expect(await connection.db.select().from(adminActions)).toMatchObject([
        {
          adminId: id,
          action: "legacy.action",
          targetUserId: id,
          reason: "Synthetic legacy reason",
          details: {},
          ipHash: null,
        },
      ]);
      expect(await connection.db.select().from(pointsLedger)).toMatchObject([
        { userId: id, amount: 10, refId: "synthetic:legacy" },
      ]);
      await connection.db.insert(adminActions).values({
        adminId: id,
        action: "synthetic.system",
        reason: "Synthetic system event",
        targetUserId: null,
        targetType: "system",
        details: { rows: 1 },
      });
      for (const query of [
        "UPDATE admin_actions SET reason = 'tampered'",
        "DELETE FROM admin_actions",
        "TRUNCATE admin_actions",
      ]) {
        await expect(client.query(query)).rejects.toMatchObject({ code: "55000" });
      }
      expect(await connection.db.select().from(adminActions)).toHaveLength(2);
      await expect(client.query("UPDATE points_ledger SET amount = 0")).rejects.toMatchObject({
        code: "55000",
      });
    } finally {
      await connection.close();
    }
  }, 30000);
});
