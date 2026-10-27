import { expect, it, vi } from "vitest";
import { createTelegramAdapter } from "./telegram.js";
import type { TelegramBridge } from "./telegram.js";
function bridge(): TelegramBridge {
  return {
    initData: "",
    colorScheme: "dark",
    themeParams: {},
    ready: vi.fn(),
    expand: vi.fn(),
    openLink: vi.fn(),
    onEvent: vi.fn(),
    setHeaderColor: vi.fn(),
    setBackgroundColor: vi.fn(),
    requestFullscreen: vi.fn(),
    exitFullscreen: vi.fn(),
    disableVerticalSwipes: vi.fn(),
    enableVerticalSwipes: vi.fn(),
  };
}
it("requests game fullscreen and restores the preceding swipe/fullscreen settings", async () => {
  const app = bridge(),
    adapter = createTelegramAdapter(
      async () => app,
      undefined,
      () => {},
    );
  await adapter.init();
  const restore = adapter.enterGameMode!();
  expect(app.requestFullscreen).toHaveBeenCalledOnce();
  expect(app.disableVerticalSwipes).toHaveBeenCalledOnce();
  restore();
  expect(app.enableVerticalSwipes).toHaveBeenCalledOnce();
  expect(app.exitFullscreen).toHaveBeenCalledOnce();
});
it("preserves already fullscreen/disabled swipes and tolerates unsupported methods", async () => {
  const app = bridge();
  app.isFullscreen = true;
  app.isVerticalSwipesEnabled = false;
  app.requestFullscreen = () => {
    throw new Error("Unsupported");
  };
  const adapter = createTelegramAdapter(
    async () => app,
    undefined,
    () => {},
  );
  await adapter.init();
  expect(() => adapter.enterGameMode!()()).not.toThrow();
  expect(app.enableVerticalSwipes).not.toHaveBeenCalled();
  expect(app.exitFullscreen).not.toHaveBeenCalled();
});
