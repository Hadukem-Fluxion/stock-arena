import { describe, expect, it, vi } from "vitest";
import { bindFlyerInput } from "./input.js";
function setup() {
  const canvas = Object.assign(new EventTarget(), { focus: vi.fn() }),
    root = new EventTarget(),
    doc = Object.assign(new EventTarget(), { hidden: false }),
    changed = vi.fn();
  const cleanup = bindFlyerInput(
    canvas as unknown as HTMLElement,
    changed,
    root as unknown as Window,
    doc as unknown as Document,
  );
  return { canvas, root, doc, changed, cleanup };
}
function event(type: string, properties: Record<string, unknown> = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(e, key, { value });
  return e;
}
describe("Flyer held controls", () => {
  it("records press/release with pointer release outside the canvas and suppresses duplicate mouse events", () => {
    const f = setup();
    f.canvas.dispatchEvent(event("pointerdown", { button: 0, isPrimary: true }));
    f.canvas.dispatchEvent(event("mousedown", { button: 0 }));
    expect(f.changed.mock.calls).toEqual([[true]]);
    f.root.dispatchEvent(event("pointerup"));
    f.root.dispatchEvent(event("mouseup"));
    expect(f.changed.mock.calls).toEqual([[true], [false]]);
    f.cleanup();
  });
  it("prevents touch long-press/context menu/selection and releases an outside touch", () => {
    const f = setup(),
      touch = event("touchstart");
    f.canvas.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);
    for (const type of ["contextmenu", "selectstart"]) {
      const e = event(type);
      f.canvas.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
    f.root.dispatchEvent(event("touchend", { touches: [] }));
    expect(f.changed.mock.calls).toEqual([[true], [false]]);
    f.cleanup();
  });
  it("ignores Space repeats and handles key release after focus leaves the canvas", () => {
    const f = setup();
    f.canvas.dispatchEvent(event("keydown", { code: "Space", repeat: false }));
    f.canvas.dispatchEvent(event("keydown", { code: "Space", repeat: true }));
    f.root.dispatchEvent(event("keyup", { code: "Space" }));
    expect(f.changed.mock.calls).toEqual([[true], [false]]);
    f.cleanup();
  });
  it("keeps rising while another input is held and releases on blur/visibility loss/cleanup", () => {
    const f = setup();
    f.canvas.dispatchEvent(event("mousedown", { button: 0 }));
    f.canvas.dispatchEvent(event("keydown", { code: "Space" }));
    f.root.dispatchEvent(event("mouseup"));
    expect(f.changed.mock.calls).toEqual([[true]]);
    f.root.dispatchEvent(event("blur"));
    expect(f.changed.mock.calls).toEqual([[true], [false]]);
    f.canvas.dispatchEvent(event("touchstart"));
    f.doc.hidden = true;
    f.doc.dispatchEvent(event("visibilitychange"));
    expect(f.changed.mock.calls.at(-1)).toEqual([false]);
    f.canvas.dispatchEvent(event("mousedown", { button: 0 }));
    f.cleanup();
    expect(f.changed.mock.calls.at(-1)).toEqual([false]);
    f.canvas.dispatchEvent(event("touchstart"));
    expect(f.changed.mock.calls.at(-1)).toEqual([false]);
  });
});
