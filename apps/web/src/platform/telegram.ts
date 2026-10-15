import { createLoginClient } from "./api.js";
import { externalUrl, PlatformError } from "./types.js";
import type { PlatformAdapter, PlatformUser, Session } from "./types.js";

export interface TelegramBridge {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: {
    bg_color?: string;
    secondary_bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
  };
  ready(): void;
  expand(): void;
  openLink(url: string): void;
  onEvent(event: "themeChanged", callback: () => void): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramBridge };
  }
}

let loadingScript: Promise<TelegramBridge> | null = null;
export function loadTelegram(): Promise<TelegramBridge> {
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  return (loadingScript ??= new Promise<TelegramBridge>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(fail, 15_000);
    function fail() {
      window.clearTimeout(timer);
      script.remove();
      loadingScript = null;
      reject(new PlatformError("HOST_UNAVAILABLE"));
    }
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.Telegram?.WebApp) resolve(window.Telegram.WebApp);
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  }));
}

/** Match Telegram chrome to the brand background without changing any app tokens. */
export function applyTelegramTheme(
  app: TelegramBridge,
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> = getComputedStyle(document.documentElement),
) {
  const background = style.getPropertyValue("--bg").trim();
  app.setHeaderColor(background);
  app.setBackgroundColor(background);
}

export function createTelegramAdapter(
  load: () => Promise<TelegramBridge> = loadTelegram,
  exchange = createLoginClient(),
  theme: (app: TelegramBridge) => void = (app) => {
    const update = () => applyTelegramTheme(app);
    update();
    app.onEvent("themeChanged", update);
  },
): PlatformAdapter {
  let app: TelegramBridge | null = null;
  let initialized: Promise<void> | null = null;
  let pendingLogin: Promise<PlatformUser> | null = null;
  let session: Session | null = null;
  function init() {
    return (initialized ??= (async () => {
      app = await load();
      app.ready();
      app.expand();
      theme(app);
    })().catch(() => {
      initialized = null;
      throw new PlatformError("HOST_UNAVAILABLE");
    }));
  }
  return {
    host: "telegram",
    get user() {
      return session?.user ?? null;
    },
    get session() {
      return session;
    },
    init,
    login() {
      return (pendingLogin ??= (async () => {
        await init();
        if (!app?.initData) throw new PlatformError("LOGIN_FAILED");
        const result = await exchange("telegram", { initData: app.initData });
        session = result.session;
        return session.user;
      })().catch((error: unknown) => {
        pendingLogin = null;
        throw error instanceof PlatformError ? error : new PlatformError("LOGIN_FAILED");
      }));
    },
    async openExternal(url) {
      const target = externalUrl(url);
      if (!app) throw new PlatformError("HOST_UNAVAILABLE");
      try {
        app.openLink(target);
      } catch {
        throw new PlatformError("LINK_FAILED");
      }
    },
  };
}
