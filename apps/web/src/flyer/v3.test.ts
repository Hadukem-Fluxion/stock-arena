import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { flyerViewport, lockFlyerScroll } from "./play-mode.js";
import { bindFlapInput } from "./input.js";
import { FlyerChart } from "./Charts.js";
import { syntheticV3Course } from "../../../../packages/game-core/src/testing/flyer-v3-fixture.js";
it.each([
  [390, 844],
  [360, 640],
  [1440, 900],
])("fills %ix%i by height without changing the canonical world", (w, h) => {
  const fit = flyerViewport(w, h);
  expect(fit.height).toBe(h);
  expect(fit.width / fit.height).toBeCloseTo(360 / 504);
  const birdX = fit.left + (78 * h) / 504;
  expect(birdX).toBeGreaterThan(0);
  expect(birdX).toBeLessThan(w);
  if (fit.width <= w) expect(fit.left).toBe((w - fit.width) / 2);
});
it("restores previous body/root scroll styles", () => {
  const doc = {
    body: { style: { overflow: "auto", overscrollBehavior: "contain" } },
    documentElement: { style: { overscrollBehavior: "auto" } },
  };
  vi.stubGlobal("document", doc);
  const restore = lockFlyerScroll();
  expect(doc.body.style.overflow).toBe("hidden");
  restore();
  expect(doc.body.style.overflow).toBe("auto");
  expect(doc.documentElement.style.overscrollBehavior).toBe("auto");
  vi.unstubAllGlobals();
});
function event(type: string, props: Record<string, unknown>) {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
  return e;
}
it("maps a tap or Space to a single flap; release/repeat/secondary pointer do not flap", () => {
  const canvas = Object.assign(new EventTarget(), { focus: vi.fn() }),
    flap = vi.fn(),
    clean = bindFlapInput(canvas as unknown as HTMLCanvasElement, flap);
  canvas.dispatchEvent(event("pointerdown", { isPrimary: true, button: 0 }));
  canvas.dispatchEvent(event("pointerup", {}));
  canvas.dispatchEvent(event("keydown", { code: "Space", repeat: false }));
  canvas.dispatchEvent(event("keydown", { code: "Space", repeat: true }));
  canvas.dispatchEvent(event("pointerdown", { isPrimary: false, button: 0 }));
  expect(flap).toHaveBeenCalledTimes(2);
  clean();
  canvas.dispatchEvent(event("keydown", { code: "Space" }));
  expect(flap).toHaveBeenCalledTimes(2);
});
it("renders accessible frozen charts, both directional cues, and explicit missing-history copy", () => {
  const segment = syntheticV3Course().segments[0]!;
  const chart = renderToStaticMarkup(createElement(FlyerChart, { segment, discord: false }));
  expect(chart).toContain("price chart");
  expect(chart).toContain("polyline");
  expect(chart).toMatch(/▲|▼|•/);
  const missing = renderToStaticMarkup(
    createElement(FlyerChart, { segment: { ...segment, chart: undefined }, discord: false }),
  );
  expect(missing).toContain("Price chart unavailable");
  expect(missing).not.toContain("polyline");
});
