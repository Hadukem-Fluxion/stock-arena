import type { PlatformAdapter } from "../platform/types.js";
/** Rendering-only camera. Physics and the circular hitbox are device-independent. */
export function flyerViewport(width: number, height: number) {
  const scale = height / 504,
    worldWidth = 360 * scale;
  return {
    width: worldWidth,
    height,
    left: worldWidth <= width ? (width - worldWidth) / 2 : width * 0.22 - 78 * scale,
  };
}
export function lockFlyerScroll() {
  const body = document.body,
    root = document.documentElement;
  const old = [
    body.style.overflow,
    body.style.overscrollBehavior,
    root.style.overscrollBehavior,
  ] as const;
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
  root.style.overscrollBehavior = "none";
  return () => {
    [body.style.overflow, body.style.overscrollBehavior, root.style.overscrollBehavior] = old;
  };
}
export function enterFlyerHost(platform: PlatformAdapter) {
  return platform.enterGameMode?.() ?? (() => {});
}
