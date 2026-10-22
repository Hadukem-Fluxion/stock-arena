import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { en } from "../copy/en.js";
import type { AdminSession } from "./client.js";
import { createOperationsClient } from "./operations-client.js";
import type { Question, QuestionInput, Player } from "./operations-client.js";

const c = en.admin,
  o = c.ops,
  client = createOperationsClient();
type Props = {
  session: AdminSession;
  revision: number;
  busy: boolean;
  write: (fn: () => Promise<unknown>) => Promise<void>;
  onError: (error: unknown) => void;
};
function utc(value: string | null) {
  return value ? `${new Date(value).toISOString().replace("T", " ").slice(0, 19)} UTC` : c.none;
}
function useView<T>(load: () => Promise<T>, revision: number, onError: Props["onError"]) {
  const [value, setValue] = useState<T | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setValue(null);
    void load()
      .then((data) => {
        if (current) setValue(data);
      })
      .catch((error: unknown) => {
        if (current) onError(error);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [load, revision, onError]);
  return { value, loading };
}
function Pages({
  view,
  change,
  busy,
}: {
  view: { page: number; hasMore: boolean };
  change: (page: number) => void;
  busy?: boolean;
}) {
  return (
    <div className="admin-pagination">
      <button
        className="admin-button secondary"
        disabled={busy || view.page <= 1}
        onClick={() => change(view.page - 1)}
      >
        {c.previous}
      </button>
      <span>{c.page(view.page)}</span>
      <button
        className="admin-button secondary"
        disabled={busy || !view.hasMore}
        onClick={() => change(view.page + 1)}
      >
        {c.next}
      </button>
    </div>
  );
}
function Search({ label, onSearch }: { label: string; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="admin-search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(draft);
      }}
    >
      <label>
        {label}
        <input value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <button className="admin-button">{o.search}</button>
    </form>
  );
}
function Records({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return rows.length ? (
    <div className="admin-table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td data-label={headers[j]} key={j}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p>{o.empty}</p>
  );
}
export function QuizOperations(props: Props) {
  const [filters, setFilters] = useState({ search: "", page: 1 }),
    [editor, setEditor] = useState<Question | "new" | null>(null);
  const [file, setFile] = useState<File | null>(null),
    [imported, setImported] = useState<number | null>(null);
  const load = useCallback(() => client.quiz(filters.search, filters.page), [filters]);
  const { value, loading } = useView(load, props.revision, props.onError);
  return (
    <>
      <p className="admin-intro">{o.quizIntro}</p>
      <p className="admin-warning">{o.privateNotice}</p>
      <section className="admin-card">
        <Search label={o.searchQuiz} onSearch={(search) => setFilters({ search, page: 1 })} />
        <button className="admin-button" disabled={props.busy} onClick={() => setEditor("new")}>
          {o.addQuestion}
        </button>
      </section>
      <section className="admin-card">
        <h2>{c.quiz}</h2>
        {loading ? (
          <p role="status">{c.loading}</p>
        ) : (
          value && (
            <>
              <Records
                headers={[o.slug, o.prompt, c.status, o.scheduledDay, c.actions]}
                rows={value.entries.map((q) => [
                  <span className="admin-mono">{q.slug ?? q.id}</span>,
                  <span className="admin-question-preview">{q.prompt}</span>,
                  <div>
                    <span className={`admin-pill ${q.active ? "" : "inactive"}`}>
                      {q.active ? c.active : o.inactive}
                    </span>
                    {q.frozenToday && <span className="admin-pill">{o.frozen}</span>}
                  </div>,
                  <Schedule question={q} {...props} />,
                  <div className="admin-row-actions">
                    <button
                      className="admin-text-button"
                      disabled={props.busy}
                      onClick={() => setEditor(q)}
                    >
                      {q.frozenToday ? o.openRecord : o.editQuestion}
                    </button>
                    <button
                      className="admin-text-button danger"
                      disabled={props.busy || !q.active}
                      onClick={() => {
                        if (window.confirm(o.deactivateConfirm))
                          void props.write(() => client.deactivate(props.session.csrf, q.id));
                      }}
                    >
                      {o.deactivate}
                    </button>
                  </div>,
                ])}
              />
              <Pages
                view={value}
                busy={props.busy}
                change={(page) => setFilters({ ...filters, page })}
              />
            </>
          )
        )}
      </section>
      {editor && (
        <QuestionEditor
          key={editor === "new" ? "new" : editor.id}
          question={editor === "new" ? undefined : editor}
          close={() => setEditor(null)}
          {...props}
        />
      )}
      <section className="admin-card">
        <h2>{o.importTitle}</h2>
        <p>{o.importBody}</p>
        <form
          className="admin-operation-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file || !window.confirm(o.importConfirm)) return;
            void props.write(async () => {
              let rows: unknown;
              try {
                rows = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
              } catch {
                throw new Error(o.invalidJson);
              }
              const result = await client.importQuiz(props.session.csrf, rows);
              setImported(result.count ?? 0);
            });
          }}
        >
          <label>
            {o.importJson}
            <input
              type="file"
              className="admin-file-input"
              accept="application/json,.json"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <span className="admin-file-choice">{file?.name ?? o.chooseFile}</span>
          </label>
          <button className="admin-button" disabled={props.busy || !file}>
            {o.importButton}
          </button>
        </form>
        {imported !== null && <p>{o.imported(imported)}</p>}
      </section>
    </>
  );
}
function Schedule({ question, ...props }: Props & { question: Question }) {
  const [day, setDay] = useState(question.scheduledDay ?? "");
  useEffect(() => setDay(question.scheduledDay ?? ""), [question.scheduledDay]);
  return (
    <form
      className="admin-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void props.write(() => client.schedule(props.session.csrf, question.id, day || null));
      }}
    >
      <input
        type="date"
        aria-label={`${o.scheduledDay}: ${question.slug ?? question.id}`}
        value={day}
        disabled={props.busy || question.frozenToday}
        onChange={(e) => setDay(e.target.value)}
      />
      <button
        className="admin-text-button"
        disabled={props.busy || question.frozenToday || day === (question.scheduledDay ?? "")}
      >
        {o.schedule}
      </button>
    </form>
  );
}
function QuestionEditor({
  question,
  close,
  ...props
}: Props & { question?: Question; close: () => void }) {
  const [draft, setDraft] = useState<QuestionInput>({
    ...(question ? { id: question.id } : {}),
    slug: question?.slug ?? "",
    topic: question?.topic ?? "",
    prompt: question?.prompt ?? "",
    options: question?.options ?? ["", "", "", ""],
    answerIndex: question?.answerIndex ?? 0,
    explanation: question?.explanation ?? "",
  });
  return (
    <section className="admin-card" aria-label={o.editQuestion}>
      <h2>{question ? o.editQuestion : o.addQuestion}</h2>
      <form
        className="admin-operation-form"
        onSubmit={(e) => {
          e.preventDefault();
          void props.write(async () => {
            await client.saveQuestion(props.session.csrf, draft);
            close();
          });
        }}
      >
        <fieldset disabled={props.busy || question?.frozenToday}>
          <label>
            {o.slug}
            <input
              required
              maxLength={200}
              value={draft.slug ?? ""}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            />
          </label>
          <label>
            {o.topic}
            <input
              required
              maxLength={16000}
              value={draft.topic}
              onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
            />
          </label>
          <label>
            {o.prompt}
            <textarea
              required
              maxLength={16000}
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
          </label>
          <div className="admin-options">
            {draft.options.map((option, i) => (
              <label key={i}>
                {o.option(i + 1)}
                <input
                  required
                  maxLength={16000}
                  value={option}
                  onChange={(e) => {
                    const options: QuestionInput["options"] = [...draft.options];
                    options[i] = e.target.value;
                    setDraft({ ...draft, options });
                  }}
                />
              </label>
            ))}
          </div>
          <label>
            {o.answer}
            <select
              aria-label={o.answer}
              value={draft.answerIndex}
              onChange={(e) => setDraft({ ...draft, answerIndex: Number(e.target.value) })}
            >
              {draft.options.map((_, i) => (
                <option value={i} key={i}>
                  {o.option(i + 1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {o.explanation}
            <textarea
              required
              maxLength={16000}
              value={draft.explanation}
              onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
            />
          </label>
          <button className="admin-button">{o.saveQuestion}</button>
        </fieldset>
        <button type="button" className="admin-text-button" onClick={close}>
          {c.cancel}
        </button>
      </form>
    </section>
  );
}
export function PlayerOperations(props: Props) {
  const [filters, setFilters] = useState({ search: "", page: 1 }),
    [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(() => client.players(filters.search, filters.page), [filters]);
  const { value, loading } = useView(load, props.revision, props.onError);
  return (
    <>
      <p className="admin-intro">{o.playersIntro}</p>
      <section className="admin-card">
        <Search
          label={o.searchPlayers}
          onSearch={(search) => {
            setFilters({ search, page: 1 });
            setSelected(null);
          }}
        />
      </section>
      {selected ? (
        <PlayerDetail key={selected} id={selected} close={() => setSelected(null)} {...props} />
      ) : (
        <section className="admin-card">
          <h2>{c.players}</h2>
          {loading ? (
            <p role="status">{c.loading}</p>
          ) : (
            value && (
              <>
                <Records
                  headers={[o.player, c.status, o.joined, c.actions]}
                  rows={value.entries.map((p) => [
                    p.displayName,
                    o.states[p.status],
                    utc(p.createdAt),
                    <button className="admin-text-button" onClick={() => setSelected(p.id)}>
                      {o.openRecord}
                    </button>,
                  ])}
                />
                <Pages view={value} change={(page) => setFilters({ ...filters, page })} />
              </>
            )
          )}
        </section>
      )}
    </>
  );
}
function PlayerDetail({ id, close, ...props }: Props & { id: string; close: () => void }) {
  const [page, setPage] = useState(1),
    [status, setStatus] = useState<Player["status"]>("suspended"),
    [reason, setReason] = useState("");
  const [amount, setAmount] = useState(""),
    [adjustReason, setAdjustReason] = useState(""),
    [note, setNote] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const load = useCallback(() => client.profile(id, page), [id, page]);
  const { value: v, loading } = useView(load, props.revision, props.onError);
  const can = (permission: string) => props.session.permissions.includes(permission);
  return (
    <>
      <button className="admin-text-button" onClick={close}>
        ← {o.back}
      </button>
      {loading ? (
        <p role="status">{c.loading}</p>
      ) : (
        v && (
          <>
            <section className="admin-card">
              <h2>{v.user.displayName}</h2>
              <span className="admin-pill">{o.states[v.user.status]}</span>
              <dl className="admin-profile-grid">
                <dt>{o.playerId}</dt>
                <dd className="admin-mono">{id}</dd>
                <dt>{o.accountAge}</dt>
                <dd>{v.accountAgeDays}</dd>
                <dt>{o.balance}</dt>
                <dd>{v.balance}</dd>
                <dt>{o.joined}</dt>
                <dd>{utc(v.user.createdAt)}</dd>
              </dl>
              <h3>{o.eligibility}</h3>
              <p>{o.verificationPending}</p>
              <h3>{o.identities}</h3>
              <Records
                headers={[o.platform, o.platformId, o.platformAge]}
                rows={v.identities.map((i) => [
                  i.platform,
                  i.platformUserId,
                  utc(i.platformCreatedAt),
                ])}
              />
            </section>
            <div className="admin-operation-grid">
              {can("players:write") && (
                <section className="admin-card">
                  <h2>{o.changeStatus}</h2>
                  <p>{o.statusBody}</p>
                  <form
                    className="admin-operation-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (window.confirm(o.statusConfirm))
                        void props.write(() =>
                          client.status(props.session.csrf, id, status, reason),
                        );
                    }}
                  >
                    <label>
                      {c.status}
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as Player["status"])}
                      >
                        {Object.entries(o.states).map(([key, label]) => (
                          <option value={key} key={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {o.reason}
                      <textarea
                        required
                        maxLength={2000}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <button className="admin-button danger" disabled={props.busy}>
                      {o.changeStatus}
                    </button>
                  </form>
                </section>
              )}
              {can("points:write") && (
                <section className="admin-card">
                  <h2>{o.adjust}</h2>
                  <p>{o.adjustBody}</p>
                  <form
                    className="admin-operation-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (window.confirm(o.adjustConfirm))
                        void props.write(async () => {
                          await client.adjust(
                            props.session.csrf,
                            id,
                            Number(amount),
                            adjustReason,
                            requestId,
                          );
                          setRequestId(crypto.randomUUID());
                          setAmount("");
                          setAdjustReason("");
                        });
                    }}
                  >
                    <label>
                      {o.amount}
                      <input
                        type="number"
                        required
                        step={1}
                        min={-2147483648}
                        max={2147483647}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </label>
                    <label>
                      {o.reason}
                      <textarea
                        required
                        maxLength={2000}
                        value={adjustReason}
                        onChange={(e) => setAdjustReason(e.target.value)}
                      />
                    </label>
                    <button className="admin-button" disabled={props.busy || !Number(amount)}>
                      {o.adjust}
                    </button>
                  </form>
                </section>
              )}
              {can("flags:write") && (
                <section className="admin-card">
                  <h2>{o.raise}</h2>
                  <form
                    className="admin-operation-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void props.write(async () => {
                        await client.raise(props.session.csrf, id, note);
                        setNote("");
                      });
                    }}
                  >
                    <label>
                      {o.note}
                      <textarea
                        required
                        maxLength={2000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    <button className="admin-button" disabled={props.busy}>
                      {o.raise}
                    </button>
                  </form>
                </section>
              )}
            </div>
            <section className="admin-card">
              <h2>{o.ledger}</h2>
              <Records
                headers={[c.timestamp, o.amount, o.ledgerReason, o.ref]}
                rows={v.ledger.entries.map((l) => [
                  utc(l.createdAt),
                  l.amount,
                  l.reason,
                  <span className="admin-mono">{l.refId}</span>,
                ])}
              />
            </section>
            <section className="admin-card">
              <h2>{o.runs}</h2>
              <Records
                headers={[o.day, o.model, o.correct, o.ended]}
                rows={v.runs.entries.map((r) => [
                  r.day,
                  r.model === "classic" ? o.classic : o.prediction,
                  r.correctCount,
                  utc(r.endedAt),
                ])}
              />
              <h3>{o.predictions}</h3>
              <Records
                headers={[o.ticker, o.roundState, o.settled]}
                rows={v.predictions.map((p) => [p.ticker, p.state, utc(p.settledAt)])}
              />
            </section>
            <section className="admin-card">
              <h2>{o.attempts}</h2>
              <Records
                headers={[o.day, o.score]}
                rows={v.attempts.entries.map((a) => [a.day, a.score])}
              />
            </section>
            <section className="admin-card">
              <h2>{o.checkins}</h2>
              <Records
                headers={[o.day, o.streak]}
                rows={v.checkins.entries.map((a) => [a.day, a.streak])}
              />
            </section>
            <section className="admin-card">
              <p>{o.activityPages}</p>
              <Pages
                view={{
                  page,
                  hasMore: [v.ledger, v.runs, v.attempts, v.checkins].some((p) => p.hasMore),
                }}
                change={setPage}
              />
            </section>
          </>
        )
      )}
    </>
  );
}
export function FlagOperations(props: Props) {
  const [filters, setFilters] = useState({ state: "open", page: 1 }),
    [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(() => client.flags(filters.state, filters.page), [filters]);
  const { value, loading } = useView(load, props.revision, props.onError);
  return (
    <>
      <p className="admin-intro">{o.flagsIntro}</p>
      <section className="admin-card">
        <label>
          {c.status}
          <select
            value={filters.state}
            onChange={(e) => {
              setFilters({ state: e.target.value, page: 1 });
              setSelected(null);
            }}
          >
            {Object.entries(o.flagStates).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>
      {selected ? (
        <FlagRecord key={selected} id={selected} close={() => setSelected(null)} {...props} />
      ) : (
        <section className="admin-card">
          <h2>{c.flags}</h2>
          {loading ? (
            <p role="status">{c.loading}</p>
          ) : (
            value && (
              <>
                <Records
                  headers={[o.player, o.note, c.timestamp, c.actions]}
                  rows={value.entries.map((f) => [
                    f.displayName,
                    f.note,
                    utc(f.createdAt),
                    <button className="admin-text-button" onClick={() => setSelected(f.id)}>
                      {o.openRecord}
                    </button>,
                  ])}
                />
                <Pages view={value} change={(page) => setFilters({ ...filters, page })} />
              </>
            )
          )}
        </section>
      )}
    </>
  );
}
function FlagRecord({ id, close, ...props }: Props & { id: string; close: () => void }) {
  const [page, setPage] = useState(1),
    [note, setNote] = useState(""),
    [action, setAction] = useState("clear"),
    [reason, setReason] = useState(""),
    [amount, setAmount] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const load = useCallback(() => client.flag(id, page), [id, page]);
  const { value, loading } = useView(load, props.revision, props.onError);
  return (
    <>
      <button className="admin-text-button" onClick={close}>
        ← {o.back}
      </button>
      {loading ? (
        <p role="status">{c.loading}</p>
      ) : (
        value && (
          <>
            <section className="admin-card">
              <h2>{o.flagId}</h2>
              <p className="admin-mono">{id}</p>
              <p>{o.flagStates[value.flag.state]}</p>
              <p>{value.flag.note}</p>
              <p className="admin-mono">{value.flag.userId}</p>
              <h3>{o.notes}</h3>
              <Records
                headers={[c.timestamp, c.actor, o.note]}
                rows={value.notes.entries.map((n) => [
                  utc(n.createdAt),
                  <span className="admin-mono">{n.actorId}</span>,
                  n.note,
                ])}
              />
              <Pages view={value.notes} change={setPage} />
              {props.session.permissions.includes("flags:write") && (
                <form
                  className="admin-operation-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void props.write(async () => {
                      await client.note(props.session.csrf, id, note);
                      setNote("");
                    });
                  }}
                >
                  <label>
                    {o.note}
                    <textarea
                      required
                      maxLength={2000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  <button className="admin-button" disabled={props.busy}>
                    {o.addNote}
                  </button>
                </form>
              )}
            </section>
            {props.session.permissions.includes("flags:resolve") && value.flag.state === "open" && (
              <section className="admin-card">
                <h2>{o.resolve}</h2>
                <form
                  className="admin-operation-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (window.confirm(o.resolveConfirm))
                      void props.write(async () => {
                        await client.resolve(props.session.csrf, id, {
                          action,
                          reason,
                          ...(action === "adjust" ? { amount: Number(amount), requestId } : {}),
                        });
                        setRequestId(crypto.randomUUID());
                      });
                  }}
                >
                  <label>
                    {o.resolution}
                    <select value={action} onChange={(e) => setAction(e.target.value)}>
                      {[
                        ["clear", o.clear],
                        ["suspend", o.suspend],
                        ["ban", o.ban],
                        ["adjust", o.adjust],
                      ].map(([key, label]) => (
                        <option value={key} key={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {action === "adjust" && (
                    <label>
                      {o.amount}
                      <input
                        type="number"
                        required
                        step={1}
                        min={-2147483648}
                        max={2147483647}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </label>
                  )}
                  <label>
                    {o.reason}
                    <textarea
                      required
                      maxLength={2000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button
                    className="admin-button danger"
                    disabled={props.busy || (action === "adjust" && !Number(amount))}
                  >
                    {o.resolve}
                  </button>
                </form>
              </section>
            )}
          </>
        )
      )}
    </>
  );
}
