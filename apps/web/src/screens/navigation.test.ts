import { describe, expect, it, vi } from "vitest";
import { readScreen, screenHash, SCREENS } from "./navigation.js";
import { createTelegramAdapter } from "../platform/telegram.js";
describe("T33 internal screens", () => {
  it("preserves Telegram launch data and rejects unknown screens", () => {
    const hash = screenHash("#tgWebAppData=synthetic%2Blaunch&other=kept", "quiz");
    expect(new URLSearchParams(hash.slice(1)).get("tgWebAppData")).toBe("synthetic+launch");
    for (const screen of SCREENS) expect(readScreen(screenHash(hash, screen))).toBe(screen);
    expect(readScreen("#screen=unknown")).toBe("home");
  });
  it("shows native Telegram BackButton only for games and removes exact listeners", async () => {
    const button = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() };
    const adapter = createTelegramAdapter(
      async () => ({
        initData: "synthetic",
        colorScheme: "dark",
        themeParams: {},
        ready() {},
        expand() {},
        openLink() {},
        onEvent() {},
        setHeaderColor() {},
        setBackgroundColor() {},
        BackButton: button,
      }),
      undefined,
      () => {},
    );
    await adapter.init();
    const handler = vi.fn(),
      cleanup = adapter.setBackButton!(handler);
    expect(button.onClick).toHaveBeenCalledWith(handler);
    expect(button.show).toHaveBeenCalledOnce();
    cleanup();
    expect(button.offClick).toHaveBeenCalledWith(handler);
    expect(button.hide).toHaveBeenCalledOnce();
    adapter.setBackButton!(null)();
    expect(button.onClick).toHaveBeenCalledTimes(1);
  });
});
