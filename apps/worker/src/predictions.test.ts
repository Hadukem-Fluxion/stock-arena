import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  createLocalDatabase,
  hlPredictions,
  hlRuns,
  pointsLedger,
  priceSnapshots,
  users,
} from "@stock-arena/db";
import { ASSETS } from "@stock-arena/game-core";
import { settlePredictions } from "./predictions.js";

it("reopens a durable database mid-window and settles once without the original start snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arena-prediction-"));
  if (!resolve(directory).startsWith(join(resolve(tmpdir()), "arena-prediction-")))
    throw new Error("Unexpected test directory.");
  const dataDir = join(directory, "pglite");
  const lock = new Date("2026-10-20T12:00:00Z");
  const start = new Date("2026-10-20T12:00:15Z");
  const end = new Date("2026-10-20T12:15:15Z");
  let connection = createLocalDatabase(dataDir);
  try {
    await connection.migrate();
    const [user] = await connection.db
      .insert(users)
      .values({ displayName: "Synthetic restart player" })
      .returning();
    const [run] = await connection.db
      .insert(hlRuns)
      .values({
        userId: user!.id,
        day: "2026-10-20",
        runNumber: 1,
        model: "prediction",
        createdAt: lock,
      })
      .returning();
    await connection.db.insert(hlPredictions).values({
      runId: run!.id,
      position: 0,
      ticker: "AAPL",
      referenceTicker: "AAPL",
      asset: ASSETS.AAPL,
      offeredAt: lock,
      lockedAt: lock,
      direction: "up",
      state: "waiting_start",
    });
    await connection.db.insert(priceSnapshots).values({
      ticker: "AAPL",
      source: "xstocks",
      priceUsd: "100.000000000000000001",
      takenAt: start,
      tradable: true,
    });
    await settlePredictions(connection, start);
    await connection.db.delete(priceSnapshots);
    await connection.close();
    connection = createLocalDatabase(dataDir);
    await connection.db.insert(priceSnapshots).values({
      ticker: "AAPL",
      source: "xstocks",
      priceUsd: "100.000000000000000002",
      takenAt: end,
      tradable: true,
    });
    await settlePredictions(connection, end);
    await settlePredictions(connection, end);
    const [round] = await connection.db.select().from(hlPredictions);
    expect(round).toMatchObject({
      state: "won",
      startPrice: "100.000000000000000001",
      startTakenAt: start,
      endPrice: "100.000000000000000002",
      endTakenAt: end,
    });
    const awards = await connection.db.select().from(pointsLedger);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({ amount: 5, refId: `hl:${round!.id}` });
  } finally {
    await connection.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
