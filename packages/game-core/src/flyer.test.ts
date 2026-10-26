import { describe, expect, it } from "vitest";
import { flyerCenters, flyerCourse, initialFlyer, replayFlyer, stepFlyer } from "./flyer.js";
import type { FlyerInput } from "./flyer.js";
import { syntheticFlight, syntheticFlyerCourse } from "./testing/flyer-fixture.js";
describe("Flyer deterministic 60 Hz replay", () => {
  it.each([3, 30])(
    "replays a %i-asset course identically without mutating course/state",
    (count) => {
      const course = syntheticFlyerCourse(count),
        original = JSON.stringify(course),
        run = syntheticFlight(course, 15);
      expect(run.score).toBeGreaterThanOrEqual(15);
      expect(replayFlyer(course, run.inputs, run.ticks, 36000)).toEqual(run.state);
      expect(
        replayFlyer(JSON.parse(original), JSON.parse(JSON.stringify(run.inputs)), run.ticks, 36000),
      ).toEqual(run.state);
      expect(JSON.stringify(course)).toBe(original);
      expect(flyerCourse(123, course.segments)).toEqual(flyerCourse(123, course.segments));
    },
  );
  it("maps minimum prices to bottom, maximum to top and flat prices to the middle exactly", () => {
    expect(flyerCenters(Array.from({ length: 10 }, (_, i) => String(i + 1)))).toMatchObject([
      380, 349, 318, 287, 256, 225, 194, 163, 132, 100,
    ]);
    expect(flyerCenters(Array(10).fill("100.000000000000000001"))).toEqual(Array(10).fill(240));
    expect(() => flyerCenters(Array(9).fill("100"))).toThrow();
  });
  it("accelerates smoothly while held and falls after release, with bounded velocities", () => {
    const course = syntheticFlyerCourse();
    let state = initialFlyer();
    state = stepFlyer(course, state, { tick: 0, action: "press" });
    expect(state.velocity).toBe(-140);
    state = stepFlyer(course, state);
    expect(state.velocity).toBe(-280);
    state = stepFlyer(course, state, { tick: 2, action: "release" });
    expect(state.velocity).toBe(-160);
    for (let i = 0; i < 15; i++) state = stepFlyer(course, state);
    expect(state.velocity).toBeGreaterThan(0);
  });
  it.each(
    (
      [
        [{ tick: 0, action: "release" }],
        [
          { tick: 2, action: "press" },
          { tick: 1, action: "release" },
        ],
        [
          { tick: 1, action: "press" },
          { tick: 1, action: "release" },
        ],
        [
          { tick: 1, action: "press" },
          { tick: 2, action: "press" },
        ],
      ] as FlyerInput[][]
    ).map((inputs) => ({ inputs })),
  )("rejects invalid, overlapping or out-of-order transitions %#", ({ inputs }) => {
    expect(() => replayFlyer(syntheticFlyerCourse(), inputs, 100, 1000)).toThrow();
  });
  it("rejects premature finish, events after death and ticks beyond the session bound", () => {
    const course = syntheticFlyerCourse(),
      run = syntheticFlight(course, 0);
    expect(() => replayFlyer(course, run.inputs, run.ticks - 1, 36000)).toThrow();
    expect(() =>
      replayFlyer(course, [...run.inputs, { tick: run.ticks, action: "press" }], run.ticks, 36000),
    ).toThrow();
    expect(() => replayFlyer(course, [], 1001, 1000)).toThrow();
  });
});
