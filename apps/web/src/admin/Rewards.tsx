import { useCallback, useEffect, useState } from "react";
import { en } from "../copy/en.js";
import type { AdminSession } from "./client.js";
import { createRewardsClient } from "./rewards-client.js";
import type { RewardPlayer, RewardSeason } from "./rewards-client.js";
const client = createRewardsClient(),
  c = en.admin,
  r = c.rewardOps;
type Props = {
  session: AdminSession;
  revision: number;
  busy: boolean;
  write: (fn: () => Promise<unknown>) => Promise<void>;
  onError: (e: unknown) => void;
};
function useData<T>(load: () => Promise<T>, revision: number, error: Props["onError"]) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    void load()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) error(e);
      });
    return () => {
      active = false;
    };
  }, [load, revision, error]);
  return data;
}
function utc(value: string | null) {
  return value ? `${value.replace("T", " ").slice(0, 19)} UTC` : c.none;
}
export function Rewards(props: Props) {
  const list = useData(client.seasons, props.revision, props.onError);
  const [id, setId] = useState(""),
    [tab, setTab] = useState("season");
  const selected = id || list?.seasons[0]?.id || "";
  const canWrite = props.session.permissions.includes("rewards:write");
  return (
    <>
      <p className="admin-intro">{r.intro}</p>
      <p className="admin-warning">{en.rewards.terms}</p>
      <div className="admin-tabs">
        <button
          className="admin-button secondary"
          aria-pressed={tab === "season"}
          onClick={() => setTab("season")}
        >
          {r.seasonRewards}
        </button>
        <button
          className="admin-button secondary"
          aria-pressed={tab === "players"}
          onClick={() => setTab("players")}
        >
          {r.destinations}
        </button>
      </div>
      {tab === "players" ? (
        <Destinations {...props} canWrite={canWrite} />
      ) : (
        <>
          <label className="admin-filter-label">
            {r.season}
            <select value={selected} onChange={(e) => setId(e.target.value)}>
              {list?.seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.id}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <SeasonRewards key={selected} {...props} id={selected} canWrite={canWrite} />
          )}
        </>
      )}
    </>
  );
}
function SeasonRewards(props: Props & { id: string; canWrite: boolean }) {
  const load = useCallback(() => client.season(props.id), [props.id]);
  const data = useData(load, props.revision, props.onError);
  const [from, setFrom] = useState(1),
    [to, setTo] = useState(1),
    [description, setDescription] = useState(""),
    [reason, setReason] = useState(""),
    [top, setTop] = useState(10),
    [selected, setSelected] = useState<RewardSeason["entries"][number] | null>(null),
    [status, setStatus] = useState("approved"),
    [note, setNote] = useState("");
  if (!data) return <p role="status">{c.loading}</p>;
  async function download() {
    const csv = await client.export(props.session.csrf, props.id);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
      link = document.createElement("a");
    link.href = url;
    link.download = "rewards.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <section className="admin-card">
        <h2>{data.snapshot?.seasonName ?? data.season.name}</h2>
        <p>
          {utc(data.snapshot?.startsAt ?? data.season.startsAt)} →{" "}
          {utc(data.snapshot?.endsAt ?? data.season.endsAt)}
        </p>
        <p className="admin-pill">{data.snapshot ? r.frozen : r.notFrozen}</p>
        <p>{data.locked ? en.rewards.locked : r.unlocked}</p>
        {data.snapshot && (
          <p>
            {r.frozenAt}: {utc(data.snapshot.createdAt)} · {r.topN}: {data.snapshot.topN}
          </p>
        )}
        <p className="caption muted">{r.freezeHelp}</p>
      </section>
      {props.canWrite && (
        <section className="admin-card">
          <h2>{r.prepare}</h2>
          <form
            className="admin-operation-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (window.confirm(r.confirmLock))
                void props.write(() =>
                  client.lock(props.session.csrf, props.id, !data.locked, reason),
                );
            }}
          >
            <label>
              {c.ops.reason}
              <textarea
                required
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className="admin-button secondary" disabled={props.busy}>
              {data.locked ? r.unlock : r.lock}
            </button>
          </form>
          {!data.snapshot && (
            <>
              <form
                className="admin-operation-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (window.confirm(r.confirmPrize))
                    void props.write(() =>
                      client.prize(props.session.csrf, {
                        seasonId: props.id,
                        rankFrom: from,
                        rankTo: to,
                        description,
                        reason,
                      }),
                    );
                }}
              >
                <label>
                  {r.rankFrom}
                  <input
                    type="number"
                    required
                    min={1}
                    max={10000}
                    value={from}
                    onChange={(e) => setFrom(Number(e.target.value))}
                  />
                </label>
                <label>
                  {r.rankTo}
                  <input
                    type="number"
                    required
                    min={from}
                    max={10000}
                    value={to}
                    onChange={(e) => setTo(Number(e.target.value))}
                  />
                </label>
                <label>
                  {r.prize}
                  <textarea
                    required
                    maxLength={2000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <button className="admin-button" disabled={props.busy || !reason.trim()}>
                  {r.addPrize}
                </button>
              </form>
              <form
                className="admin-operation-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (window.confirm(r.confirmFreeze))
                    void props.write(() =>
                      client.freeze(props.session.csrf, props.id, top, reason),
                    );
                }}
              >
                <label>
                  {r.topN}
                  <input
                    required
                    type="number"
                    min={1}
                    max={10000}
                    value={top}
                    onChange={(e) => setTop(Number(e.target.value))}
                  />
                </label>
                <button
                  className="admin-button danger"
                  disabled={
                    props.busy ||
                    !reason.trim() ||
                    !data.season.endsAt ||
                    Date.parse(data.season.endsAt) > Date.now()
                  }
                >
                  {r.freeze}
                </button>
              </form>
            </>
          )}
        </section>
      )}
      <section className="admin-card">
        <h2>{r.prizes}</h2>
        {data.prizes.length ? (
          <ul>
            {data.prizes.map((p) => (
              <li key={p.id}>
                {p.rankFrom}–{p.rankTo}: {p.description}
              </li>
            ))}
          </ul>
        ) : (
          <p>{r.noPrizes}</p>
        )}
      </section>
      {data.snapshot && (
        <>
          {props.session.permissions.includes("rewards:export") && (
            <button
              className="admin-button"
              disabled={props.busy}
              onClick={() => void props.write(download)}
            >
              {r.export}
            </button>
          )}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {[r.rank, r.player, r.points, r.platform, r.prize, c.status, c.actions].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td data-label={r.rank}>{e.rank}</td>
                    <td data-label={r.player}>
                      {e.displayName}
                      <small>{r.reviewRequired}</small>
                    </td>
                    <td data-label={r.points}>{e.points}</td>
                    <td data-label={r.platform}>
                      {e.identities.map((i) => (
                        <div key={`${i.platform}:${i.platformUserId}`}>
                          {i.platform} · {i.platformUserId}
                        </div>
                      ))}
                    </td>
                    <td data-label={r.prize}>{e.prizeDescription}</td>
                    <td data-label={c.status}>
                      <span className="admin-pill">{r.statuses[e.event.status]}</span>
                      <small>{e.event.note}</small>
                    </td>
                    <td data-label={c.actions}>
                      {props.canWrite && !["delivered", "void"].includes(e.event.status) ? (
                        <button
                          className="admin-text-button"
                          onClick={() => {
                            setSelected(e);
                            setStatus(e.event.status === "pending" ? "approved" : "delivered");
                            setNote("");
                          }}
                        >
                          {r.manage}
                        </button>
                      ) : (
                        c.none
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.entries.length && <p>{r.empty}</p>}
          </div>
        </>
      )}
      {selected && (
        <section className="admin-card">
          <h2>
            {r.manage}: {selected.displayName}
          </h2>
          <p>{r.reviewRequired}</p>
          <form
            className="admin-operation-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (window.confirm(r.confirmStatus))
                void props.write(async () => {
                  await client.status(
                    props.session.csrf,
                    selected.id,
                    selected.event.version,
                    status,
                    note,
                  );
                  setSelected(null);
                });
            }}
          >
            <label>
              {c.status}
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value={selected.event.status === "pending" ? "approved" : "delivered"}>
                  {selected.event.status === "pending" ? r.statuses.approved : r.statuses.delivered}
                </option>
                <option value="void">{r.statuses.void}</option>
              </select>
            </label>
            <label>
              {r.note}
              <textarea
                required
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button className="admin-button" disabled={props.busy}>
              {c.confirm}
            </button>
            <button type="button" className="admin-text-button" onClick={() => setSelected(null)}>
              {c.cancel}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
function Destinations(props: Props & { canWrite: boolean }) {
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<RewardPlayer | null>(null),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const load = useCallback(() => client.players(query, page), [query, page]);
  const data = useData(load, props.revision, props.onError);
  const historyLoad = useCallback(
    () => (selected ? client.history(selected.id) : Promise.resolve({ history: [] })),
    [selected],
  );
  const history = useData(historyLoad, props.revision, props.onError);
  return (
    <>
      <form
        className="admin-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
          setPage(1);
        }}
      >
        <label>
          {r.search}
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <button className="admin-button">{c.apply}</button>
      </form>
      <p>{props.canWrite ? r.fullAccess : r.maskedAccess}</p>
      {!data ? (
        <p role="status">{c.loading}</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {[r.player, en.rewards.uid, en.rewards.address, r.changed, c.actions].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((row) => (
                  <tr key={row.id}>
                    <td data-label={r.player}>{row.displayName}</td>
                    <td data-label={en.rewards.uid}>{row.bybitUid || c.none}</td>
                    <td data-label={en.rewards.address}>{row.mantleAddress || c.none}</td>
                    <td data-label={r.changed}>{utc(row.changedAt)}</td>
                    <td data-label={c.actions}>
                      <button
                        className="admin-text-button"
                        onClick={() => {
                          setSelected(row);
                          setConfirmed(false);
                          setReason("");
                        }}
                      >
                        {r.view}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-pagination">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              {c.previous}
            </button>
            <span>{c.page(page)}</span>
            <button disabled={!data.hasMore} onClick={() => setPage(page + 1)}>
              {c.next}
            </button>
          </div>
        </>
      )}
      {selected && (
        <section className="admin-card">
          <h2>{selected.displayName}</h2>
          {props.canWrite && (
            <form
              className="admin-operation-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (window.confirm(r.confirmDestination))
                  void props.write(async () => {
                    await client.save(props.session.csrf, selected, reason);
                    setSelected(null);
                  });
              }}
            >
              <label>
                {en.rewards.uid}
                <input
                  value={selected.bybitUid}
                  pattern="[0-9]{5,12}"
                  maxLength={12}
                  onChange={(e) => {
                    setSelected({ ...selected, bybitUid: e.target.value });
                    setConfirmed(false);
                  }}
                />
              </label>
              <label>
                {en.rewards.address}
                <input
                  value={selected.mantleAddress}
                  pattern="0x[0-9a-fA-F]{40}"
                  maxLength={42}
                  onChange={(e) => {
                    setSelected({ ...selected, mantleAddress: e.target.value });
                    setConfirmed(false);
                  }}
                />
              </label>
              <label>
                {c.ops.reason}
                <textarea required value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <label className="reward-confirm">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {r.staffConfirm}
              </label>
              <button className="admin-button" disabled={!confirmed || props.busy}>
                {c.confirm}
              </button>
            </form>
          )}
          <h3>{en.rewards.history}</h3>
          {history?.history.map((h) => (
            <div key={h.id}>
              <p>
                {utc(h.changedAt)} · {r.actors[h.actor]}
              </p>
              <p>
                {en.rewards.uid}: {h.oldValues.bybitUid || c.none} →{" "}
                {h.newValues.bybitUid || c.none}
              </p>
              <p>
                {en.rewards.address}: {h.oldValues.mantleAddress || c.none} →{" "}
                {h.newValues.mantleAddress || c.none}
              </p>
            </div>
          ))}
          {!history?.history.length && <p>{en.rewards.noHistory}</p>}
        </section>
      )}
    </>
  );
}
