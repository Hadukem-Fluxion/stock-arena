import { expect, it, vi } from "vitest";
import { GAME_CONFIG } from "./config.js";
import {
  flyerAssetIndex,
  flyerMoveCenter,
  flyerPipe,
  initialFlyer,
  replayFlyer,
  stepFlyer,
} from "./flyer.js";
import { syntheticDaylightCourse } from "./testing/daylight-fixture.js";
import { syntheticFlight, syntheticFlyerCourse } from "./testing/flyer-fixture.js";

it.each([3, 30, 468])(
  "keeps a deterministic %i-stock order with no repeat before exhaustion",
  (count) => {
    const a = syntheticDaylightCourse(count),
      b = syntheticDaylightCourse(count);
    expect(a).toEqual(b);
    expect(
      new Set(Array.from({ length: count }, (_, i) => flyerPipe(a, i, 0).segment.ticker)).size,
    ).toBe(count);
    expect(flyerPipe(a, count, 0).segment.ticker).toBe(flyerPipe(a, 0, 0).segment.ticker);
    expect(flyerAssetIndex(a, 1)).toBe(1);
    expect(flyerPipe(a, 10, 0).gap).toBe(flyerPipe(syntheticFlyerCourse(), 10, 0).gap);
  },
);
it.each([3, 30])("replays v2 with %i stocks exactly while legacy v1 remains valid", (count) => {
  const course = syntheticDaylightCourse(count),
    original = JSON.stringify(course);
  const random = vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("Ambient randomness forbidden");
  });
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {
    throw new Error("Ambient time forbidden");
  });
  try {
    const flight = syntheticFlight(course, 12);
    expect(flight.score).toBeGreaterThanOrEqual(12);
    expect(replayFlyer(course, flight.inputs, flight.ticks, 36000)).toEqual(flight.state);
    expect(replayFlyer(JSON.parse(original), flight.inputs, flight.ticks, 36000)).toEqual(
      flight.state,
    );
    expect(JSON.stringify(course)).toBe(original);
    const old = syntheticFlyerCourse(),
      legacy = syntheticFlight(old, 2);
    expect(old.version).toBe("flyer-1");
    expect(replayFlyer(old, legacy.inputs, legacy.ticks, 36000)).toEqual(legacy.state);
  } finally {
    random.mockRestore();
    clock.mockRestore();
  }
});
it("holds physics during the recorded countdown, then uses the existing acceleration", () => {
  const course = syntheticDaylightCourse();
  let state = initialFlyer();
  for (let tick = 0; tick < GAME_CONFIG.flyer.countdownSeconds * 60; tick++)
    state = stepFlyer(course, state, tick === 0 ? { tick: 0, action: "press" } : undefined);
  expect(state).toMatchObject({
    y: 240000,
    velocity: 0,
    distance: 0,
    score: 0,
    held: true,
    tick: 180,
  });
  expect(stepFlyer(course, state).velocity).toBe(-140);
  expect(
    stepFlyer(syntheticFlyerCourse(), initialFlyer(), { tick: 0, action: "press" }).velocity,
  ).toBe(-140);
});
it("clamps signed changes exactly into playable gap centers", () => {
  expect(["-50", "-5", "-1", "0", "1", "5", "50"].map(flyerMoveCenter)).toEqual([
    320, 320, 256, 240, 224, 160, 160,
  ]);
  expect(flyerMoveCenter("0.000000000000000001")).toBe(240);
  for (const value of ["NaN", "Infinity", "1e4", "", "--1"])
    expect(() => flyerMoveCenter(value)).toThrow();
});
it("rejects tampered input duration, invalid transitions and unknown protocol versions", () => {
  const course = syntheticDaylightCourse(),
    flight = syntheticFlight(course, 2);
  expect(() => replayFlyer(course, flight.inputs, flight.ticks - 1, 36000)).toThrow();
  expect(() =>
    replayFlyer(course, [{ tick: 0, action: "release" }], flight.ticks, 36000),
  ).toThrow();
  expect(() =>
    replayFlyer(
      { ...course, version: "untrusted" } as unknown as typeof course,
      flight.inputs,
      flight.ticks,
      36000,
    ),
  ).toThrow();
});
