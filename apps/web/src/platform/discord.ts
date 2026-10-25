import { createLoginClient } from "./api.js";
import { externalUrl, PlatformError, waitForHost } from "./types.js";
import type { PlatformAdapter, PlatformUser, Session } from "./types.js";

export interface DiscordBridge {
  readonly customId?: string | null;
  ready(): Promise<void>;
  commands: {
    authorize(options: {
      client_id: string;
      response_type: "code";
      prompt: "none";
      scope: ["identify"];
    }): Promise<{ code: string | null }>;
    authenticate(options: { access_token: string }): Promise<unknown>;
    openExternalLink(options: { url: string }): Promise<unknown>;
    shareLink?(options: { message: string; custom_id: string }): Promise<{ success: boolean }>;
  };
}

async function loadSdk(clientId: string): Promise<DiscordBridge> {
  const { DiscordSDK } = await import("@discord/embedded-app-sdk");
  return new DiscordSDK(clientId);
}

export function createDiscordAdapter(
  clientId: string,
  createSdk: (id: string) => Promise<DiscordBridge> = loadSdk,
  exchange = createLoginClient(),
): PlatformAdapter {
  let sdk: DiscordBridge | null = null;
  let initialized: Promise<void> | null = null;
  let pendingLogin: Promise<PlatformUser> | null = null;
  let session: Session | null = null;
  function init() {
    return (initialized ??= (async () => {
      if (!/^\d{10,25}$/.test(clientId)) throw new PlatformError("CONFIGURATION_REQUIRED");
      sdk ??= await createSdk(clientId);
      await waitForHost(sdk.ready());
    })().catch((error: unknown) => {
      initialized = null;
      throw error instanceof PlatformError ? error : new PlatformError("HOST_UNAVAILABLE");
    }));
  }
  return {
    host: "discord",
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
        if (!sdk) throw new PlatformError("HOST_UNAVAILABLE");
        const { code } = await sdk.commands.authorize({
          client_id: clientId,
          response_type: "code",
          prompt: "none",
          scope: ["identify"],
        });
        if (!code) throw new PlatformError("LOGIN_FAILED");
        const result = await exchange("discord", {
          code,
          ...(sdk.customId ? { customId: sdk.customId } : {}),
        });
        if (!result.accessToken) throw new PlatformError("INVALID_RESPONSE");
        await sdk.commands.authenticate({ access_token: result.accessToken });
        session = result.session;
        return session.user;
      })().catch((error: unknown) => {
        pendingLogin = null;
        throw error instanceof PlatformError ? error : new PlatformError("LOGIN_FAILED");
      }));
    },
    async openExternal(url) {
      const target = externalUrl(url);
      if (!sdk) throw new PlatformError("HOST_UNAVAILABLE");
      try {
        await sdk.commands.openExternalLink({ url: target });
      } catch {
        throw new PlatformError("LINK_FAILED");
      }
    },
    async shareInvite(code, _url, message) {
      if (!sdk?.commands.shareLink) throw new PlatformError("LINK_FAILED");
      try {
        await sdk.commands.shareLink({ message, custom_id: code });
      } catch {
        throw new PlatformError("LINK_FAILED");
      }
    },
  };
}
