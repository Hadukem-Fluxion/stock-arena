import { describe, expect, it, vi } from "vitest";
import { createLoginClient } from "./api.js";
import { createBrowserAdapter } from "./browser.js";
import { createDiscordAdapter } from "./discord.js";
import type { DiscordBridge } from "./discord.js";
import { applyTelegramTheme, createTelegramAdapter } from "./telegram.js";
import type { TelegramBridge } from "./telegram.js";
import { externalUrl, waitForHost } from "./types.js";

function session(platform: "discord" | "telegram") {
  return {
    token: "test-session-token",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    user: {
      id: "79703e93-9461-49ad-ae16-4d2a5af06126",
      displayName: "Test player",
      avatarUrl: null,
      identity: { platform, platformUserId: "123456789012345678" },
    },
  };
}
function discord() {
  return {
    ready: vi.fn(async () => {}),
    commands: {
      authorize: vi.fn(async () => ({ code: "mock-oauth-code" })),
      authenticate: vi.fn(async () => ({})),
      openExternalLink: vi.fn(async () => ({})),
    },
  } satisfies DiscordBridge;
}
function telegram() {
  return {
    initData: "user=%7B%22id%22%3A123%7D&auth_date=1&hash=mock-signature",
    colorScheme: "dark",
    themeParams: { bg_color: "#123456", button_color: "#22bb88" },
    ready: vi.fn(),
    expand: vi.fn(),
    openLink: vi.fn(),
    onEvent: vi.fn(),
    setHeaderColor: vi.fn(),
    setBackgroundColor: vi.fn(),
  } satisfies TelegramBridge;
}

describe("Discord adapter", () => {
  it("stops waiting for an unresponsive host", async () => {
    vi.useFakeTimers();
    try {
      const result = expect(waitForHost(new Promise(() => {}))).rejects.toMatchObject({
        code: "HOST_UNAVAILABLE",
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
  it("orders ready, authorize, relative API exchange and SDK authentication; deduplicates login", async () => {
    const sdk = discord();
    const calls: string[] = [];
    sdk.ready.mockImplementation(async () => {
      calls.push("ready");
    });
    sdk.commands.authorize.mockImplementation(async () => {
      calls.push("authorize");
      return { code: "mock-oauth-code" };
    });
    sdk.commands.authenticate.mockImplementation(async () => {
      calls.push("authenticate");
      return {};
    });
    const request = vi.fn<typeof fetch>(async () => {
      calls.push("exchange");
      return Response.json({ session: session("discord"), access_token: "mock-access-token" });
    });
    const makeSdk = vi.fn(async () => sdk);
    const adapter = createDiscordAdapter("123456789012345678", makeSdk, createLoginClient(request));
    expect(adapter.user).toBeNull();
    const [first, second] = await Promise.all([adapter.login(), adapter.login()]);
    expect(first).toEqual(second);
    expect(calls).toEqual(["ready", "authorize", "exchange", "authenticate"]);
    expect(makeSdk).toHaveBeenCalledTimes(1);
    expect(sdk.commands.authorize).toHaveBeenCalledWith({
      client_id: "123456789012345678",
      response_type: "code",
      prompt: "none",
      scope: ["identify"],
    });
    expect(request).toHaveBeenCalledWith(
      "/api/auth/discord",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "mock-oauth-code" }),
        cache: "no-store",
      }),
    );
    expect(sdk.commands.authenticate).toHaveBeenCalledWith({ access_token: "mock-access-token" });
    expect(adapter.session?.token).toBe("test-session-token");
    expect(adapter.user).toEqual(first);
    await adapter.openExternal("https://app.fluxion.network/trade");
    expect(sdk.commands.openExternalLink).toHaveBeenCalledWith({
      url: "https://app.fluxion.network/trade",
    });
  });
  it("keeps no session if SDK authentication fails and permits a fresh retry", async () => {
    const sdk = discord();
    sdk.commands.authenticate.mockRejectedValueOnce(new Error("private provider details"));
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ session: session("discord"), access_token: "mock-access" }),
    );
    const adapter = createDiscordAdapter(
      "123456789012345678",
      async () => sdk,
      createLoginClient(request),
    );
    await expect(adapter.login()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    expect(adapter.session).toBeNull();
    await adapter.login();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("fails closed when the public client ID is absent", async () => {
    const makeSdk = vi.fn(async () => discord());
    const adapter = createDiscordAdapter("", makeSdk);
    await expect(adapter.login()).rejects.toMatchObject({ code: "CONFIGURATION_REQUIRED" });
    expect(makeSdk).not.toHaveBeenCalled();
  });
});

describe("Telegram adapter", () => {
  it("readies and expands once, sends untouched initData and opens links through the bridge", async () => {
    const app = telegram();
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ session: session("telegram") }),
    );
    const theme = vi.fn();
    const adapter = createTelegramAdapter(async () => app, createLoginClient(request), theme);
    await Promise.all([adapter.init(), adapter.init()]);
    await Promise.all([adapter.login(), adapter.login()]);
    expect(app.ready).toHaveBeenCalledTimes(1);
    expect(app.expand).toHaveBeenCalledTimes(1);
    expect(theme).toHaveBeenCalledWith(app);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "/api/auth/telegram",
      expect.objectContaining({ body: JSON.stringify({ initData: app.initData }) }),
    );
    expect(adapter.user?.identity.platform).toBe("telegram");
    await adapter.openExternal("https://xstocks.com");
    expect(app.openLink).toHaveBeenCalledWith("https://xstocks.com/");
  });
  it("never creates a user from unverified empty initData", async () => {
    const app = telegram();
    app.initData = "";
    const request = vi.fn<typeof fetch>();
    const adapter = createTelegramAdapter(async () => app, createLoginClient(request), vi.fn());
    await expect(adapter.login()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    expect(request).not.toHaveBeenCalled();
    expect(adapter.user).toBeNull();
  });
  it("applies valid dark host colors and resets them on a light theme", () => {
    const app = telegram();
    const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
    applyTelegramTheme(app, style);
    expect(style.setProperty).toHaveBeenCalledWith("--bg", "#123456");
    expect(style.setProperty).toHaveBeenCalledWith("--accent", "#22bb88");
    applyTelegramTheme({ ...app, colorScheme: "light" }, style);
    expect(style.removeProperty).toHaveBeenCalledWith("--bg");
    expect(style.removeProperty).toHaveBeenCalledWith("--accent");
  });
});

describe("API response handling", () => {
  it.each([
    [503, { error: { code: "AUTH_UNAVAILABLE" } }, "CONFIGURATION_REQUIRED"],
    [403, { error: { code: "ACCOUNT_UNAVAILABLE" } }, "ACCOUNT_UNAVAILABLE"],
    [500, { error: { code: "INTERNAL_ERROR", message: "private details" } }, "LOGIN_FAILED"],
    [200, { session: session("discord") }, "INVALID_RESPONSE"],
    [
      200,
      { session: { ...session("telegram"), expiresAt: "2000-01-01T00:00:00.000Z" } },
      "INVALID_RESPONSE",
    ],
    [200, { session: { token: "invalid" } }, "INVALID_RESPONSE"],
  ])("maps status %s to a safe error", async (status, body, code) => {
    const login = createLoginClient(
      vi.fn<typeof fetch>(async () => Response.json(body, { status })),
    );
    await expect(login("telegram", { initData: "mock" })).rejects.toMatchObject({ code });
  });
  it("handles network and malformed JSON without exposing the original error", async () => {
    const login = createLoginClient(
      vi.fn<typeof fetch>(async () => {
        throw new Error("private details");
      }),
    );
    await expect(login("telegram", { initData: "mock" })).rejects.toMatchObject({
      message: "NETWORK_ERROR",
    });
    const malformed = createLoginClient(vi.fn<typeof fetch>(async () => new Response("not json")));
    await expect(malformed("telegram", { initData: "mock" })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("local browser guard and external links", () => {
  it.each([
    [false, "localhost"],
    [false, "example.com"],
    [true, "example.com"],
  ])("blocks browser mode for dev=%s, host=%s", async (dev, host) => {
    const adapter = createBrowserAdapter(dev, host, vi.fn());
    await expect(adapter.login()).rejects.toMatchObject({ code: "BROWSER_DISABLED" });
    expect(adapter.user).toBeNull();
    expect(adapter.session).toBeNull();
  });
  it("allows a fake user on localhost in development without a session", async () => {
    const open = vi.fn();
    const adapter = createBrowserAdapter(true, "localhost", open);
    await adapter.init();
    await adapter.login();
    expect(adapter.user?.identity.platform).toBe("browser");
    expect(adapter.session).toBeNull();
    await adapter.openExternal("https://xstocks.com");
    expect(open).toHaveBeenCalledWith("https://xstocks.com/", "_blank", "noopener,noreferrer");
  });
  it.each([
    "javascript:alert(1)",
    "http://example.com",
    "https://user:pass@example.com",
    "/api/health",
  ])("rejects unsafe external target %s", (url) => {
    expect(() => externalUrl(url)).toThrow("LINK_FAILED");
  });
});
