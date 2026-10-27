/** Synthetic courses only; no real sessions, prices or credentials. */
import { syntheticDaylightCourse } from "./daylight-fixture.js";
import { flyerV3Course } from "../flyer-v3.js";
import { initialFlyer, flyerPipe, stepFlyer } from "../flyer.js";
import type { FlyerCourse, FlyerInput } from "../flyer.js";
export function syntheticV3Course(count = 3) {
  const old = syntheticDaylightCourse(count);
  return flyerV3Course(
    123,
    "2026-10-26",
    "synthetic-v3",
    old.segments.map((s, i) => ({
      ...s,
      prices: ["100", String(100 + ((i % 3) - 1) * 0.25)],
      changePct: String(((i % 3) - 1) * 0.25),
      chart: Array.from({ length: 10 }, (_, j) => String(100 + (((i % 3) - 1) * 0.25 * j) / 9)),
    })),
  );
}
export function syntheticFlaps(course: FlyerCourse, goal = 5, maxTicks = 36000) {
  let state = initialFlyer();
  const inputs: FlyerInput[] = [];
  while (!state.ended && state.tick < maxTicks) {
    const center = flyerPipe(course, state.pipes ?? 0, state.distance).center;
    const flap =
      state.tick === 0 ||
      ((state.pipes ?? 0) < goal &&
        state.velocity > 0 &&
        state.y + state.velocity * 3 > center + 10000);
    const input = flap ? { tick: state.tick, action: "flap" as const } : undefined;
    if (input) inputs.push(input);
    state = stepFlyer(course, state, input);
  }
  return { inputs, ticks: state.tick, score: state.score, state };
}
