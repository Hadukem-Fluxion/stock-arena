import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONFIG, initialFlyer, stepFlyer, flyerPipe } from "@stock-arena/game-core";
import type { FlyerInput } from "@stock-arena/game-core";
import type { PlatformAdapter } from "../platform/types.js";
import { en } from "../copy/en.js";
import { AssetLogo } from "../components/AssetLogo.js";
import { bindFlyerInput } from "./input.js";
import { flyerRenderer } from "./canvas.js";
import { createFlyerClient, FlyerClientError } from "./client.js";
import type { FlyerView, FlyerSession, FlyerResult, FlyerLeaderboard } from "./client.js";
const c = GAME_CONFIG.flyer;
export function FlyerPanel({
  platform,
  enabled,
  onAward,
  onBest,
}: {
  platform: PlatformAdapter;
  enabled: boolean;
  onAward: () => void;
  onBest: (best: number) => void;
}) {
  const copy = en.flyer,
    client = useMemo(() => createFlyerClient(platform), [platform]);
  const [view, setView] = useState<FlyerView | null>(null),
    [session, setSession] = useState<FlyerSession | null>(null),
    [result, setResult] = useState<FlyerResult | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [live, setLive] = useState({ score: 0, segment: 0 }),
    [period, setPeriod] = useState<"day" | "week" | "season">("day");
  const [ranking, setRanking] = useState<FlyerLeaderboard | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    origin = useRef(0),
    generation = useRef(0);
  const allowed = enabled && !!platform.session;
  const fail = useCallback(
    (error: unknown) => {
      const code = error instanceof FlyerClientError ? error.code : "generic";
      setError(
        code === "GAME_PAUSED"
          ? en.maintenance
          : Object.hasOwn(copy.errors, code)
            ? copy.errors[code as keyof typeof copy.errors]
            : copy.errors.generic,
      );
    },
    [copy],
  );
  const reload = useCallback(async () => {
    const next = await client.read();
    setView(next);
    onBest(next.best);
  }, [client, onBest]);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void client
      .read()
      .then((next) => {
        if (active) {
          setView(next);
          onBest(next.best);
        }
      })
      .catch((e) => {
        if (active) fail(e);
      });
    return () => {
      active = false;
    };
  }, [allowed, client, fail, onBest]);
  useEffect(() => {
    if (!allowed || session) return;
    let active = true;
    void client
      .leaderboard(period)
      .then((next) => {
        if (active) setRanking(next);
      })
      .catch((e) => {
        if (active) fail(e);
      });
    return () => {
      active = false;
    };
  }, [allowed, client, period, session, result, fail]);
  useEffect(() => {
    if (!session || !canvas.current) return;
    const element = canvas.current,
      draw = flyerRenderer(element, session.course),
      id = ++generation.current;
    let state = initialFlyer(),
      desired = false,
      frame = 0,
      submitted = false;
    const inputs: FlyerInput[] = [];
    let frameCost = 0,
      frames = 0,
      lastUi = -1;
    element.focus({ preventScroll: true });
    const unbind = bindFlyerInput(element, (held) => {
      desired = held;
      element.dataset.held = String(held);
    });
    const render = (time: number) => {
      const begin = performance.now(),
        target = Math.min(
          session.maxTicks,
          Math.floor(((time - origin.current) * c.ticksPerSecond) / 1000),
        );
      while (state.tick < target && !state.ended) {
        const input =
          desired !== state.held
            ? { tick: state.tick, action: desired ? ("press" as const) : ("release" as const) }
            : undefined;
        if (input) inputs.push(input);
        state = stepFlyer(session.course, state, input);
      }
      draw(state);
      frames++;
      frameCost += performance.now() - begin;
      element.dataset.frameCostMs = String(frameCost / frames);
      element.dataset.tick = String(state.tick);
      element.dataset.y = String(state.y);
      element.dataset.velocity = String(state.velocity);
      element.dataset.score = String(state.score);
      element.dataset.targetCenter = String(
        flyerPipe(session.course, state.score, state.distance).center,
      );
      const segment = Math.floor(state.score / c.pipesPerSegment) % session.course.segments.length;
      if (state.score !== lastUi) {
        lastUi = state.score;
        setLive({ score: state.score, segment });
      }
      if (state.ended || state.tick >= session.maxTicks) {
        if (submitted) return;
        submitted = true;
        setBusy(true);
        void client
          .finish(session.id, state.tick, state.score, inputs)
          .then((next) => {
            if (generation.current !== id) return;
            setResult(next);
            onBest(next.best);
            onAward();
          })
          .catch((e) => {
            if (generation.current === id) fail(e);
          })
          .finally(() => {
            if (generation.current === id) {
              setSession(null);
              setBusy(false);
              void reload().catch(fail);
            }
          });
        return;
      }
      frame = requestAnimationFrame(render);
    };
    draw(state);
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      unbind();
      generation.current = id + 1;
    };
  }, [session, client, fail, reload, onAward, onBest]);
  async function start() {
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const before = performance.now(),
        next = await client.start();
      origin.current = before + (performance.now() - before) / 2;
      setLive({ score: 0, segment: 0 });
      setSession(next);
    } catch (e) {
      fail(e);
      await reload().catch(fail);
    } finally {
      setBusy(false);
    }
  }
  async function discard() {
    if (!view?.active) return;
    setBusy(true);
    setError("");
    try {
      await client.cancel(view.active.id);
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  if (!allowed) return <p className="muted">{copy.preview}</p>;
  const segment = session?.course.segments[live.segment];
  const visited =
    result?.course.segments.slice(
      0,
      Math.min(result.course.segments.length, Math.floor(result.score / c.pipesPerSegment) + 1),
    ) ?? [];
  return (
    <div className="flyer-panel">
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => void reload().catch(fail)}>{en.referrals.retry}</button>
        </p>
      )}
      {!view && <p role="status">{copy.loading}</p>}
      {view?.maintenance && <p role="status">{en.maintenance}</p>}
      {view && !view.available && <p role="status">{copy.configuration}</p>}
      {view && view.pointsToday >= view.dailyCap && <p className="flyer-cap">{copy.cap}</p>}
      {segment && (
        <div className="flyer-status">
          <AssetLogo
            ticker={segment.ticker}
            asset={segment.asset}
            discord={platform.host === "discord"}
            size={32}
          />
          <strong>
            {segment.asset.symbol} · {copy.chart}
          </strong>
          <span className="pill number" aria-label={copy.score}>
            {live.score}
          </span>
        </div>
      )}
      {session && (
        <>
          <div className="flyer-stage">
            <canvas ref={canvas} tabIndex={0} aria-label={copy.canvas} />
          </div>
          <p className="caption muted">{copy.chartNotice}</p>
        </>
      )}
      {busy && !session && <p role="status">{copy.verifying}</p>}
      {result && (
        <div className="flyer-result" role="status">
          <h2>{result.newBest ? copy.newBest : copy.gameOver}</h2>
          <dl className="invite-counts">
            <div>
              <dt>{copy.score}</dt>
              <dd>{result.score}</dd>
            </div>
            <div>
              <dt>{copy.dailyBest}</dt>
              <dd>{result.best}</dd>
            </div>
          </dl>
          <p className="number">{copy.points(result.pointsAwarded)}</p>
          <h3>{copy.chartTitle}</h3>
          {visited.map((s) => (
            <div className="flyer-chart" key={s.ticker}>
              <strong>
                {s.asset.symbol}{" "}
                <span className="number">
                  {Number(s.changePct) > 0 ? "+" : ""}
                  {Number(s.changePct).toFixed(2)}%
                </span>
              </strong>
              <svg viewBox="0 0 180 52" role="img" aria-label={`${s.asset.symbol} ${copy.chart}`}>
                <polyline
                  points={s.centers
                    .map(
                      (v, i) =>
                        `${i * 20},${((v - c.chartMargin) / (c.height - 2 * c.chartMargin)) * 48 + 2}`,
                    )
                    .join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
              <p>{s.fact ?? copy.factPending}</p>
            </div>
          ))}
        </div>
      )}
      {!session && view?.active && (
        <div>
          <p>{copy.unfinished}</p>
          <button disabled={busy} onClick={() => void discard()}>
            {copy.discard}
          </button>
        </div>
      )}
      {!session && (
        <button
          className="primary-button"
          disabled={busy || !view?.canStart}
          onClick={() => void start()}
        >
          {result ? copy.playAgain : copy.start}
        </button>
      )}
      {!session && (
        <>
          <details>
            <summary>{en.navigation.how}</summary>
            <p>{copy.rules}</p>
          </details>
          <section className="flyer-rankings">
            <h2>{copy.rankings}</h2>
            <div className="leaderboard-filters">
              {(["day", "week", "season"] as const).map((p) => (
                <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
                  {en.leaderboard.periods[p]}
                </button>
              ))}
            </div>
            {ranking?.entries.length ? (
              <ol>
                {ranking.entries.map((r) => (
                  <li key={r.userId}>
                    <span>
                      {r.rank}. {r.displayName}
                    </span>
                    <strong className="number">{r.score}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p>{copy.noScores}</p>
            )}
            {ranking?.caller &&
              !ranking.entries.some((r) => r.userId === ranking.caller!.userId) && (
                <p>
                  {ranking.caller.rank}. {ranking.caller.displayName} · {ranking.caller.score}
                </p>
              )}
          </section>
        </>
      )}
    </div>
  );
}
