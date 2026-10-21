import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { en } from "../copy/en.js";
import { AdminClientError, createAdminClient } from "./client.js";
import type { AdminRole, AdminSession, AuditFilters, AuditView, TeamMember } from "./client.js";
import "./admin.css";

const copy = en.admin;
const client = createAdminClient();
type Screen = "overview" | "team" | "audit";
function message(error: unknown): string {
  const code = error instanceof AdminClientError ? error.code : "generic";
  return Object.hasOwn(copy.error, code)
    ? copy.error[code as keyof typeof copy.error]
    : copy.error.generic;
}
function utc(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(value))
    : copy.none;
}

export function AdminApp() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const embedded = window.self !== window.top || Boolean(window.Telegram?.WebApp?.initData);
  useEffect(() => {
    let mounted = true;
    document.title = `${copy.title} · ${en.appName}`;
    if (embedded) {
      setLoading(false);
      return;
    }
    const loginError = new URLSearchParams(window.location.search).get("error");
    if (loginError) {
      setError(loginError === "access" ? copy.accessError : copy.loginError);
      window.history.replaceState(null, "", "/admin");
    }
    void client
      .session()
      .then((result) => {
        if (mounted) setSession(result);
      })
      .catch((failure: unknown) => {
        if (mounted && !(failure instanceof AdminClientError && failure.code === "UNAUTHORIZED"))
          setError(message(failure));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [embedded]);
  async function write(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      try {
        setSession(await client.session());
        setRevision((value) => value + 1);
        setNotice(copy.saved);
      } catch {
        setSession(null);
        setNotice(copy.expired);
      }
    } catch (failure) {
      if (failure instanceof AdminClientError && failure.code === "UNAUTHORIZED") {
        setSession(null);
        setNotice(copy.expired);
      } else setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  const navigation = [
    "overview",
    ...(session?.permissions.includes("team:read") ? ["team"] : []),
    "audit",
  ] as Screen[];
  return (
    <div className="admin-root">
      <a className="admin-skip" href="#admin-content">
        {en.labels.skipToContent}
      </a>
      {!session ? (
        <main className="admin-login" id="admin-content">
          <a className="admin-brand" href="/">
            <img src="/brand/mantle-mark-dark.svg" alt={en.footer.mantle} />
            {en.appName}
          </a>
          <div className="admin-login-card">
            <span className="admin-eyebrow">{copy.title}</span>
            <h1>{copy.loginTitle}</h1>
            <p>{embedded ? copy.browserOnly : copy.loginBody}</p>
            {loading ? (
              <p role="status">{copy.loading}</p>
            ) : (
              !embedded && (
                <a className="admin-button" href="/api/admin/auth/discord">
                  {copy.login}
                  <span aria-hidden="true">↗</span>
                </a>
              )
            )}
            {error && (
              <p className="admin-error" role="alert">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            <a className="admin-subtle-link" href="/">
              {copy.backToGame}
            </a>
          </div>
          <p className="admin-login-foot">
            {copy.protected} · {copy.loginProvider}
          </p>
        </main>
      ) : (
        <>
          <aside className="admin-sidebar">
            <a className="admin-brand" href="/">
              <img src="/brand/mantle-mark-dark.svg" alt={en.footer.mantle} />
              <span>
                {en.appName}
                <small>{copy.title}</small>
              </span>
            </a>
            <p className="admin-eyebrow">{copy.workspace}</p>
            <nav aria-label={copy.title}>
              {navigation.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-current={screen === name ? "page" : undefined}
                  onClick={() => {
                    setScreen(name);
                    setError("");
                    setNotice("");
                  }}
                >
                  <span aria-hidden="true">
                    {name === "overview" ? "◈" : name === "team" ? "◎" : "≡"}
                  </span>
                  {copy[name]}
                </button>
              ))}
            </nav>
            <div className="admin-sidebar-foot">
              <span className="admin-role">{copy.roles[session.user.role]}</span>
              <strong>{session.user.displayName}</strong>
              <button
                className="admin-text-button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void client
                    .logout(session.csrf)
                    .then(() => {
                      setSession(null);
                      setNotice("");
                      setError("");
                    })
                    .catch((failure: unknown) => setError(message(failure)))
                    .finally(() => setBusy(false));
                }}
              >
                {copy.logout}
              </button>
            </div>
          </aside>
          <main className="admin-main" id="admin-content">
            <header className="admin-page-header">
              <div>
                <p className="admin-eyebrow">{copy.eyebrow}</p>
                <h1>{copy[screen]}</h1>
              </div>
              <span className="admin-status">
                <i />
                {copy.protected}
              </span>
            </header>
            {session.legacy && (
              <p className="admin-warning" role="status">
                {copy.legacy}
              </p>
            )}
            {error && (
              <p className="admin-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="admin-notice" role="status">
                {notice}
              </p>
            )}
            {screen === "overview" && (
              <>
                <section className="admin-hero">
                  <span className="admin-eyebrow">
                    {copy.welcome}, {session.user.displayName}
                  </span>
                  <h2>{copy.subtitle}</h2>
                  <p>{copy.overviewBody}</p>
                  <a
                    href="https://github.com/Hadukem-Fluxion/stock-arena/blob/main/docs/ADMIN_GUIDE.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {copy.guide} ↗
                  </a>
                </section>
                <div className="admin-summary">
                  <section className="admin-card">
                    <p className="admin-eyebrow">{copy.available}</p>
                    <h2>{copy.protected}</h2>
                    <p>{copy.protection}</p>
                    <dl>
                      <dt>{copy.role}</dt>
                      <dd>{copy.roles[session.user.role]}</dd>
                      <dt>{copy.sessionLabel}</dt>
                      <dd>{utc(session.expiresAt)}</dd>
                    </dl>
                  </section>
                  <section className="admin-card">
                    <p className="admin-eyebrow">{copy.role}</p>
                    <h2>{copy.roles[session.user.role]}</h2>
                    <p>{copy.roleDescriptions[session.user.role]}</p>
                    <div className="admin-quick-links">
                      {navigation
                        .filter((name) => name !== "overview")
                        .map((name) => (
                          <button
                            key={name}
                            className="admin-button secondary"
                            onClick={() => setScreen(name)}
                          >
                            {copy[name]} ↗
                          </button>
                        ))}
                    </div>
                  </section>
                </div>
                <h2 className="admin-section-title">{copy.planned}</h2>
                <div className="admin-planned">
                  {(
                    [
                      [copy.operations, copy.operationsBody],
                      [copy.controls, copy.controlsBody],
                      [copy.rewards, copy.rewardsBody],
                    ] as const
                  ).map(([title, body]) => (
                    <section className="admin-card" key={title}>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </section>
                  ))}
                </div>
              </>
            )}
            {screen === "team" && (
              <Team
                session={session}
                busy={busy}
                revision={revision}
                write={write}
                onError={setError}
              />
            )}
            {screen === "audit" && <Audit onError={setError} />}
          </main>
        </>
      )}
    </div>
  );
}

type TeamProps = {
  session: AdminSession;
  busy: boolean;
  revision: number;
  write: (action: () => Promise<unknown>) => Promise<void>;
  onError: (value: string) => void;
};
function Team({ session, busy, revision, write, onError }: TeamProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [discordId, setDiscordId] = useState("");
  const [role, setRole] = useState<AdminRole>("support");
  const [target, setTarget] = useState<TeamMember | null>(null);
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    let mounted = true;
    void client
      .team()
      .then((value) => {
        if (mounted) setMembers(value.members);
      })
      .catch((failure: unknown) => {
        if (mounted) onError(message(failure));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [revision, onError]);
  function add(event: FormEvent) {
    event.preventDefault();
    void write(async () => {
      await client.grant(session.csrf, { discordId, role });
      setDiscordId("");
    });
  }
  return (
    <>
      <p className="admin-intro">{copy.teamIntro}</p>
      <section className="admin-card">
        <h2>{copy.addMember}</h2>
        <form className="admin-add-form" onSubmit={add}>
          <label>
            {copy.discordId}
            <input
              required
              value={discordId}
              onChange={(event) => setDiscordId(event.target.value)}
              inputMode="numeric"
              pattern="[0-9]{1,20}"
              autoComplete="off"
            />
          </label>
          <label>
            {copy.role}
            <select value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>
              {(["admin", "moderator", "support"] as const).map((value) => (
                <option value={value} key={value}>
                  {copy.roles[value]}
                </option>
              ))}
            </select>
          </label>
          <button className="admin-button" disabled={busy}>
            {copy.addMember} <span aria-hidden="true">+</span>
          </button>
        </form>
        <p className="admin-small">{copy.roleDescriptions[role]}</p>
      </section>
      <section className="admin-card admin-table-card">
        <h2>{copy.team}</h2>
        {loading ? (
          <p role="status">{copy.loading}</p>
        ) : (
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.member}</th>
                  <th>{copy.role}</th>
                  <th>{copy.granted}</th>
                  <th>{copy.status}</th>
                  <th>{copy.actions}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <MemberRow
                    key={`${member.userId}:${member.role}:${member.revokedAt}`}
                    member={member}
                    session={session}
                    busy={busy}
                    write={write}
                    onTransfer={() => {
                      setTarget(member);
                      setConfirmation("");
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {target && (
        <section className="admin-card admin-danger-zone" aria-labelledby="transfer-title">
          <h2 id="transfer-title">{copy.transferTitle}</h2>
          <p>{copy.transferBody}</p>
          <strong>{target.displayName}</strong>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void write(() => client.transfer(session.csrf, target.userId, confirmation));
            }}
          >
            <label>
              {copy.confirmation}
              <input
                required
                value={confirmation}
                autoComplete="off"
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <div className="admin-actions">
              <button
                className="admin-button danger"
                disabled={busy || confirmation !== target.displayName}
              >
                {copy.transfer}
              </button>
              <button
                type="button"
                className="admin-button secondary"
                onClick={() => setTarget(null)}
              >
                {copy.cancel}
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="admin-role-guide">
        {Object.entries(copy.roles).map(([key, label]) => (
          <div key={key}>
            <strong>{label}</strong>
            <p>{copy.roleDescriptions[key as AdminRole]}</p>
          </div>
        ))}
      </section>
    </>
  );
}
function MemberRow({
  member,
  session,
  busy,
  write,
  onTransfer,
}: {
  member: TeamMember;
  session: AdminSession;
  busy: boolean;
  write: TeamProps["write"];
  onTransfer: () => void;
}) {
  const [role, setRole] = useState(member.role);
  const [confirmation, setConfirmation] = useState("");
  return (
    <tr>
      <td data-label={copy.member}>
        <strong>{member.displayName}</strong>
        {member.userId === session.user.id && <span className="admin-you">{copy.you}</span>}
        <small className="admin-mono">{member.discordId}</small>
      </td>
      <td data-label={copy.role}>
        <select
          aria-label={`${copy.role}: ${member.displayName}`}
          value={role}
          onChange={(event) => setRole(event.target.value as AdminRole)}
        >
          {Object.entries(copy.roles).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {role === "owner" && (role !== member.role || member.revokedAt) && (
          <label className="admin-confirm-name">
            {copy.confirmation}
            <input
              value={confirmation}
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        )}
      </td>
      <td data-label={copy.granted} className="admin-mono">
        {utc(member.grantedAt)}
      </td>
      <td data-label={copy.status}>
        <span className={`admin-pill ${member.revokedAt ? "inactive" : ""}`}>
          {member.revokedAt ? copy.revoked : copy.active}
        </span>
      </td>
      <td data-label={copy.actions}>
        <div className="admin-row-actions">
          <button
            className="admin-text-button"
            disabled={busy || (!member.revokedAt && role === member.role)}
            onClick={() =>
              void write(() =>
                client.grant(session.csrf, {
                  discordId: member.discordId,
                  role,
                  ...(role === "owner" ? { confirmation } : {}),
                }),
              )
            }
          >
            {copy.save}
          </button>
          {!member.revokedAt && (
            <>
              <button
                className="admin-text-button danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(copy.revokeConfirmation))
                    void write(() => client.revoke(session.csrf, member.userId));
                }}
              >
                {copy.revoke}
              </button>
              {member.userId !== session.user.id && (
                <button className="admin-text-button" disabled={busy} onClick={onTransfer}>
                  {copy.transfer}
                </button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function Audit({ onError }: { onError: (value: string) => void }) {
  const [filters, setFilters] = useState<AuditFilters>({});
  const [draft, setDraft] = useState({ actor: "", action: "", from: "", to: "" });
  const [view, setView] = useState<AuditView | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void client
      .audit(filters)
      .then((value) => {
        if (mounted) setView(value);
      })
      .catch((failure: unknown) => {
        if (mounted) onError(message(failure));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [filters, onError]);
  return (
    <>
      <p className="admin-intro">{copy.auditIntro}</p>
      <section className="admin-card">
        <form
          className="admin-filter-form"
          onSubmit={(event) => {
            event.preventDefault();
            setFilters({ ...draft, page: 1 });
          }}
        >
          <label>
            {copy.actor}
            <input
              value={draft.actor}
              onChange={(event) => setDraft({ ...draft, actor: event.target.value })}
              autoComplete="off"
            />
          </label>
          <label>
            {copy.action}
            <input
              list="admin-audit-actions"
              value={draft.action}
              onChange={(event) => setDraft({ ...draft, action: event.target.value })}
              autoComplete="off"
            />
            <datalist id="admin-audit-actions">
              {Object.keys(copy.auditActions).map((action) => (
                <option value={action} key={action} />
              ))}
            </datalist>
          </label>
          <label>
            {copy.from}
            <input
              type="date"
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </label>
          <label>
            {copy.to}
            <input
              type="date"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </label>
          <div className="admin-actions">
            <button className="admin-button" disabled={loading}>
              {copy.apply}
            </button>
            <button
              type="button"
              className="admin-text-button"
              onClick={() => {
                setDraft({ actor: "", action: "", from: "", to: "" });
                setFilters({});
              }}
            >
              {copy.reset}
            </button>
          </div>
        </form>
      </section>
      <section className="admin-card admin-table-card">
        <h2>{copy.audit}</h2>
        {loading ? (
          <p role="status">{copy.loading}</p>
        ) : !view?.entries.length ? (
          <p>{copy.noEntries}</p>
        ) : (
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.timestamp}</th>
                  <th>{copy.performedBy}</th>
                  <th>{copy.action}</th>
                  <th>{copy.target}</th>
                  <th>{copy.details}</th>
                </tr>
              </thead>
              <tbody>
                {view.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label={copy.timestamp} className="admin-mono">
                      {utc(entry.createdAt)}
                    </td>
                    <td data-label={copy.performedBy}>
                      <strong>{entry.actorName}</strong>
                      <small className="admin-mono">{entry.actorId}</small>
                    </td>
                    <td data-label={copy.action}>
                      {Object.hasOwn(copy.auditActions, entry.action)
                        ? copy.auditActions[entry.action as keyof typeof copy.auditActions]
                        : entry.action}
                    </td>
                    <td data-label={copy.target}>
                      <small className="admin-mono">{entry.targetId ?? copy.none}</small>
                    </td>
                    <td data-label={copy.details}>
                      <code>{JSON.stringify(entry.details)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view && (
          <div className="admin-pagination">
            <button
              className="admin-button secondary"
              disabled={loading || view.page <= 1}
              onClick={() => setFilters({ ...filters, page: view.page - 1 })}
            >
              {copy.previous}
            </button>
            <span>{copy.page(view.page)}</span>
            <button
              className="admin-button secondary"
              disabled={loading || !view.hasMore}
              onClick={() => setFilters({ ...filters, page: view.page + 1 })}
            >
              {copy.next}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
