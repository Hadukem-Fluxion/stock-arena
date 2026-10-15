import { GAME_CONFIG, gameDay } from "@stock-arena/game-core";

/**
 * Background jobs. Today only a heartbeat; the jobs below arrive with their tasks:
 * - T04: price polling every GAME_CONFIG.prices.pollSeconds into price_snapshots
 * - T09/T12: daily reset at 00:00 UTC, leaderboard snapshots
 * - T21: Daily Call settlement
 */
const HEARTBEAT_MS = 60_000;

function heartbeat() {
  console.info(
    `[worker] alive · game day ${gameDay(new Date())} · price poll every ${GAME_CONFIG.prices.pollSeconds}s (not active yet)`,
  );
}

heartbeat();
setInterval(heartbeat, HEARTBEAT_MS);
