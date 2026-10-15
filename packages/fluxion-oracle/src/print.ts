import { TICKERS } from "@stock-arena/game-core";
import { createPriceOracle, evaluateTicker } from "./oracle.js";

try {
  const oracle = createPriceOracle();
  const poll = await oracle.poll();
  console.info(
    TICKERS.map((ticker) => {
      const quote = poll.snapshots.find(
        (snapshot) => snapshot.ticker === ticker && snapshot.source === "xstocks",
      );
      const pool = poll.snapshots.find(
        (snapshot) => snapshot.ticker === ticker && snapshot.source === "fluxion_pool",
      );
      const result = evaluateTicker({
        snapshots: quote ? [{ priceUsd: Number(quote.priceUsd), takenAt: quote.takenAt }] : [],
        now: poll.takenAt,
        trading: poll.trading[ticker],
        poolPrice: pool?.priceUsd,
        divergencePct: oracle.config.divergencePct,
        jumpLimitPct: oracle.config.jumpLimitPct,
      });
      return {
        ticker,
        priceUsd: quote?.priceUsd ?? "unavailable",
        period: poll.trading[ticker]?.currentPeriod ?? "unknown",
        poolPriceUsd: pool?.priceUsd ?? (oracle.config.pools[ticker] ? "unavailable" : "no pool"),
        divergencePct: result.divergencePct?.toFixed(3) ?? "n/a",
        state: result.status.state,
        reason: result.status.state === "paused" ? result.status.reason : "",
      };
    }),
  );
  if (
    poll.snapshots.filter((snapshot) => snapshot.source === "xstocks").length !== 7 ||
    Object.keys(poll.trading).length !== 7
  )
    process.exitCode = 1;
} catch {
  console.error("[oracle] Cannot print prices; check configuration and source availability.");
  process.exitCode = 1;
}
