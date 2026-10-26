import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { en } from "../copy/en.js";
import { AdminClientError } from "./client.js";
import type { AdminSession } from "./client.js";
const instant = z.string().datetime({ offset: true });
const schema = z.object({
  entries: z.array(
    z.object({
      id: z.string().uuid(),
      userId: z.string().uuid(),
      startedAt: instant,
      finishedAt: instant.nullable(),
      state: z.enum(["active", "finished", "cancelled", "expired", "void"]),
      score: z.number().int().nullable(),
      day: z.string().nullable(),
      ticks: z.number().int().nullable(),
    }),
  ),
  page: z.number().int(),
  hasMore: z.boolean(),
});
type View = z.infer<typeof schema>;
async function request(path: string, csrf?: string, body?: object) {
  const response = await fetch(`/api/admin/flyer${path}`, {
    method: csrf ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: csrf
      ? { "Content-Type": "application/json", "X-Admin-CSRF": csrf }
      : { Accept: "application/json" },
    ...(csrf ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const raw: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(raw);
    throw new AdminClientError(error.success ? error.data.error.code : "INVALID_RESPONSE");
  }
  return raw;
}
export function FlyerOperations({
  session,
  revision,
  busy,
  write,
  onError,
}: {
  session: AdminSession;
  revision: number;
  busy: boolean;
  write: (fn: () => Promise<unknown>) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const c = en.admin,
    f = c.flyerOps;
  const [draft, setDraft] = useState(""),
    [filter, setFilter] = useState({ userId: "", page: 1 }),
    [view, setView] = useState<View | null>(null),
    [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(
    async () =>
      schema.parse(
        await request(
          `?${new URLSearchParams({ userId: filter.userId, page: String(filter.page) })}`,
        ),
      ),
    [filter],
  );
  useEffect(() => {
    if (!filter.userId) return;
    let active = true;
    setView(null);
    void load()
      .then((v) => {
        if (active) setView(v);
      })
      .catch((e) => {
        if (active) onError(e);
      });
    return () => {
      active = false;
    };
  }, [filter.userId, load, revision, onError]);
  return (
    <>
      <p className="admin-intro">{f.intro}</p>
      <form
        className="admin-card admin-filter-form"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ userId: draft.trim(), page: 1 });
        }}
      >
        <label>
          {f.userId}
          <input required maxLength={36} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button className="admin-button">{f.find}</button>
      </form>
      {filter.userId && !view && <p role="status">{c.loading}</p>}
      {view && (
        <>
          <div className="admin-controls-grid">
            {!view.entries.length && <p>{c.noEntries}</p>}
            {view.entries.map((s) => (
              <section className="admin-card" key={s.id}>
                <h2>{s.id}</h2>
                <span className="admin-pill">{f.states[s.state]}</span>
                <dl>
                  <dt>{f.score}</dt>
                  <dd>{s.score ?? c.none}</dd>
                  <dt>{f.started}</dt>
                  <dd>{s.startedAt}</dd>
                  <dt>{f.finished}</dt>
                  <dd>{s.finishedAt ?? c.none}</dd>
                </dl>
                {session.permissions.includes("points:write") && s.state !== "void" && (
                  <form
                    className="admin-operation-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (confirm(f.confirm))
                        void write(() =>
                          request("/void", session.csrf, { id: s.id, reason: notes[s.id] ?? "" }),
                        );
                    }}
                  >
                    <label>
                      {c.ops.reason}
                      <textarea
                        required
                        maxLength={2000}
                        value={notes[s.id] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })}
                      />
                    </label>
                    <button className="admin-button danger" disabled={busy}>
                      {f.voidAction}
                    </button>
                  </form>
                )}
              </section>
            ))}
          </div>
          <div className="admin-pagination">
            <button
              className="admin-button"
              disabled={view.page <= 1}
              onClick={() => setFilter({ ...filter, page: filter.page - 1 })}
            >
              {c.previous}
            </button>
            <span>{c.page(view.page)}</span>
            <button
              className="admin-button"
              disabled={!view.hasMore}
              onClick={() => setFilter({ ...filter, page: filter.page + 1 })}
            >
              {c.next}
            </button>
          </div>
        </>
      )}
    </>
  );
}
