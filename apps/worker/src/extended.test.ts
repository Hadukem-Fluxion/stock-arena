import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import {
  createLocalDatabase,
  extendedQuotes,
  extendedPriceReferences,
  priceSnapshots,
} from "@stock-arena/db";
import type { ExtendedObservation } from "@stock-arena/fluxion-oracle";
import { createExtendedStore } from "./extended.js";
const connection = createLocalDatabase(),
  store = createExtendedStore(connection);
const friday = new Date("2026-10-23T21:00:00Z");
function observation(
  takenAt: Date,
  priceUsd: string | null = "100",
  closed = false,
): ExtendedObservation {
  return { ticker: "SYN", symbol: "SYNx", takenAt, priceUsd, closed, halted: false };
}
beforeAll(() => connection.migrate(), 30000);
afterAll(() => connection.close());
beforeEach(async () => {
  await connection.db.delete(extendedQuotes);
  await connection.db.delete(extendedPriceReferences);
  await connection.db.delete(priceSnapshots);
});
it("warms up without inventing a change and uses the latest primary reference at/before 24h", async () => {
  await connection.db.insert(priceSnapshots).values([
    {
      ticker: "SYN",
      source: "xstocks",
      priceUsd: "80",
      takenAt: new Date(friday.getTime() - 86400000),
    },
    {
      ticker: "SYN",
      source: "fluxion_pool",
      priceUsd: "10",
      takenAt: new Date(friday.getTime() - 86400000 + 1000),
    },
  ]);
  await store([observation(friday)]);
  expect((await connection.db.select().from(extendedQuotes))[0]).toMatchObject({
    referencePrice: "80",
    change24hPct: "25",
  });
  expect(await connection.db.select().from(priceSnapshots)).toHaveLength(2);
  await connection.db.delete(priceSnapshots);
  await connection.db.delete(extendedQuotes);
  await connection.db.delete(extendedPriceReferences);
  await store([observation(friday)]);
  expect((await connection.db.select().from(extendedQuotes))[0]).toMatchObject({
    referencePrice: null,
    referenceAt: null,
    change24hPct: null,
  });
  await store([observation(new Date(friday.getTime() + 86400000), "110")]);
  expect((await connection.db.select().from(extendedQuotes))[0]).toMatchObject({
    referencePrice: "100",
    change24hPct: "10",
    referenceAt: friday,
  });
});
it("keeps the last-session summary over a long closure and resumes after temporary references expire", async () => {
  const thursday = new Date(friday.getTime() - 86400000);
  await store([observation(thursday, "80")]);
  await store([observation(friday)]);
  const monday = new Date("2026-10-26T00:00:00Z");
  await store([observation(new Date(monday.getTime() - 1000), null, true)]);
  expect(await connection.db.select().from(extendedPriceReferences)).toHaveLength(0);
  expect((await connection.db.select().from(extendedQuotes))[0]).toMatchObject({
    priceUsd: "100",
    change24hPct: "25",
    takenAt: friday,
    lastSession: true,
  });
  await store([observation(monday, "101")]);
  expect((await connection.db.select().from(extendedQuotes))[0]).toMatchObject({
    priceUsd: "101",
    referencePrice: "100",
    referenceAt: friday,
    change24hPct: "1",
    lastSession: false,
  });
  await store([{ ...observation(new Date(monday.getTime() + 300000), null), halted: true }]);
  expect((await connection.db.select().from(extendedQuotes))[0]?.halted).toBe(true);
});
it("bounds reference retention at the polling frequency, deduplicates and rejects stale summary writes", async () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({
    ticker: "SYN",
    priceUsd: "100",
    takenAt: new Date(friday.getTime() - (399 - i) * 300000),
  }));
  await connection.db.insert(extendedPriceReferences).values(rows);
  await store([observation(friday, "102")]);
  await store([observation(friday, "102")]);
  expect(await connection.db.select().from(extendedPriceReferences)).toHaveLength(313);
  await store([observation(new Date(friday.getTime() - 300000), "20")]);
  expect((await connection.db.select().from(extendedQuotes))[0]?.priceUsd).toBe("102");
  expect(await connection.db.select().from(priceSnapshots)).toHaveLength(0);
});
