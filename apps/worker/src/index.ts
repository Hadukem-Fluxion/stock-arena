import { GAME_CONFIG } from "@stock-arena/game-core";
import { createDatabase } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import {
  createPriceOracle,
  createExtendedOracle,
  extendedConfig,
} from "@stock-arena/fluxion-oracle";
import { createPriceStore, startPricePolling } from "./prices.js";
import { createDailyRetention, retainPriceSnapshots } from "./retention.js";
import { settlePredictions } from "./predictions.js";
import { createExtendedStore } from "./extended.js";

// Migrations run explicitly via pnpm db:migrate, never from this worker.
let connection: DatabaseConnection | undefined;
let store: ReturnType<typeof createPriceStore> | undefined;
let oracle: ReturnType<typeof createPriceOracle> | undefined;
const retainDaily = createDailyRetention(
  async () => {
    if (!connection) throw new Error("Database not initialized.");
    return retainPriceSnapshots(connection);
  },
  (deleted) =>
    console.info(`[worker] Price retention complete: ${deleted} older snapshots removed.`),
  () => console.error("[worker] Price retention failed; will retry on a future cycle."),
);
const stop = startPricePolling(
  async () => {
    if (!connection) {
      connection = createDatabase();
      if (connection.kind === "postgres") {
        connection.db.$client.on("error", () =>
          console.error("[worker] Idle database connection failed; future cycles will reconnect."),
        );
      }
    }
    oracle ??= createPriceOracle();
    store ??= createPriceStore(connection, oracle.config);
    const poll = await (async () => {
      try {
        const current = await oracle!.poll();
        await store!(current);
        return current;
      } finally {
        // Existing samples and void deadlines must still progress if polling fails.
        await settlePredictions(connection!);
        await retainDaily();
      }
    })();
    const tickers = poll.snapshots
      .filter((snapshot) => snapshot.source === "xstocks")
      .map((snapshot) => snapshot.ticker);
    console.info(
      `[worker] stored xStocks snapshots: ${tickers.join(", ") || "none"} · pool cross-checks: ${poll.snapshots.length - tickers.length}`,
    );
  },
  GAME_CONFIG.prices.pollSeconds * 1000,
  () =>
    console.error(
      "[worker] Price cycle failed; will retry. Check configuration, database migrations and source access.",
    ),
);

// Independent, non-overlapping batches must never delay the core 15-second loop.
const stopExtended = (() => {
  try {
    const config = extendedConfig(process.env),
      reader = createExtendedOracle({
        apiBase: process.env.XSTOCKS_API_BASE,
        batchSize: config.batchSize,
      });
    let save: ReturnType<typeof createExtendedStore> | undefined;
    return startPricePolling(
      async () => {
        connection ??= createDatabase();
        save ??= createExtendedStore(connection, config.referenceHours);
        const poll = await reader.poll();
        await save(poll.observations);
        console.info(
          `[worker] Extended quotes: ${poll.observations.length} observed, ${poll.failed} unavailable.`,
        );
      },
      config.pollSeconds * 1000,
      () => console.error("[worker] Extended collection unavailable; core polling continues."),
    );
  } catch {
    console.error("[worker] Invalid extended collection configuration; core polling continues.");
    return async () => {};
  }
})();

async function shutdown() {
  await Promise.all([stop(), stopExtended()]);
  await connection?.close();
}
const stopSafely = () => {
  void shutdown().catch(() => console.error("[worker] Database shutdown failed."));
};
process.once("SIGINT", stopSafely);
process.once("SIGTERM", stopSafely);
