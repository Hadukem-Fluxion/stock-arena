import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CheckinView } from "@stock-arena/game-core";
import type { PlatformAdapter } from "../platform/types.js";
import { CheckinError, createCheckinClient } from "./client.js";

export function useCheckin(platform: PlatformAdapter, enabled: boolean) {
  const client = useMemo(() => createCheckinClient(() => platform.session), [platform]);
  const [view, setView] = useState<CheckinView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"unavailable" | "session" | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const allowed = enabled && platform.host !== "browser";
  const run = useCallback(
    async (award = false) => {
      if (!allowed || pending.current) return;
      const id = generation.current;
      pending.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await (award ? client.award() : client.read());
        if (generation.current === id) setView(result);
      } catch (cause) {
        if (generation.current === id)
          setError(
            cause instanceof CheckinError && cause.code === "session" ? "session" : "unavailable",
          );
      } finally {
        if (generation.current === id) {
          pending.current = false;
          setBusy(false);
        }
      }
    },
    [allowed, client],
  );
  useEffect(() => {
    const lifecycleId = ++generation.current;
    pending.current = false;
    setView(null);
    setError(null);
    setBusy(false);
    void run();
    return () => {
      generation.current = lifecycleId + 1;
    };
  }, [run]);
  useEffect(() => {
    if (!allowed || !view) return;
    const serverTime = new Date(view.serverTime);
    const nextDay = Date.UTC(
      serverTime.getUTCFullYear(),
      serverTime.getUTCMonth(),
      serverTime.getUTCDate() + 1,
    );
    const timer = setTimeout(
      () => {
        void run();
      },
      Math.max(1000, nextDay - serverTime.getTime() + 100),
    );
    const visible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [allowed, run, view]);
  return { view, busy, error, award: () => run(true), reload: () => run(), allowed };
}
