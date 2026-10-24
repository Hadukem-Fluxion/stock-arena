import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlatformAdapter } from "../platform/types.js";
import { en } from "../copy/en.js";
import { AdminClientError } from "../admin/client.js";
import { createRewardProfileClient } from "./client.js";
import type { z } from "zod";
import type { profileSchema } from "./client.js";
import "./rewards.css";
const c = en.rewards;
export function RewardProfile({ platform }: { platform: PlatformAdapter }) {
  const client = useMemo(() => createRewardProfileClient(platform), [platform]);
  const [view, setView] = useState<z.infer<typeof profileSchema> | null>(null),
    [uid, setUid] = useState(""),
    [address, setAddress] = useState(""),
    [review, setReview] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const data = await client.read();
    setView(data);
    setUid(data.bybitUid);
    setAddress(data.mantleAddress);
  }, [client]);
  useEffect(() => {
    if (!platform.session) return;
    let active = true;
    void client
      .read()
      .then((data) => {
        if (active) {
          setView(data);
          setUid(data.bybitUid);
          setAddress(data.mantleAddress);
        }
      })
      .catch(() => {
        if (active) setMessage(c.loadError);
      });
    return () => {
      active = false;
    };
  }, [client, platform]);
  async function save() {
    if (!view || !confirmed || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await client.save({
        bybitUid: uid,
        mantleAddress: address,
        changedAt: view.changedAt,
        confirmed: true,
      });
      await load();
      setReview(false);
      setConfirmed(false);
      setMessage(c.saved);
    } catch (error) {
      setMessage(
        error instanceof AdminClientError && error.code === "REWARDS_LOCKED"
          ? c.locked
          : error instanceof AdminClientError && error.code === "REQUEST_CONFLICT"
            ? c.conflict
            : c.invalid,
      );
      await load().catch(() => {});
      setReview(false);
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="reward-profile" aria-label={c.title}>
      <h3>{c.title}</h3>
      <p className="muted">{c.intro}</p>
      <p className="muted">{c.terms}</p>
      {!platform.session ? (
        <p>{c.session}</p>
      ) : !view ? (
        <p role="status">{message || c.loading}</p>
      ) : (
        <>
          {view.locked && (
            <p role="status" className="reward-notice">
              {c.locked}
            </p>
          )}
          <form
            className="reward-form"
            onSubmit={(e) => {
              e.preventDefault();
              setReview(true);
              setConfirmed(false);
              setMessage("");
            }}
          >
            <label>
              {c.uid}
              <input
                value={uid}
                inputMode="numeric"
                pattern="[0-9]{5,12}"
                maxLength={12}
                autoComplete="off"
                disabled={view.locked || busy || review}
                onChange={(e) => setUid(e.target.value)}
              />
            </label>
            <label>
              {c.address}
              <input
                value={address}
                pattern="0x[0-9a-fA-F]{40}"
                maxLength={42}
                autoComplete="off"
                spellCheck={false}
                disabled={view.locked || busy || review}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <p className="caption muted">{c.optional}</p>
            {!review && (
              <button className="primary-button" disabled={view.locked || busy}>
                {c.review}
              </button>
            )}
          </form>
          {review && (
            <div className="reward-review" role="group" aria-label={c.review}>
              <h4>{c.review}</h4>
              <dl>
                <dt>{c.uid}</dt>
                <dd>{uid || c.empty}</dd>
                <dt>{c.address}</dt>
                <dd>{address || c.empty}</dd>
              </dl>
              <label className="reward-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {c.confirm}
              </label>
              <div className="reward-actions">
                <button
                  className="primary-button"
                  disabled={!confirmed || busy}
                  onClick={() => void save()}
                >
                  {busy ? c.saving : c.save}
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setReview(false)}
                >
                  {c.cancel}
                </button>
              </div>
            </div>
          )}
          {message && <p role="status">{message}</p>}
          <h4>{c.history}</h4>
          {!view.history.length ? (
            <p className="muted">{c.noHistory}</p>
          ) : (
            <ul className="reward-history">
              {view.history.map((h) => (
                <li key={h.id}>
                  <time>
                    {new Date(h.changedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
                  </time>
                  <p>{c.actors[h.actor]}</p>
                  <p>
                    {c.uid}: {h.oldValues.bybitUid || c.empty} → {h.newValues.bybitUid || c.empty}
                  </p>
                  <p>
                    {c.address}: {h.oldValues.mantleAddress || c.empty} →{" "}
                    {h.newValues.mantleAddress || c.empty}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
