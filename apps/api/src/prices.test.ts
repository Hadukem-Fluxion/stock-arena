import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalDatabase,
  users,
  identities,
  priceSnapshots,
  tickerStatus,
} from "@stock-arena/db";
import { ASSETS } from "@stock-arena/game-core";
import type { AssetCatalog, PricesView } from "@stock-arena/game-core";
import { createPricesStore } from "./prices.js";
import { buildServer } from "./server.js";
import { createSessions } from "./auth/session.js";

const connection = createLocalDatabase();
const now = new Date("2026-10-19T12:00:00Z");
beforeAll(async () => {
  await connection.migrate();
}, 30_000);
beforeEach(async () => {
  await connection.db.delete(priceSnapshots);
  await connection.db.delete(tickerStatus);
});
afterAll(async () => {
  await connection.close();
});
function catalogFor(count: number): AssetCatalog {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `TEST_${i}`,
      { ...ASSETS.AAPL, referenceTicker: `REF_${i}` },
    ]),
  );
}
describe("persisted live prices", () => {
  it("keeps the last primary quote when the market is closed and snapshots are old", async () => {
    const catalog = catalogFor(3);
    const last = new Date(now.getTime() - 48 * 60 * 60_000);
    await connection.db
      .insert(priceSnapshots)
      .values({ ticker: "REF_0", priceUsd: "344.50", takenAt: last, source: "xstocks" });
    await connection.db.insert(tickerStatus).values({
      ticker: "REF_0",
      state: "paused",
      reason: "closed",
      nextChangeAt: new Date("2026-10-20T00:00:00Z"),
    });
    const result = await createPricesStore(connection, { catalog, now: () => now })();
    expect(result.prices[0]).toMatchObject({
      priceUsd: "344.50",
      takenAt: last.toISOString(),
      state: "paused",
      reason: "closed",
      change24hPct: null,
    });
    expect(result.prices[0]).not.toHaveProperty("nextChangeAt");
  });
  it("exposes the latest persisted pool quote only as separate closed-market information", async () => {
    const catalog = catalogFor(3);
    await connection.db.insert(priceSnapshots).values([
      { ticker: "REF_0", priceUsd: "100", takenAt: now, source: "xstocks" },
      {
        ticker: "REF_0",
        priceUsd: "200",
        takenAt: new Date(now.getTime() - 15_000),
        source: "fluxion_pool",
      },
      { ticker: "REF_0", priceUsd: "300", takenAt: now, source: "fluxion_pool" },
      {
        ticker: "REF_0",
        priceUsd: "999",
        takenAt: new Date(now.getTime() + 15_000),
        source: "fluxion_pool",
      },
    ]);
    await connection.db
      .insert(tickerStatus)
      .values({ ticker: "REF_0", state: "paused", reason: "closed", updatedAt: now });
    const store = createPricesStore(connection, { catalog, now: () => now });
    expect((await store()).prices[0]).toMatchObject({
      priceUsd: "100",
      pool: { priceUsd: "300", takenAt: now.toISOString() },
    });
    expect((await store()).prices[1]!.pool).toBeNull();
    await connection.db.update(tickerStatus).set({ state: "live", reason: null });
    expect((await store()).prices[0]!.pool).toBeNull();
  });
  it.each([3, 30])(
    "reads %s catalog assets using primary snapshots and includes pause reasons",
    async (count) => {
      const catalog = catalogFor(count);
      await connection.db.insert(priceSnapshots).values(
        Object.values(catalog).flatMap((asset) => [
          {
            ticker: asset.referenceTicker,
            priceUsd: "100",
            takenAt: new Date(now.getTime() - 86_400_000),
            source: "xstocks" as const,
          },
          {
            ticker: asset.referenceTicker,
            priceUsd: "105",
            takenAt: now,
            source: "xstocks" as const,
          },
          {
            ticker: asset.referenceTicker,
            priceUsd: "9999",
            takenAt: now,
            source: "fluxion_pool" as const,
          },
        ]),
      );
      await connection.db.insert(tickerStatus).values(
        Object.values(catalog).map((asset, i) => ({
          ticker: asset.referenceTicker,
          state: i === 0 ? ("paused" as const) : ("live" as const),
          reason: i === 0 ? "closed" : null,
          updatedAt: now,
        })),
      );
      const result = await createPricesStore(connection, { catalog, now: () => now })();
      expect(result.prices).toHaveLength(count);
      expect(result.prices.every((price) => price.priceUsd === "105")).toBe(true);
      expect(result.prices[0]).toMatchObject({
        state: "paused",
        reason: "closed",
        change24hPct: expect.closeTo(5),
      });
      const stale = await createPricesStore(connection, {
        catalog,
        now: () => new Date(now.getTime() + 121_000),
      })();
      expect(stale.prices.every((price) => price.state === "paused")).toBe(true);
    },
  );
  it("streams authenticated SSE, rejects query tokens and closes cleanly on disconnect", async () => {
    const secret = "fake-sse-session-secret-for-tests-only-48-bytes";
    const [user] = await connection.db
      .insert(users)
      .values({ displayName: "Synthetic SSE player" })
      .returning();
    if (!user) throw new Error("Missing player");
    const identity = { platform: "discord" as const, platformUserId: randomUUID() };
    await connection.db.insert(identities).values({ userId: user.id, ...identity });
    const session = await createSessions(secret, () => now).issue({ ...user, identity });
    const app = buildServer({
      logger: false,
      auth: { database: connection, env: { SESSION_SECRET: secret }, now: () => now },
      prices: { catalog: catalogFor(3) },
    });
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      expect(
        (await app.inject({ method: "GET", url: "/api/prices/stream?token=invalid" })).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/prices/stream?token=invalid",
            headers: { authorization: `Bearer ${session.token}` },
          })
        ).statusCode,
      ).toBe(400);
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const response = await fetch(`${address}/api/prices/stream`, {
        headers: { Authorization: `Bearer ${session.token}` },
        signal: controller.signal,
      });
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(response.headers.get("x-accel-buffering")).toBe("no");
      reader = response.body!.getReader();
      const { value } = await reader.read();
      const frame = new TextDecoder().decode(value);
      expect(frame.startsWith("event: prices\ndata: ")).toBe(true);
      const view = JSON.parse(frame.split("data: ")[1]!.trim()) as PricesView;
      expect(view.prices).toHaveLength(3);
      expect(view.prices.every((price) => price.state === "paused")).toBe(true);
      controller.abort();
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => {});
      await app.close();
    }
  }, 15_000);
});
