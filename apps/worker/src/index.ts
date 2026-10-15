import { GAME_CONFIG } from "@stock-arena/game-core";
import { createDatabase } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { createPriceOracle } from "@stock-arena/fluxion-oracle";
import { createPriceStore, startPricePolling } from "./prices.js";

// Migrations run explicitly via pnpm db:migrate, never from this worker.
let connection: DatabaseConnection | undefined;
let store: ReturnType<typeof createPriceStore> | undefined;
let oracle: ReturnType<typeof createPriceOracle> | undefined;
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
    const poll = await oracle.poll();
    await store(poll);
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

async function shutdown() {
  await stop();
  await connection?.close();
}
const stopSafely = () => {
  void shutdown().catch(() => console.error("[worker] Database shutdown failed."));
};
process.once("SIGINT", stopSafely);
process.once("SIGTERM", stopSafely);
