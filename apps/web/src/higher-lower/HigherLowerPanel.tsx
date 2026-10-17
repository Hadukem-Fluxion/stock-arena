import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HlView } from "@stock-arena/game-core";
import type { PlatformAdapter } from "../platform/types.js";
import { en } from "../copy/en.js";
import { AssetLogo } from "../components/AssetLogo.js";
import { createHlClient, HlClientError } from "./client.js";
import type { HlAction } from "./client.js";
import { closedMarketNotice } from "./closed-market.js";

export function HigherLowerPanel({
  platform,
  enabled,
  onAward,
}: {
  platform: PlatformAdapter;
  enabled: boolean;
  onAward: () => void;
}) {
  const allowed = enabled && platform.host !== "browser";
  const client = useMemo(() => createHlClient(() => platform.session), [platform]);
  const [view, setView] = useState<HlView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"session" | "network" | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const notify = useRef(onAward);
  notify.current = onAward;
  const lastScore = useRef("");
  const run = useCallback(
    async (action: HlAction, current?: HlView, ticker?: string) => {
      if (!allowed || pending.current) return;
      pending.current = true;
      setBusy(true);
      setError(null);
      const id = generation.current;
      try {
        const result = await client.call(
          action,
          current?.round && current.run && ticker
            ? { runId: current.run.id, roundId: current.round.id, ticker }
            : undefined,
        );
        if (id !== generation.current) return;
        setView(result);
        const scoreKey = result.run ? `${result.run.id}:${result.run.score}` : "";
        if (result.run?.score && scoreKey !== lastScore.current) notify.current();
        lastScore.current = scoreKey;
      } catch (cause) {
        if (id === generation.current)
          setError(cause instanceof HlClientError ? cause.code : "network");
      } finally {
        if (id === generation.current) {
          pending.current = false;
          setBusy(false);
        }
      }
    },
    [allowed, client],
  );
  useEffect(() => {
    const id = ++generation.current;
    pending.current = false;
    setView(null);
    setError(null);
    setBusy(false);
    void run("read");
    return () => {
      generation.current = id + 1;
    };
  }, [run]);
  useEffect(() => {
    if (!allowed) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void run("read");
    };
    const timer = setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [allowed, run]);
  if (!allowed) return <p className="muted">{en.hl.preview}</p>;
  const feedback = view?.feedback;
  const closedNotice = closedMarketNotice(view);
  const stocks = feedback?.stocks ?? view?.round?.stocks;
  const canStart =
    view && view.runsUsed < view.runsLimit && ["ready", "completed"].includes(view.status);
  return (
    <div className="hl-panel" aria-busy={busy}>
      <p className="caption muted">{en.hl.rule}</p>
      {error && (
        <div role="alert">
          <p>{error === "session" ? en.quiz.sessionError : en.hl.error}</p>
        </div>
      )}
      {view && (
        <div className="section-heading">
          <span>
            {en.hl.runs}:{" "}
            <span className="number">
              {view.runsUsed}/{view.runsLimit}
            </span>
          </span>
          <span className="number accent">
            {view.run?.score ?? 0} {en.labels.points}
          </span>
        </div>
      )}
      {view?.run && (
        <p className="muted">
          {en.hl.correctPicks}{" "}
          <span className="number">
            {view.run.correctCount}/{view.maxCorrect}
          </span>
        </p>
      )}
      {stocks && (
        <div className="hl-pair">
          {stocks.map((stock) => {
            const revealed = feedback?.stocks.find((entry) => entry.ticker === stock.ticker);
            return (
              <button
                key={stock.ticker}
                type="button"
                className={`hl-stock ${feedback?.winner === stock.ticker ? "hl-correct" : feedback?.choice === stock.ticker ? "hl-wrong" : ""}`}
                disabled={busy || Boolean(error) || view?.status !== "round"}
                onClick={() => {
                  void run("pick", view ?? undefined, stock.ticker);
                }}
              >
                <AssetLogo
                  ticker={stock.ticker}
                  asset={stock.asset}
                  size={72}
                  discord={platform.host === "discord"}
                />
                <strong className="display-ticker">{stock.asset.symbol}</strong>
                <span className="muted">{stock.asset.name}</span>
                <span className="number">
                  {Number(stock.priceUsd).toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                  })}
                </span>
                {revealed ? (
                  <span className={`number ${revealed.change24hPct < 0 ? "down" : "accent"}`}>
                    {revealed.change24hPct < 0 ? "▼" : "▲"}{" "}
                    {Math.abs(revealed.change24hPct).toFixed(2)}%
                  </span>
                ) : (
                  <span className="caption muted">{en.hl.hiddenChange}</span>
                )}
                {feedback?.winner === stock.ticker && (
                  <span className="accent">✓ {en.hl.biggerMove}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {view?.status === "paused" && (
        <div className="hl-pause" role="status">
          <h3>{closedNotice ? en.status.marketClosed : en.checkin.paused}</h3>
          <p>{closedNotice ?? en.hl.paused}</p>
          {!closedNotice && (
            <ul>
              {view.paused.map((stock) => (
                <li key={stock.ticker}>
                  {stock.ticker} ·{" "}
                  {stock.reason === "closed" ? en.status.marketClosed : en.checkin.paused}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {feedback && (
        <p role="status" className={feedback.correct ? "accent" : "down"}>
          {feedback.correct ? en.hl.correct : en.hl.wrong}
        </p>
      )}
      {view?.status === "feedback" && (
        <button
          type="button"
          className="primary-button"
          disabled={busy || Boolean(error)}
          onClick={() => {
            void run("next");
          }}
        >
          {en.hl.next}
        </button>
      )}
      {view?.status === "completed" && <h3>{en.hl.completed}</h3>}
      {view && view.runsUsed >= view.runsLimit && view.status === "completed" && (
        <p className="muted">{en.hl.limit}</p>
      )}
      {canStart && (
        <button
          type="button"
          className="primary-button"
          disabled={busy || Boolean(error)}
          onClick={() => {
            void run("start");
          }}
        >
          {en.hl.start}
        </button>
      )}
      {(error || view?.status === "paused") && (
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => {
            void run("read");
          }}
        >
          {en.hl.retry}
        </button>
      )}
      {busy && <p className="caption muted">{en.hl.loading}</p>}
    </div>
  );
}
