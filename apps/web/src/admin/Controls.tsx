import { useCallback, useEffect, useState } from "react";
import { en } from "../copy/en.js";
import type { AdminSession } from "./client.js";
import { createControlsClient } from "./controls-client.js";
import type { GameControl, SeasonRow, TickerControl } from "./controls-client.js";
const c = en.admin,
  copy = c.gameControls,
  client = createControlsClient();
type Props = {
  session: AdminSession;
  busy: boolean;
  revision: number;
  write: (fn: () => Promise<unknown>) => Promise<void>;
  onError: (e: unknown) => void;
};
function useData<T>(load: () => Promise<T>, revision: number, error: Props["onError"]) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void load()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e: unknown) => {
        if (active) error(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load, revision, error]);
  return { data, loading };
}
function utc(value: string | null) {
  return value ? `${new Date(value).toISOString().replace("T", " ").slice(0, 19)} UTC` : c.none;
}
function Toggle({
  label,
  paused,
  onSave,
  busy,
}: {
  label: string;
  paused: boolean;
  onSave: (paused: boolean, reason: string) => Promise<void>;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <form
      className="admin-operation-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (window.confirm(copy.confirmToggle)) void onSave(!paused, reason);
      }}
    >
      <label>
        {c.ops.reason}
        <textarea
          required
          maxLength={2000}
          aria-label={`${c.ops.reason}: ${label}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button className={`admin-button ${paused ? "" : "danger"}`} disabled={busy}>
        {paused ? copy.resume : copy.pause}
      </button>
    </form>
  );
}
export function GameControls(props: Props) {
  const load = useCallback(() => client.games(), []),
    { data, loading } = useData(load, props.revision, props.onError);
  return (
    <>
      <p className="admin-intro">{copy.gameIntro}</p>
      <p className="admin-warning">{copy.pendingNotice}</p>
      {loading && <p role="status">{c.loading}</p>}
      <div className="admin-controls-grid">
        {data?.entries.map((game: GameControl) => (
          <section className="admin-card" key={game.game} aria-label={copy.names[game.game]}>
            <h2>{copy.names[game.game]}</h2>
            <p className={`admin-pill ${game.paused ? "inactive" : ""}`}>
              {game.paused ? en.maintenance : c.active}
            </p>
            <p>
              {copy.lastReason}: {game.reason || c.none}
            </p>
            <p className="caption muted">{utc(game.updatedAt)}</p>
            <Toggle
              label={copy.names[game.game]}
              paused={game.paused}
              busy={props.busy}
              onSave={(paused, reason) =>
                props.write(() => client.game(props.session.csrf, game.game, paused, reason))
              }
            />
          </section>
        ))}
      </div>
    </>
  );
}
export function TickerControls(props: Props) {
  const load = useCallback(() => client.tickers(), []),
    { data, loading } = useData(load, props.revision, props.onError);
  const [selected, setSelected] = useState<string | null>(null);
  const row = data?.entries.find((r) => r.ticker === selected);
  return (
    <>
      <p className="admin-intro">{copy.tickerIntro}</p>
      {loading && <p role="status">{c.loading}</p>}
      {data && (
        <section className="admin-card">
          <h2>{c.tickers}</h2>
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    c.ops.ticker,
                    copy.company,
                    copy.price,
                    c.status,
                    copy.oracle,
                    copy.lastReason,
                    c.actions,
                  ].map((name) => (
                    <th key={name}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((r: TickerControl) => (
                  <tr key={r.ticker}>
                    <td data-label={c.ops.ticker}>{r.ticker}</td>
                    <td data-label={copy.company}>
                      {Object.values(data.catalog).find((a) => a.referenceTicker === r.ticker)
                        ?.name ?? r.ticker}
                    </td>
                    <td data-label={copy.price} className="admin-mono">
                      {r.priceUsd ?? c.none}
                    </td>
                    <td data-label={c.status}>
                      <span className="admin-pill">
                        {r.state === "live" ? copy.live : copy.paused}
                      </span>
                      <small>{r.reason ?? c.none}</small>
                    </td>
                    <td data-label={copy.oracle}>
                      {r.oracleState ?? c.none}
                      <small>{r.oracleReason ?? c.none}</small>
                      <small>{utc(r.updatedAt)}</small>
                    </td>
                    <td data-label={copy.lastReason}>{r.manualReason || c.none}</td>
                    <td data-label={c.actions}>
                      <button
                        className="admin-text-button"
                        disabled={props.busy}
                        onClick={() => setSelected(r.ticker)}
                      >
                        {copy.manage}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {row && (
        <section className="admin-card" aria-label={copy.manageTicker}>
          <h2>
            {row.ticker} · {copy.manualControl}
          </h2>
          <p>{copy.resumeNotice}</p>
          <Toggle
            key={`${row.ticker}:${row.manualPaused}`}
            label={row.ticker}
            paused={row.manualPaused}
            busy={props.busy}
            onSave={(paused, reason) =>
              props.write(() => client.ticker(props.session.csrf, row.ticker, paused, reason))
            }
          />
          <button className="admin-text-button" onClick={() => setSelected(null)}>
            {c.cancel}
          </button>
        </section>
      )}
    </>
  );
}
export function Seasons(props: Props) {
  const load = useCallback(() => client.seasons(), []),
    { data, loading } = useData(load, props.revision, props.onError);
  const [editor, setEditor] = useState<SeasonRow | "new" | null>(null);
  return (
    <>
      <p className="admin-intro">{copy.seasonIntro}</p>
      <p className="admin-warning">{copy.ledgerNotice}</p>
      <button className="admin-button" onClick={() => setEditor("new")} disabled={props.busy}>
        {copy.newSeason}
      </button>
      {loading && <p role="status">{c.loading}</p>}
      {data && (
        <section className="admin-card admin-table-card">
          <h2>{c.seasons}</h2>
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  {[copy.seasonName, copy.starts, copy.ends, c.status, c.actions].map((name) => (
                    <th key={name}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((s) => (
                  <tr key={s.id}>
                    <td data-label={copy.seasonName}>
                      {s.name}
                      <small>{s.id}</small>
                    </td>
                    <td data-label={copy.starts}>{utc(s.startsAt)}</td>
                    <td data-label={copy.ends}>{s.endsAt ? utc(s.endsAt) : copy.ongoing}</td>
                    <td data-label={c.status}>
                      {s.startsAt > data.serverTime
                        ? copy.upcoming
                        : s.endsAt && s.endsAt <= data.serverTime
                          ? copy.ended
                          : copy.ongoing}
                    </td>
                    <td data-label={c.actions}>
                      <button
                        className="admin-text-button"
                        disabled={props.busy}
                        onClick={() => setEditor(s)}
                      >
                        {copy.editSeason}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {editor && data && (
        <SeasonEditor
          key={editor === "new" ? "new" : editor.id}
          row={editor === "new" ? undefined : editor}
          now={data.serverTime}
          close={() => setEditor(null)}
          {...props}
        />
      )}
    </>
  );
}
function SeasonEditor({
  row,
  now,
  close,
  ...props
}: Props & { row?: SeasonRow; now: string; close: () => void }) {
  const [id, setId] = useState(row?.id ?? ""),
    [name, setName] = useState(row?.name ?? ""),
    [start, setStart] = useState(row ? new Date(row.startsAt).toISOString().slice(0, -1) : ""),
    [end, setEnd] = useState(row?.endsAt ? new Date(row.endsAt).toISOString().slice(0, -1) : ""),
    [reason, setReason] = useState("");
  const lockedStart =
    !!row &&
    Date.parse(row.startsAt) <= Date.parse(now) &&
    !props.session.permissions.includes("seasons:past-start");
  return (
    <section className="admin-card" aria-label={copy.seasonEditor}>
      <h2>{row ? copy.editSeason : copy.newSeason}</h2>
      <p>{copy.pastStart}</p>
      <form
        className="admin-operation-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!window.confirm(copy.confirmSeason)) return;
          void props.write(async () => {
            await client.season(props.session.csrf, {
              id,
              name,
              startsAt: new Date(`${start}Z`).toISOString(),
              endsAt: end ? new Date(`${end}Z`).toISOString() : null,
              reason,
              create: !row,
            });
            close();
          });
        }}
      >
        <label>
          {copy.seasonId}
          <input
            required
            pattern="[a-z0-9][a-z0-9_-]*"
            maxLength={100}
            value={id}
            disabled={!!row || props.busy}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <label>
          {copy.seasonName}
          <input
            required
            maxLength={160}
            value={name}
            disabled={props.busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          {copy.starts}
          <input
            type="datetime-local"
            step="0.001"
            required
            value={start}
            disabled={lockedStart || props.busy}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          {copy.ends}
          <input
            type="datetime-local"
            step="0.001"
            value={end}
            disabled={props.busy}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <p>{copy.emptyEnd}</p>
        <label>
          {c.ops.reason}
          <textarea
            required
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button className="admin-button" disabled={props.busy}>
          {copy.saveSeason}
        </button>
        <button type="button" className="admin-text-button" onClick={close}>
          {c.cancel}
        </button>
      </form>
    </section>
  );
}
