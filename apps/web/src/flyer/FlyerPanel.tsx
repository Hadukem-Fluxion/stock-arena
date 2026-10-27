import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASSETS,
  GAME_CONFIG,
  initialFlyer,
  stepFlyer,
  flyerPipe,
  flyerProgress,
  flyerAssetIndex,
  flyerV3Course,
  isFlapFlyer,
} from "@stock-arena/game-core";
import type { FlyerInput } from "@stock-arena/game-core";
import type { PlatformAdapter } from "../platform/types.js";
import { en } from "../copy/en.js";
import { bindFlyerInput, bindFlapInput } from "./input.js";
import { flyerRenderer } from "./canvas.js";
import { createFlyerClient, FlyerClientError } from "./client.js";
import type { FlyerSession, FlyerResult, FlyerView, FlyerLeaderboard } from "./client.js";
import { flyerFeedback } from "./feedback.js";
import { flyerViewport, lockFlyerScroll, enterFlyerHost } from "./play-mode.js";
import { FlyerChart } from "./Charts.js";
import { FlightDialog } from "./FlightDialog.js";
import "./flyer.css";
const c = GAME_CONFIG.flyer,
  copy = en.flyer;
/** Decorative lobby only. No lobby price or score is submitted to the API. */
const lobby = flyerV3Course(
  // Keep the optional coin trail inside the decorative lobby viewport.
  90,
  "2026-10-26",
  "lobby",
  Object.entries(ASSETS).map(([ticker, asset]) => ({
    ticker,
    asset,
    prices: ["100", "100"],
    centers: [],
    changePct: "0",
    fact: null,
  })),
);
export function FlyerPanel({
  platform,
  enabled,
  onAward,
  onBest,
  onHome,
}: {
  platform: PlatformAdapter;
  enabled: boolean;
  onAward: () => void;
  onBest: (best: number) => void;
  onHome: () => void;
}) {
  const client = useMemo(() => createFlyerClient(platform), [platform]),
    feedback = useMemo(() => flyerFeedback(platform), [platform]);
  const [view, setView] = useState<FlyerView | null>(null),
    [session, setSession] = useState<FlyerSession | null>(null),
    [result, setResult] = useState<FlyerResult | null>(null);
  const [error, setError] = useState(""),
    [gettingCharts, setGettingCharts] = useState(false),
    [busy, setBusy] = useState(false),
    [muted, setMuted] = useState(false),
    [shared, setShared] = useState(false);
  const [live, setLive] = useState({ score: 0, coins: 0, started: false }),
    [modal, setModal] = useState<"how" | "ranks" | "charts" | null>(null),
    [chartCount, setChartCount] = useState<number>(c.v3.visibleCharts);
  const [ranking, setRanking] = useState<FlyerLeaderboard | null>(null),
    [period, setPeriod] = useState<"day" | "week" | "season">("day");
  const canvas = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null),
    origin = useRef(0),
    end = useRef<() => void>(() => {});
  const allowed = enabled && !!platform.session;
  const fail = useCallback((e: unknown) => {
    const code = e instanceof FlyerClientError ? e.code : "generic";
    if (code === "FLYER_UNAVAILABLE") {
      setGettingCharts(true);
      setError("");
      return;
    }
    setError(
      code === "GAME_PAUSED"
        ? en.maintenance
        : Object.hasOwn(copy.errors, code)
          ? copy.errors[code as keyof typeof copy.errors]
          : copy.errors.generic,
    );
  }, []);
  const reload = useCallback(async () => {
    const next = await client.read();
    setView(next);
    onBest(next.best);
  }, [client, onBest]);
  useEffect(() => {
    if (allowed) void reload().catch(fail);
  }, [allowed, reload, fail]);
  useEffect(() => {
    if (modal === "ranks" && allowed) void client.leaderboard(period).then(setRanking).catch(fail);
  }, [modal, allowed, client, period, fail]);
  useEffect(() => lockFlyerScroll(), []);
  useEffect(() => () => feedback.dispose(), [feedback]);
  useEffect(() => {
    const target = stage.current,
      element = canvas.current;
    if (!target || !element) return;
    const resize = () => {
      const r = target.getBoundingClientRect(),
        fit = flyerViewport(r.width, r.height);
      Object.assign(element.style, {
        width: `${fit.width}px`,
        height: `${fit.height}px`,
        left: `${fit.left}px`,
      });
      target.parentElement?.style.setProperty("--flight-canvas-left", `${Math.max(0, fit.left)}px`);
      target.parentElement?.style.setProperty(
        "--flight-canvas-right",
        `${Math.max(0, r.width - fit.left - fit.width)}px`,
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (session || !canvas.current) return;
    const draw = flyerRenderer(canvas.current, result?.course ?? lobby, {
      discord: platform.host === "discord",
      lobby: !result,
    });
    let frame = 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const render = (time: number) => {
      draw({
        ...initialFlyer(),
        tick: reduced ? 0 : Math.floor(time * 0.06),
        distance: 335000,
        y: 235000 + (reduced ? 0 : Math.sin(time * 0.002) * 3000),
      });
      if (!reduced) frame = requestAnimationFrame(render);
    };
    render(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [session, result, platform.host]);
  useEffect(() => {
    if (!session || !canvas.current) return;
    const element = canvas.current,
      draw = flyerRenderer(element, session.course, { discord: platform.host === "discord" }),
      v3 = isFlapFlyer(session.course),
      restore = enterFlyerHost(platform);
    let state = initialFlyer(),
      desired = false,
      frame = 0,
      submitted = false,
      disposed = false,
      totalCost = 0,
      frames = 0;
    const inputs: FlyerInput[] = [],
      flaps = new Set<number>();
    feedback.reset();
    element.focus({ preventScroll: true });
    const unbind = v3
      ? bindFlapInput(element, () => {
          flaps.add(
            Math.max(
              state.tick,
              Math.floor(((performance.now() - origin.current) * c.ticksPerSecond) / 1000),
            ),
          );
        })
      : bindFlyerInput(element, (held) => {
          desired = held;
          element.dataset.held = String(held);
        });
    function advance(time: number) {
      const target = Math.min(
        session!.maxTicks,
        Math.max(state.tick, Math.floor(((time - origin.current) * c.ticksPerSecond) / 1000)),
      );
      while (state.tick < target && !state.ended) {
        const input: FlyerInput | undefined = v3
          ? flaps.has(state.tick)
            ? { tick: state.tick, action: "flap" }
            : undefined
          : desired !== state.held
            ? { tick: state.tick, action: desired ? "press" : "release" }
            : undefined;
        if (input) {
          inputs.push(input);
          flaps.delete(input.tick);
        }
        state = stepFlyer(session!.course, state, input);
      }
    }
    async function submit(stop = false) {
      if (submitted) return;
      submitted = true;
      cancelAnimationFrame(frame);
      setBusy(true);
      try {
        if (v3 && !state.started) {
          await client.cancel(session!.id);
        } else {
          const next = await client.finish(
            session!.id,
            state.tick,
            state.score,
            inputs,
            stop || undefined,
          );
          if (!disposed) {
            setResult(next);
            onBest(next.best);
            onAward();
          }
        }
      } catch (e) {
        if (!disposed) fail(e);
      } finally {
        if (!disposed) {
          setSession(null);
          setBusy(false);
          void reload().catch(fail);
        }
      }
    }
    const leave = () => {
      advance(performance.now());
      draw(state);
      void submit(v3 && !state.ended && state.tick < session.maxTicks);
    };
    end.current = leave;
    const visibility = () => {
      if (document.hidden) leave();
    };
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", visibility);
    const back = platform.setBackButton?.(leave);
    function render(time: number) {
      const before = performance.now();
      advance(time);
      draw(state);
      feedback.frame(state);
      frames++;
      totalCost += performance.now() - before;
      Object.assign(element.dataset, {
        frameCostMs: String(totalCost / frames),
        tick: String(state.tick),
        y: String(state.y),
        velocity: String(state.velocity),
        score: String(state.score),
        coins: String(state.coins ?? 0),
        pipes: String(flyerProgress(session!.course, state)),
        targetCenter: String(
          flyerPipe(session!.course, flyerProgress(session!.course, state), state.distance).center,
        ),
      });
      setLive((previous) =>
        previous.score === state.score &&
        previous.coins === (state.coins ?? 0) &&
        previous.started === (state.started ?? true)
          ? previous
          : { score: state.score, coins: state.coins ?? 0, started: state.started ?? true },
      );
      if (state.ended || state.tick >= session!.maxTicks) {
        void submit();
        return;
      }
      frame = requestAnimationFrame(render);
    }
    draw(state);
    frame = requestAnimationFrame(render);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unbind();
      restore();
      back?.();
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", visibility);
      end.current = () => {};
    };
  }, [session, platform, client, feedback, onBest, onAward, reload, fail]);
  async function start() {
    if (busy) return;
    feedback.unlock();
    setBusy(true);
    setError("");
    setGettingCharts(false);
    setResult(null);
    setShared(false);
    try {
      const before = performance.now(),
        next = await client.start();
      origin.current = before + (performance.now() - before) / 2;
      setLive({ score: 0, coins: 0, started: false });
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
    try {
      await client.cancel(view.active.id);
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    try {
      const url = "https://mstocks-arena.vercel.app/#screen=flyer",
        message = copy.shareScore(result?.score ?? view?.best ?? 0);
      if (platform.shareInvite && platform.host !== "browser")
        await platform.shareInvite("flyer", url, message);
      else if (navigator.share) await navigator.share({ title: copy.title, text: message, url });
      else {
        await navigator.clipboard.writeText(`${message} ${url}`);
        setShared(true);
      }
    } catch {
      setError(en.auth.errors.LINK_FAILED);
    }
  }
  const pipes = result?.pipes ?? result?.score ?? 0,
    visited =
      result?.course.segments.slice(
        0,
        Math.min(
          result.course.segments.length,
          result.course.version === "flyer-1" ? Math.floor(pipes / 10) + 1 : pipes,
        ),
      ) ?? [];
  const charts = visited.slice(-4),
    total = result?.pointsToday ?? view?.pointsToday ?? 0,
    cap = view?.dailyCap ?? c.dailyPointsCap;
  const currentSegment =
    session?.course.segments[flyerAssetIndex(session.course, Math.max(0, live.score - live.coins))];
  return (
    <div
      className={`flight-screen ${session ? "is-playing" : result ? "is-result" : "is-lobby"}`}
      data-flight-screen={session ? "play" : result ? "result" : "start"}
    >
      <div ref={stage} className="flight-world">
        <canvas
          ref={canvas}
          tabIndex={session ? 0 : -1}
          aria-hidden={!session}
          aria-label={session && !isFlapFlyer(session.course) ? copy.canvas : copy.v3Canvas}
        />
      </div>
      <div className="flight-top">
        <button
          onClick={() => (session && isFlapFlyer(session.course) ? end.current() : onHome())}
          aria-label={session && isFlapFlyer(session.course) ? copy.exit : en.navigation.back}
        >
          {session ? "Ⅱ" : "←"}
        </button>
        {(!session || !isFlapFlyer(session.course)) && (
          <button
            onClick={() => {
              setMuted(!muted);
              feedback.mute(!muted);
            }}
            aria-label={muted ? copy.unmute : copy.mute}
            aria-pressed={muted}
          >
            {muted ? "♫̸" : "♫"}
          </button>
        )}
      </div>
      {session ? (
        <>
          <p className="visually-hidden flight-announcement" role="status">
            {currentSegment && copy.announce(currentSegment.asset.symbol, currentSegment.changePct)}
            {currentSegment?.lastSession && ` · ${copy.lastSession}`}
          </p>
          <div className="flight-hud" aria-live="off">
            <strong aria-label={copy.score}>{live.score}</strong>
            <span aria-label={copy.coinsCount(live.coins)}>● {live.coins}</span>
          </div>
          {!live.started && <p className="flight-tap">{copy.tapHint}</p>}
        </>
      ) : (
        <div className="flight-content">
          {result ? (
            <>
              <h1 className="flight-game-over">{copy.gameOver.toUpperCase()}</h1>
              <div className="flight-stats">
                <div>
                  <span>{copy.score}</span>
                  <strong>{result.score}</strong>
                  {result.newBest && <b className="flight-new">{copy.newBest}</b>}
                </div>
                <div>
                  <span>{copy.stocks}</span>
                  <strong>{pipes}</strong>
                </div>
                <div>
                  <span>{copy.coins}</span>
                  <strong>{result.coins ?? 0}</strong>
                </div>
              </div>
              <div className="flight-progress">
                <span>{copy.earnedToday(result.pointsAwarded, total, cap)}</span>
                <progress value={Math.max(0, total)} max={cap} />
              </div>
              <div className="flight-chart-heading">
                <h2>{copy.chartTitle}</h2>
                {visited.length > 4 && (
                  <button
                    onClick={() => {
                      setChartCount(c.v3.visibleCharts);
                      setModal("charts");
                    }}
                  >
                    {copy.seeAllCharts(visited.length)}
                  </button>
                )}
              </div>
              <div className="flight-charts">
                {charts.map((s) => (
                  <FlyerChart key={s.ticker} segment={s} discord={platform.host === "discord"} />
                ))}
              </div>
              {!visited.length && <p className="flight-start-hint">{copy.noStocks}</p>}
              {visited.length > 0 && (
                <div className="flight-movers">
                  {(["gainers", "decliners"] as const).map((group) => (
                    <section key={group}>
                      <h3>{copy[group]}</h3>
                      <span>
                        {visited
                          .filter((s) =>
                            group === "gainers" ? Number(s.changePct) > 0 : Number(s.changePct) < 0,
                          )
                          .sort((a, b) =>
                            group === "gainers"
                              ? Number(b.changePct) - Number(a.changePct)
                              : Number(a.changePct) - Number(b.changePct),
                          )
                          .slice(0, 3)
                          .map(
                            (s) =>
                              `${s.asset.symbol} ${Number(s.changePct) > 0 ? "▲" : "▼"}${Math.abs(Number(s.changePct)).toFixed(2)}%`,
                          )
                          .join(" · ") || copy.noMovers}
                      </span>
                    </section>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="flight-run-title">{copy.runTitle}</p>
              <h1 className="flight-title">
                <span>{copy.brand}</span>
                {copy.wordmark}
              </h1>
              <div className="flight-stats flight-lobby-stats">
                <div>
                  <span>{copy.bestToday}</span>
                  <strong>{view?.best ?? "—"}</strong>
                </div>
                <div>
                  <span>{copy.pointsToday(total, cap)}</span>
                  <strong>
                    {total}
                    <small>/{cap}</small>
                  </strong>
                  <progress value={Math.max(0, total)} max={cap} />
                </div>
              </div>
            </>
          )}
          <div className="flight-messages" aria-live="polite">
            {!allowed && <p>{platform.host === "browser" ? copy.preview : copy.loading}</p>}
            {allowed && !view && <p>{copy.loading}</p>}
            {view?.maintenance && <p>{en.maintenance}</p>}
            {view && !view.available && <p>{copy.configuration}</p>}
            {gettingCharts && <p role="status">{copy.gettingCharts}</p>}
            {error && (
              <p role="alert">
                {error}
                <button onClick={() => void reload().catch(fail)}>{copy.retry}</button>
              </p>
            )}
            {busy && <p role="status">{copy.verifying}</p>}
            {view?.active && (
              <p>
                {copy.unfinished}
                <button disabled={busy} onClick={() => void discard()}>
                  {copy.discard}
                </button>
              </p>
            )}
            {view && total >= cap && <p>{copy.cap}</p>}
            {shared && <p>{copy.shared}</p>}
          </div>
          <button
            className="flight-play"
            disabled={busy || !allowed || !view?.canStart}
            onClick={() => void start()}
          >
            {gettingCharts ? copy.retry : result ? copy.playAgain.toUpperCase() : copy.tapPlay}
          </button>
          <div className="flight-actions">
            {result ? (
              <>
                <button onClick={onHome}>{copy.home}</button>
                <button onClick={() => setModal("ranks")}>{copy.ranks}</button>
                <button onClick={() => void share()}>{copy.share}</button>
              </>
            ) : (
              <>
                <button onClick={() => setModal("ranks")}>{copy.rankings}</button>
                <button onClick={() => setModal("how")}>{copy.howTo}</button>
              </>
            )}
          </div>
          {!result && <p className="flight-start-hint">{copy.startHint}</p>}
        </div>
      )}
      {modal && (
        <FlightDialog
          title={
            modal === "how" ? copy.howTo : modal === "charts" ? copy.chartTitle : copy.rankings
          }
          onClose={() => setModal(null)}
        >
          {modal === "how" ? (
            <p>{copy.v3Rules}</p>
          ) : modal === "charts" ? (
            <>
              <div className="flight-charts">
                {visited.slice(-chartCount).map((s) => (
                  <FlyerChart key={s.ticker} segment={s} discord={platform.host === "discord"} />
                ))}
              </div>
              {visited.length > chartCount && (
                <button onClick={() => setChartCount((n) => n + c.v3.visibleCharts)}>
                  {copy.showMore}
                </button>
              )}
            </>
          ) : (
            <>
              <div className="flight-actions">
                {(["day", "week", "season"] as const).map((p) => (
                  <button key={p} aria-pressed={p === period} onClick={() => setPeriod(p)}>
                    {en.leaderboard.periods[p]}
                  </button>
                ))}
              </div>
              {ranking?.entries.length ? (
                <ol>
                  {ranking.entries.map((r) => (
                    <li key={r.userId}>
                      {r.rank}. {r.displayName}
                      <strong>{r.score}</strong>
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
            </>
          )}
        </FlightDialog>
      )}
    </div>
  );
}
