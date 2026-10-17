import { useEffect, useState } from "react";
import type { PricesView } from "@stock-arena/game-core";
import type { PlatformAdapter } from "../platform/types.js";
import { readPrices, PriceStreamError } from "./client.js";

export function usePrices(platform: PlatformAdapter, enabled: boolean) {
  const [view, setView] = useState<PricesView | null>(null);
  const [state, setState] = useState<"connecting" | "live" | "reconnecting" | "session">(
    "connecting",
  );
  useEffect(() => {
    setView(null);
    setState("connecting");
    if (!enabled || platform.host === "browser") return;
    let active = true;
    let controller: AbortController | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let connecting = false;
    let sessionFailed = false;
    const connect = async () => {
      if (!active || connecting || sessionFailed || document.visibilityState === "hidden") return;
      const session = platform.session;
      if (!session || Date.parse(session.expiresAt) <= Date.now()) {
        setState("session");
        return;
      }
      connecting = true;
      controller = new AbortController();
      const resetWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => controller?.abort(), 35_000);
      };
      resetWatchdog();
      try {
        await readPrices(
          session,
          (next) => {
            if (active) {
              setView(next);
              setState("live");
              resetWatchdog();
            }
          },
          controller.signal,
        );
      } catch (error) {
        if (error instanceof PriceStreamError && error.code === "session") {
          sessionFailed = true;
          if (active) setState("session");
        }
      } finally {
        clearTimeout(watchdog);
        connecting = false;
        if (active && !sessionFailed) {
          setState("reconnecting");
          retry = setTimeout(() => {
            void connect();
          }, 2000);
        }
      }
    };
    void connect();
    const visible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(retry);
        void connect();
      } else {
        clearTimeout(retry);
        controller?.abort();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      controller?.abort();
      clearTimeout(retry);
      clearTimeout(watchdog);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [platform, enabled]);
  return { view, state };
}
