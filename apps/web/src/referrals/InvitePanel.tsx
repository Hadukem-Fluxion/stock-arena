import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlatformAdapter } from "../platform/types.js";
import { en } from "../copy/en.js";
import { createReferralClient, ReferralClientError } from "./client.js";
import type { ReferralView } from "./client.js";

export function InvitePanel({
  platform,
  enabled,
}: {
  platform: PlatformAdapter;
  enabled: boolean;
}) {
  const client = useMemo(() => createReferralClient(platform), [platform]),
    c = en.referrals;
  const [view, setView] = useState<ReferralView | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [code, setCode] = useState(""),
    [notice, setNotice] = useState("");
  const allowed = enabled && !!platform.session;
  const fail = useCallback(
    (error: unknown) => {
      const key = error instanceof ReferralClientError ? error.code : "generic";
      if (key === "GAME_PAUSED") {
        setError(en.maintenance);
        return;
      }
      setError(
        Object.hasOwn(c.errors, key) ? c.errors[key as keyof typeof c.errors] : c.errors.generic,
      );
    },
    [c],
  );
  const load = useCallback(async () => {
    setView(await client.read());
  }, [client]);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    const refresh = () => {
      void client
        .read()
        .then((v) => {
          if (active) setView(v);
        })
        .catch((e) => {
          if (active) fail(e);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [allowed, client, fail]);
  async function action(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  if (!allowed) return <p className="muted">{c.preview}</p>;
  const url = platform.host === "discord" ? view?.discordUrl : view?.telegramUrl;
  return (
    <div className="invite-screen">
      <div className="invite-hero">
        <strong className="number">{c.hero}</strong>
        <p>{c.milestone}</p>
        <p className="muted">{c.welcome}</p>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!view ? (
        <>
          <p role="status">{c.loading}</p>
          <button onClick={() => void action(load)} disabled={busy}>
            {c.retry}
          </button>
        </>
      ) : (
        <>
          {view.maintenance && <p role="status">{en.maintenance}</p>}
          <label htmlFor="invite-link">{url ? c.link : c.code}</label>
          <div className="invite-link-row">
            <input
              id="invite-link"
              readOnly
              value={url ?? view.code}
              onFocus={(e) => e.target.select()}
            />
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(url ?? view.code);
                  setNotice(c.copied);
                })
              }
            >
              {c.copy}
            </button>
          </div>
          {!url && <p className="muted">{c.configuration}</p>}
          <button
            className="primary-button"
            disabled={busy || view.maintenance || !url || !platform.shareInvite}
            onClick={() =>
              void action(async () => {
                if (url) await platform.shareInvite?.(view.code, url, c.shareMessage);
              })
            }
          >
            {c.share}
          </button>
          <dl className="invite-counts">
            <div>
              <dt>{c.joined}</dt>
              <dd className="number">{view.joined}</dd>
            </div>
            <div>
              <dt>{c.points}</dt>
              <dd className="number">{view.points}</dd>
            </div>
          </dl>
          <ol className="invite-steps">
            {c.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <details>
            <summary>{c.details}</summary>
            <p className="muted">{c.cutoff}</p>
            {view.claim ? (
              <p>{c.alreadyClaimed}</p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await client.claim(code.trim());
                    await load();
                    setNotice(c.claimed);
                  });
                }}
              >
                <label htmlFor="invite-code">{c.code}</label>
                <input
                  id="invite-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  maxLength={68}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <button disabled={busy || view.maintenance}>{c.claim}</button>
              </form>
            )}
          </details>
          <details>
            <summary>{en.navigation.how}</summary>
            <p>{c.rule}</p>
            <p className="muted">{c.limit}</p>
          </details>
        </>
      )}
    </div>
  );
}
