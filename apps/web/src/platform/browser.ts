import { en } from "../copy/en.js";
import { externalUrl, PlatformError } from "./types.js";
import type { PlatformAdapter, PlatformUser } from "./types.js";

/** Both build mode and hostname must allow the local-only preview. No API login. */
export function createBrowserAdapter(
  development = import.meta.env.DEV,
  hostname = window.location.hostname,
  open: typeof window.open = window.open.bind(window),
): PlatformAdapter {
  let user: PlatformUser | null = null;
  function checkLocal() {
    if (!development || !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
      throw new PlatformError("BROWSER_DISABLED");
    }
  }
  return {
    host: "browser",
    get user() {
      return user;
    },
    session: null,
    async init() {
      checkLocal();
    },
    async login() {
      checkLocal();
      user = {
        id: "local-preview",
        displayName: en.auth.previewPlayer,
        avatarUrl: null,
        identity: { platform: "browser", platformUserId: "local-preview" },
      };
      return user;
    },
    async openExternal(url) {
      checkLocal();
      open(externalUrl(url), "_blank", "noopener,noreferrer");
    },
  };
}
