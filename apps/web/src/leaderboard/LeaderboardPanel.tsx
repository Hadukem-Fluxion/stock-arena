import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardPlatform,
  LeaderboardView,
} from "@stock-arena/game-core";
import type { PlatformAdapter } from "../platform/types.js";
import { en } from "../copy/en.js";
import { createLeaderboardClient, LeaderboardClientError } from "./client.js";

function useLeaderboard(
  platform: PlatformAdapter,
  enabled: boolean,
  period: LeaderboardPeriod,
  filter: LeaderboardPlatform,
) {
  const allowed = enabled && platform.host !== "browser";
  const client = useMemo(() => createLeaderboardClient(() => platform.session), [platform]);
  const [view, setView] = useState<LeaderboardView | null>(null);
  const [error, setError] = useState<"session" | "network" | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setView(null);
    setError(null);
    setBusy(false);
    if (!allowed) return;
    let active = true,
      pending = false;
    let controller: AbortController | undefined;
    const load = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      setBusy(true);
      controller = new AbortController();
      const timer = setTimeout(() => controller?.abort(), 15_000);
      try {
        const result = await client(period, filter, controller.signal);
        if (active) {
          setView(result);
          setError(null);
        }
      } catch (cause) {
        if (active) setError(cause instanceof LeaderboardClientError ? cause.code : "network");
      } finally {
        clearTimeout(timer);
        pending = false;
        if (active) setBusy(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 60_000);
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [allowed, client, period, filter, reload]);
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  return { allowed, view, error, busy, refresh };
}
function RankingRows({ rows, callerId }: { rows: LeaderboardEntry[]; callerId?: string }) {
  return (
    <ol className="leaderboard-list">
      {rows.map((row) => (
        <li
          value={row.rank}
          key={row.userId}
          className={`leaderboard-row ${callerId === row.userId ? "is-you" : ""}`}
        >
          <span className="number muted">#{row.rank}</span>
          <span className="ranking-name" title={row.displayName}>
            {row.displayName}
            {callerId === row.userId && <small className="accent"> · {en.leaderboard.you}</small>}
          </span>
          <strong className="number accent">
            {row.score.toLocaleString("en-US")} <small>{en.labels.points}</small>
          </strong>
        </li>
      ))}
    </ol>
  );
}
export function TodayTopFive({
  platform,
  enabled,
}: {
  platform: PlatformAdapter;
  enabled: boolean;
}) {
  const state = useLeaderboard(platform, enabled, "day", "all");
  return (
    <>
      <p className="eyebrow">{en.labels.season}</p>
      <h2>{en.labels.topFive}</h2>
      {state.view?.top.length ? (
        <RankingRows rows={state.view.top.slice(0, 5)} callerId={state.view.caller?.userId} />
      ) : (
        <p className="muted empty-state">
          {state.error
            ? en.leaderboard.error
            : state.allowed
              ? state.busy
                ? en.leaderboard.loading
                : en.leaderboard.empty
              : en.leaderboard.preview}
        </p>
      )}
    </>
  );
}
export function LeaderboardPanel({
  platform,
  enabled,
}: {
  platform: PlatformAdapter;
  enabled: boolean;
}) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("day");
  const [filter, setFilter] = useState<LeaderboardPlatform>("all");
  const state = useLeaderboard(platform, enabled, period, filter);
  return (
    <div className="leaderboard-panel" aria-busy={state.busy}>
      <div className="ranking-filters" aria-label={en.leaderboard.periodLabel}>
        {(["day", "week", "season"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
          >
            {en.leaderboard.periods[value]}
          </button>
        ))}
      </div>
      <div className="ranking-filters" aria-label={en.leaderboard.platformLabel}>
        {(["all", "discord", "telegram"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {en.leaderboard.platforms[value]}
          </button>
        ))}
      </div>
      {!state.allowed && <p className="muted empty-state">{en.leaderboard.empty}</p>}
      {!state.allowed && <p className="muted">{en.leaderboard.preview}</p>}
      {state.error && (
        <p role="alert">
          {state.error === "session" ? en.quiz.sessionError : en.leaderboard.error}
        </p>
      )}
      {state.allowed && state.busy && !state.view && (
        <p className="muted">{en.leaderboard.loading}</p>
      )}
      {period === "season" && state.view?.season.ended && (
        <p className="pill" role="status">
          {en.leaderboard.seasonEnded}
        </p>
      )}
      {state.view && (
        <>
          <p className="caption muted">
            {en.leaderboard.updates} · {en.labels.utc}
          </p>
          {state.view.top.length ? (
            <RankingRows rows={state.view.top} callerId={state.view.caller?.userId} />
          ) : (
            <p className="muted empty-state">{en.leaderboard.empty}</p>
          )}
          <div className="caller-rank" aria-label={en.leaderboard.yourRank}>
            <h3>{en.leaderboard.yourRank}</h3>
            {state.view.caller ? (
              <RankingRows rows={[state.view.caller]} callerId={state.view.caller.userId} />
            ) : (
              <p className="muted">{en.leaderboard.unranked}</p>
            )}
          </div>
        </>
      )}
      {state.allowed && (
        <button
          type="button"
          className="primary-button"
          disabled={state.busy}
          onClick={state.refresh}
        >
          {en.leaderboard.refresh}
        </button>
      )}
    </div>
  );
}
