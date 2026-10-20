import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PredictionView } from "@stock-arena/game-core";
import type { PlatformAdapter } from "../platform/types.js";
import { en } from "../copy/en.js";
import { AssetLogo } from "../components/AssetLogo.js";
import { createHlClient, HlClientError } from "./client.js";
import type { HlAction } from "./client.js";

const money = (value: string) =>
  Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 8,
  });
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
  const [view, setView] = useState<PredictionView | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<"session" | "network" | null>(null);
  const [clock, setClock] = useState(0);
  const pending = useRef(false),
    generation = useRef(0),
    lastScores = useRef(new Map<string, number>()),
    receivedAt = useRef(0);
  const notify = useRef(onAward);
  notify.current = onAward;
  const run = useCallback(
    async (
      action: HlAction,
      payload?: { runId: string; roundId?: string; direction?: "up" | "down" },
    ) => {
      if (!allowed || pending.current) return;
      const id = generation.current;
      pending.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await client.call(action, payload);
        if (id !== generation.current) return;
        if (result.runs.some((entry) => entry.score > (lastScores.current.get(entry.id) ?? 0)))
          notify.current();
        lastScores.current = new Map(result.runs.map((entry) => [entry.id, entry.score]));
        receivedAt.current = Date.now();
        setClock(0);
        setView(result);
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
    lastScores.current = new Map();
    setView(null);
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
    const ticks = setInterval(() => setClock(Date.now() - receivedAt.current), 1_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      clearInterval(ticks);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [allowed, run]);
  if (!allowed) return <p className="muted">{en.hl.preview}</p>;
  return (
    <div className="hl-panel" aria-busy={busy}>
      <p className="body-copy">{en.hl.predictionIntro}</p>
      <p className="caption muted">{en.hl.predictionRules}</p>
      {error && <p role="alert">{error === "session" ? en.quiz.sessionError : en.hl.error}</p>}
      {view && (
        <>
          <div className="section-heading">
            <span>
              {en.hl.runs}:{" "}
              <span className="number">
                {view.runsUsed}/{view.runsLimit}
              </span>
            </span>
            <span className="caption muted">{en.hl.parallel}</span>
          </div>
          <div className="prediction-slots">
            {[...view.runs]
              .sort((a, b) => Number(!!a.endedAt) - Number(!!b.endedAt))
              .slice(0, view.runsLimit)
              .map((entry) => {
                const round = entry.round;
                const waiting =
                  round && ["waiting_open", "waiting_start", "pending"].includes(round.state);
                const seconds = round?.targetAt
                  ? Math.max(
                      0,
                      Math.ceil(
                        (Date.parse(round.targetAt) - Date.parse(view.serverTime) - clock) / 1000,
                      ),
                    )
                  : 0;
                return (
                  <section
                    className="prediction-slot"
                    key={entry.id}
                    aria-label={en.hl.slot(entry.number, entry.day)}
                  >
                    <div className="section-heading">
                      <strong>{en.hl.runNumber(entry.number)}</strong>
                      <span className="number accent">
                        {entry.score} {en.labels.points}
                      </span>
                    </div>
                    <p className="caption muted">
                      {en.hl.correctPicks}: {entry.correctCount}/{view.maxCorrect} · {entry.day}{" "}
                      {en.labels.utc}
                    </p>
                    {round && (
                      <>
                        <div className="prediction-stock">
                          <AssetLogo
                            ticker={round.ticker}
                            asset={round.asset}
                            size={56}
                            discord={platform.host === "discord"}
                          />
                          <div>
                            <strong>{round.asset.symbol}</strong>
                            <p className="caption muted">{round.asset.name}</p>
                          </div>
                        </div>
                        <h3>{en.hl.question(round.asset.symbol)}</h3>
                        {round.state === "offered" && !entry.endedAt && (
                          <div className="prediction-choices">
                            {(["up", "down"] as const).map((direction) => (
                              <button
                                key={direction}
                                type="button"
                                className="primary-button"
                                disabled={busy || !!error}
                                onClick={() =>
                                  void run("pick", {
                                    runId: entry.id,
                                    roundId: round.id,
                                    direction,
                                  })
                                }
                              >
                                {en.hl[direction]}
                              </button>
                            ))}
                          </div>
                        )}
                        {waiting && (
                          <div className="hl-pause" role="status">
                            <strong>
                              {round.state === "waiting_open"
                                ? en.hl.waitingOpen
                                : round.state === "waiting_start"
                                  ? en.hl.waitingStart
                                  : en.hl.pending}
                            </strong>
                            <p>
                              {en.hl.choice}:{" "}
                              {round.direction ? en.hl[round.direction] : en.labels.unknown}
                            </p>
                            {round.state === "waiting_open" && round.scheduledOpenAt && (
                              <p className="caption">
                                {en.hl.scheduledOpen}:{" "}
                                {new Date(round.scheduledOpenAt)
                                  .toISOString()
                                  .slice(0, 16)
                                  .replace("T", " ")}{" "}
                                {en.labels.utc}
                              </p>
                            )}
                            {round.targetAt && (
                              <p className="number" aria-label={en.hl.countdown}>
                                {seconds
                                  ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                                  : en.hl.settling}
                              </p>
                            )}
                            <p className="caption muted">{en.hl.canLeave}</p>
                          </div>
                        )}
                        {round.settledAt && (
                          <div className="prediction-result" role="status">
                            <strong
                              className={
                                round.state === "won"
                                  ? "accent"
                                  : round.state === "lost"
                                    ? "down"
                                    : "muted"
                              }
                            >
                              {en.hl.results[round.state as "won" | "lost" | "equal" | "void"]}
                            </strong>
                            {round.startPrice && (
                              <p>
                                {en.hl.startPrice}:{" "}
                                <span className="number">{money(round.startPrice)}</span>
                              </p>
                            )}
                            {round.endPrice && (
                              <p>
                                {en.hl.endPrice}:{" "}
                                <span className="number">{money(round.endPrice)}</span>
                              </p>
                            )}
                            {round.changePct !== null && (
                              <p>
                                {en.hl.move}:{" "}
                                <span className="number">
                                  {Number(round.changePct).toLocaleString("en-US", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                    signDisplay: "exceptZero",
                                    useGrouping: false,
                                  })}
                                  %
                                </span>
                              </p>
                            )}
                          </div>
                        )}
                        {round.settledAt && !entry.endedAt && (
                          <button
                            className="primary-button"
                            type="button"
                            disabled={busy || !!error}
                            onClick={() => void run("next", { runId: entry.id })}
                          >
                            {en.hl.nextPrediction}
                          </button>
                        )}
                      </>
                    )}
                    {entry.endedAt && <p className="caption muted">{en.hl.completed}</p>}
                  </section>
                );
              })}
            {Array.from({ length: Math.max(0, view.runsLimit - view.runs.length) }, (_, i) => (
              <div className="prediction-slot empty-slot" key={`empty-${i}`}>
                <strong>{en.hl.emptySlot}</strong>
              </div>
            ))}
          </div>
          {view.canStart && (
            <button
              className="primary-button"
              type="button"
              disabled={busy || !!error}
              onClick={() => void run("start")}
            >
              {en.hl.start}
            </button>
          )}
          {!view.canStart && view.runs.length === 0 && (
            <p className="muted" role="status">
              {en.hl.unavailable}
            </p>
          )}
          {view.runsUsed >= view.runsLimit && <p className="caption muted">{en.hl.limit}</p>}
        </>
      )}
      {error && (
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() => void run("read")}
        >
          {en.hl.retry}
        </button>
      )}
      {busy && <p className="caption muted">{en.hl.loading}</p>}
    </div>
  );
}
