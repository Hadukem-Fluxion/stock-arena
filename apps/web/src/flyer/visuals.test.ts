import { expect, it, vi } from "vitest";
import { NEUTRAL_ASSET_COLOR, initialFlyer } from "@stock-arena/game-core";
import type { PlatformAdapter } from "../platform/types.js";
import { buildingColor, logoCache } from "./visuals.js";
import { flyerFeedback } from "./feedback.js";
it("validates extracted colors and bounds the decoded logo LRU with a safe fallback", () => {
  expect(buildingColor("#aB1234")).toBe("#aB1234");
  for (const c of [undefined, "red", "url(secret)", "#12"])
    expect(buildingColor(c)).toBe(NEUTRAL_ASSET_COLOR);
  const make = vi.fn(() => ({ src: "", crossOrigin: "" }) as HTMLImageElement),
    cache = logoCache(true, make);
  expect(cache.get("javascript:alert(1)")).toBeNull();
  const url = "https://xstocks-metadata.backed.fi/logos/synthetic.png",
    image = cache.get(url);
  expect(image?.src).toBe("/stock-logos/logos/synthetic.png");
  expect(cache.get(url)).toBe(image);
  for (let i = 0; i < 30; i++) cache.get(`https://xstocks-metadata.backed.fi/logos/${i}.png`);
  expect(cache.size()).toBe(16);
  expect(cache.get(url)).not.toBe(image);
});
it.each(["telegram", "discord"] as const)(
  "does not create audio before a gesture; optional %s feedback cannot break play",
  (host) => {
    const haptic = vi.fn(),
      resume = vi.fn(async () => {}),
      suspend = vi.fn(async () => {}),
      close = vi.fn(async () => {}),
      create = vi.fn(
        () =>
          ({
            state: "running",
            resume,
            suspend,
            close,
            createOscillator() {
              throw Error("Audio unavailable");
            },
          }) as unknown as AudioContext,
      );
    const platform = { host, haptic } as unknown as PlatformAdapter;
    const feedback = flyerFeedback(platform, { createAudio: create, reducedMotion: () => false });
    feedback.frame(initialFlyer());
    expect(create).not.toHaveBeenCalled();
    feedback.unlock();
    expect(create).toHaveBeenCalledTimes(1);
    expect(() => feedback.frame({ ...initialFlyer(), score: 1 })).not.toThrow();
    expect(haptic).toHaveBeenCalledTimes(host === "telegram" ? 1 : 0);
    feedback.mute(true);
    expect(suspend).toHaveBeenCalled();
    feedback.mute(false);
    expect(create).toHaveBeenCalledTimes(1);
    feedback.dispose();
    expect(close).toHaveBeenCalled();
  },
);
it("suppresses vibration for reduced motion and tolerates a failing optional host API", () => {
  const haptic = vi.fn(() => {
      throw Error("Unavailable host feature");
    }),
    platform = { host: "telegram", haptic } as unknown as PlatformAdapter;
  const quiet = flyerFeedback(platform, { reducedMotion: () => true });
  quiet.frame({ ...initialFlyer(), score: 1, ended: true });
  expect(haptic).not.toHaveBeenCalled();
  const active = flyerFeedback(platform, { reducedMotion: () => false });
  expect(() => active.frame({ ...initialFlyer(), score: 1, ended: true })).not.toThrow();
});
