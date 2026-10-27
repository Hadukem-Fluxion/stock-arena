/** Capture held-state transitions, including releases outside the canvas. */
export function bindFlyerInput(
  canvas: HTMLElement,
  onChange: (held: boolean) => void,
  root: Window = window,
  doc: Document = document,
) {
  const sources = new Set<string>();
  let held = false;
  const listeners: { target: EventTarget; type: string; fn: EventListener }[] = [];
  const update = (source: string, down: boolean) => {
    if (down) sources.add(source);
    else sources.delete(source);
    const next = sources.size > 0;
    if (next !== held) {
      held = next;
      onChange(next);
    }
  };
  const prevent = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  const listen = (target: EventTarget, type: string, fn: EventListener) => {
    target.addEventListener(type, fn, { passive: false });
    listeners.push({ target, type, fn });
  };
  listen(canvas, "pointerdown", (e) => {
    const p = e as PointerEvent;
    if (p.button !== 0 || p.isPrimary === false) return;
    prevent(e);
    canvas.focus({ preventScroll: true });
    update("pointer", true);
  });
  listen(canvas, "mousedown", (e) => {
    if ((e as MouseEvent).button === 0) {
      prevent(e);
      canvas.focus({ preventScroll: true });
      update("pointer", true);
    }
  });
  listen(canvas, "touchstart", (e) => {
    prevent(e);
    update("touch", true);
  });
  for (const type of ["pointerup", "pointercancel", "mouseup"])
    listen(root, type, () => update("pointer", false));
  for (const type of ["touchend", "touchcancel"])
    listen(root, type, (e) => {
      if ((e as TouchEvent).touches?.length) return;
      update("pointer", false);
      update("touch", false);
    });
  listen(canvas, "keydown", (e) => {
    const key = e as KeyboardEvent;
    if (key.code === "Space" || key.key === " ") {
      prevent(e);
      if (!key.repeat) update("keyboard", true);
    }
  });
  listen(root, "keyup", (e) => {
    const key = e as KeyboardEvent;
    if (key.code === "Space" || key.key === " ") {
      prevent(e);
      update("keyboard", false);
    }
  });
  const release = () => {
    sources.clear();
    if (held) {
      held = false;
      onChange(false);
    }
  };
  listen(root, "blur", release);
  listen(doc, "visibilitychange", () => {
    if (doc.hidden) release();
  });
  for (const type of ["contextmenu", "selectstart"]) listen(canvas, type, prevent);
  return () => {
    for (const { target, type, fn } of listeners) target.removeEventListener(type, fn);
    release();
  };
}
/** One impulse per deliberate gesture; repeat/compatibility events never hold the bird. */
export function bindFlapInput(canvas: HTMLCanvasElement, flap: () => void) {
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    flap();
  };
  const key = (event: KeyboardEvent) => {
    if (event.code !== "Space") return;
    event.preventDefault();
    if (!event.repeat) flap();
  };
  const prevent = (event: Event) => event.preventDefault();
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("keydown", key);
  canvas.addEventListener("touchstart", prevent, { passive: false });
  canvas.addEventListener("contextmenu", prevent);
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("keydown", key);
    canvas.removeEventListener("touchstart", prevent);
    canvas.removeEventListener("contextmenu", prevent);
  };
}
