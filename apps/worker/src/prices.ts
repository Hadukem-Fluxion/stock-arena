import { TICKERS } from "@stock-arena/game-core";
import type { Ticker } from "@stock-arena/game-core";
import { priceSnapshots, tickerStatus } from "@stock-arena/db";
import type { DatabaseConnection } from "@stock-arena/db";
import { evaluateTicker } from "@stock-arena/fluxion-oracle";
import type { OraclePoll, TickerState } from "@stock-arena/fluxion-oracle";
import { and, desc, eq } from "drizzle-orm";
import { captureLastSession } from "./last-session.js";

export function createPriceStore(
  connection: DatabaseConnection,
  options: { divergencePct: number; jumpLimitPct: number },
  warn: (message: string) => void = console.warn,
) {
  return async (poll: OraclePoll) =>
    connection.db.transaction(async (tx) => {
      if (poll.snapshots.length) await tx.insert(priceSnapshots).values(poll.snapshots);
      const statuses: { ticker: Ticker; status: TickerState }[] = [];
      for (const ticker of TICKERS) {
        const history = await tx
          .select()
          .from(priceSnapshots)
          .where(and(eq(priceSnapshots.ticker, ticker), eq(priceSnapshots.source, "xstocks")))
          .orderBy(desc(priceSnapshots.takenAt))
          .limit(2);
        const [previous] = await tx
          .select()
          .from(tickerStatus)
          .where(eq(tickerStatus.ticker, ticker));
        const previousState: TickerState | undefined =
          previous?.state === "paused" && ["manual", "divergence"].includes(previous.reason ?? "")
            ? { state: "paused", reason: previous.reason as "manual" | "divergence" }
            : undefined;
        const pool = poll.snapshots.find(
          (snapshot) => snapshot.ticker === ticker && snapshot.source === "fluxion_pool",
        );
        const result = evaluateTicker({
          snapshots: history.reverse().map((snapshot) => ({
            priceUsd: Number(snapshot.priceUsd),
            takenAt: snapshot.takenAt,
          })),
          now: poll.takenAt,
          trading: poll.trading[ticker],
          poolPrice: pool?.priceUsd,
          previousState,
          ...options,
        });
        const trading = poll.trading[ticker];
        // Confirm a scheduled open -> closed boundary, never infer a calendar
        // from weekend quotes (which may continue arriving unchanged).
        const closing =
          trading?.currentPeriod === "closed" &&
          !trading.isTradingHalted &&
          previous?.tradingPeriod &&
          previous.tradingPeriod !== "closed" &&
          previous.tradingHalted === false &&
          previous.periodChangeAt &&
          previous.periodChangeAt <= poll.takenAt
            ? previous.periodChangeAt
            : null;
        const clearSession =
          (trading && trading.currentPeriod !== "closed") ||
          (previous?.tradingPeriod === "closed" &&
            previous.periodChangeAt &&
            previous.periodChangeAt <= poll.takenAt);
        const lastClosedAt = closing ?? (clearSession ? null : (previous?.lastClosedAt ?? null));
        const lastSession = closing
          ? await captureLastSession(tx, ticker, closing)
          : clearSession
            ? null
            : (previous?.lastSession ?? null);
        const row = {
          ticker,
          // Preserve the last known boundary through metadata failures. The
          // stale state still blocks gameplay until valid metadata returns.
          tradingPeriod: trading?.currentPeriod ?? previous?.tradingPeriod ?? null,
          tradingHalted: trading?.isTradingHalted ?? previous?.tradingHalted ?? null,
          periodChangeAt: trading
            ? trading.nextChangeAt
              ? new Date(trading.nextChangeAt)
              : null
            : (previous?.periodChangeAt ?? null),
          lastClosedAt,
          lastSession,
          state: result.status.state,
          reason: result.status.state === "paused" ? result.status.reason : null,
          // Only a scheduled closed-period transition can advertise a reopening.
          // A halt or missing metadata cannot promise an opening time.
          nextChangeAt:
            result.status.state === "paused" &&
            result.status.reason === "closed" &&
            poll.trading[ticker]?.currentPeriod === "closed" &&
            !poll.trading[ticker]?.isTradingHalted &&
            Date.parse(poll.trading[ticker]?.nextChangeAt ?? "") > poll.takenAt.getTime()
              ? new Date(poll.trading[ticker]!.nextChangeAt!)
              : null,
          updatedAt: poll.takenAt,
        };
        await tx
          .insert(tickerStatus)
          .values(row)
          .onConflictDoUpdate({ target: tickerStatus.ticker, set: row });
        if (result.divergencePct !== null && result.divergencePct > options.divergencePct) {
          warn(`[worker] ${ticker} divergence ${result.divergencePct.toFixed(3)}%; ticker paused.`);
        }
        statuses.push({ ticker, status: result.status });
      }
      return statuses;
    });
}

/** One in-flight cycle at a time; failures are retried on the next interval. */
export function startPricePolling(
  action: () => Promise<void>,
  intervalMs: number,
  onError: () => void,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void>;
  async function run() {
    const started = Date.now();
    try {
      await action();
    } catch {
      onError();
    }
    if (!stopped)
      timer = setTimeout(
        () => {
          active = run();
        },
        Math.max(0, intervalMs - (Date.now() - started)),
      );
  }
  active = run();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await active;
  };
}
