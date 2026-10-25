import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { en } from "../copy/en.js";
import { AdminClientError } from "./client.js";
import type { AdminSession } from "./client.js";
const instant = z.string().datetime({ offset: true });
const viewSchema = z.object({
  entries: z.array(
    z.object({
      inviterId: z.string().uuid(),
      inviteeId: z.string().uuid(),
      inviterName: z.string(),
      inviteeName: z.string(),
      code: z.string(),
      platform: z.enum(["discord", "telegram"]).nullable(),
      status: z.enum(["pending", "rewarded", "void"]),
      createdAt: instant,
      qualifiedAt: instant.nullable(),
    }),
  ),
  page: z.number().int(),
  hasMore: z.boolean(),
});
type View = z.infer<typeof viewSchema>;
async function request(path: string, csrf?: string, body?: object) {
  const response = await fetch(`/api/admin/referrals${path}`, {
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
export function ReferralOperations(props: {
  session: AdminSession;
  revision: number;
  busy: boolean;
  write: (fn: () => Promise<unknown>) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const { revision, onError } = props;
  const c = en.admin,
    r = c.referralOps;
  const [filters, setFilters] = useState({ inviter: "", invitee: "", status: "", page: 1 });
  const [draft, setDraft] = useState(filters),
    [view, setView] = useState<View | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: String(filters.page) });
    for (const key of ["inviter", "invitee", "status"] as const)
      if (filters[key]) query.set(key, filters[key]);
    return viewSchema.parse(await request(`?${query}`));
  }, [filters]);
  useEffect(() => {
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
  }, [load, revision, onError]);
  return (
    <>
      <p className="admin-intro">{r.intro}</p>
      <form
        className="admin-card admin-filter-form"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...draft, page: 1 });
        }}
      >
        {(["inviter", "invitee"] as const).map((key) => (
          <label key={key}>
            {r[key]}
            <input
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              maxLength={36}
            />
          </label>
        ))}
        <label>
          {r.status}
          <select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            <option value="">{r.all}</option>
            {(["pending", "rewarded", "void"] as const).map((s) => (
              <option value={s} key={s}>
                {r[s]}
              </option>
            ))}
          </select>
        </label>
        <button className="admin-button">{c.apply}</button>
      </form>
      {!view ? (
        <p role="status">{c.loading}</p>
      ) : (
        <>
          <div className="admin-controls-grid">
            {!view.entries.length && <p>{c.noEntries}</p>}
            {view.entries.map((row) => (
              <section className="admin-card" key={row.inviteeId}>
                <h2>
                  {row.inviterName} → {row.inviteeName}
                </h2>
                <span className="admin-pill">{r[row.status]}</span>
                <dl>
                  <dt>{r.inviter}</dt>
                  <dd className="admin-mono">{row.inviterId}</dd>
                  <dt>{r.invitee}</dt>
                  <dd className="admin-mono">{row.inviteeId}</dd>
                  <dt>{r.registered}</dt>
                  <dd>{row.createdAt}</dd>
                  <dt>{r.qualified}</dt>
                  <dd>{row.qualifiedAt ?? c.none}</dd>
                  <dt>{r.code}</dt>
                  <dd>{row.code}</dd>
                </dl>
                {props.session.permissions.includes("referrals:write") && row.status !== "void" && (
                  <form
                    className="admin-operation-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (window.confirm(r.confirm))
                        void props.write(() =>
                          request("/void", props.session.csrf, {
                            inviteeId: row.inviteeId,
                            reason: notes[row.inviteeId] ?? "",
                          }),
                        );
                    }}
                  >
                    <label>
                      {c.ops.reason}
                      <textarea
                        aria-label={`${c.ops.reason}: ${row.inviteeName}`}
                        value={notes[row.inviteeId] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [row.inviteeId]: e.target.value })}
                        required
                        maxLength={2000}
                      />
                    </label>
                    <button className="admin-button danger" disabled={props.busy}>
                      {r.voidAction}
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
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
            >
              {c.previous}
            </button>
            <span>{c.page(view.page)}</span>
            <button
              className="admin-button"
              disabled={!view.hasMore}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
            >
              {c.next}
            </button>
          </div>
        </>
      )}
    </>
  );
}
