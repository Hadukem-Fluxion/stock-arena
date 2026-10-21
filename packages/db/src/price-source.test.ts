import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createLocalDatabase } from "./client.js";
import { priceSnapshots } from "./schema.js";

describe("T04 price source migration", () => {
  it("upgrades pre-T04 data, preserves it as pool data and accepts null API blocks", async () => {
    const connection = createLocalDatabase();
    try {
      const client = connection.db.$client;
      for (const file of ["0000_season-one.sql", "0001_immutable-ledger.sql"]) {
        await client.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
      }
      await client.query(
        "INSERT INTO price_snapshots (ticker, price_usd, block_number, taken_at) VALUES ('AAPL', 100, 123, now())",
      );
      await client.exec(
        await readFile(new URL("../drizzle/0002_price-source.sql", import.meta.url), "utf8"),
      );
      const [legacy] = await connection.db
        .select({
          source: priceSnapshots.source,
          blockNumber: priceSnapshots.blockNumber,
          priceUsd: priceSnapshots.priceUsd,
        })
        .from(priceSnapshots);
      expect(legacy).toMatchObject({ source: "fluxion_pool", blockNumber: 123n, priceUsd: "100" });
      // Exercise the T04 schema without assuming columns added by later migrations.
      const primary = await client.query(
        "INSERT INTO price_snapshots (ticker, price_usd, block_number, source, taken_at) VALUES ('AAPL', 101, NULL, 'xstocks', now()) RETURNING source, block_number",
      );
      expect(primary.rows[0]).toMatchObject({ source: "xstocks", block_number: null });
      await expect(client.query("UPDATE points_ledger SET amount = 0")).rejects.toMatchObject({
        code: "55000",
      });
      await expect(
        client.query(
          "INSERT INTO price_snapshots (ticker, price_usd, source, taken_at) VALUES ('AAPL', 100, 'unknown', now())",
        ),
      ).rejects.toMatchObject({ code: "22P02" });
    } finally {
      await connection.close();
    }
  }, 30_000);
});
