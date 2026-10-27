import { expect, it } from "vitest";
import { syntheticDaylightCourse } from "./testing/daylight-fixture.js";
import { flyerV3Course, flyerCoins, stepFlyerV3, flyerBirdAngle } from "./flyer-v3.js";
import { initialFlyer, replayFlyer, flyerPipe } from "./flyer.js";
import type { FlyerInput } from "./flyer.js";
import { GAME_CONFIG } from "./config.js";
const c = GAME_CONFIG.flyer;
function course(count = 3) {
  const old = syntheticDaylightCourse(count);
  return flyerV3Course(123, "2026-10-26", "synthetic", old.segments);
}
it.each([3, 30])(
  "replays flaps deterministically with %i assets and score = pipes + coins",
  (count) => {
    const run = course(count);
    let s = initialFlyer();
    const inputs: FlyerInput[] = [];
    while (!s.ended && s.tick < 4000) {
      const target = flyerPipe(run, s.pipes ?? 0, s.distance).center;
      const input =
        s.tick === 0 || (s.velocity > 0 && s.y + s.velocity * 8 > target)
          ? { tick: s.tick, action: "flap" as const }
          : undefined;
      if (input) inputs.push(input);
      s = stepFlyerV3(run, s, input);
    }
    expect(replayFlyer(run, inputs, s.tick, 4000)).toEqual(s);
    expect(s.score).toBe((s.pipes ?? 0) + (s.coins ?? 0));
    expect(s.pipes).toBeGreaterThan(0);
  },
);
it("keeps the world still until the first flap and permits verified retirement", () => {
  const run = course(),
    s = replayFlyer(run, [], 60, 100, true);
  expect(s.distance).toBe(0);
  expect(s.score).toBe(0);
  expect(s.started).toBe(false);
  expect(() => replayFlyer(run, [], 60, 100)).toThrow();
});
it("rejects duplicate, reversed, out-of-bounds or legacy inputs", () => {
  for (const inputs of [
    [{ tick: 0, action: "press" }],
    [
      { tick: 0, action: "flap" },
      { tick: 0, action: "flap" },
    ],
    [
      { tick: 5, action: "flap" },
      { tick: 2, action: "flap" },
    ],
    [{ tick: 60, action: "flap" }],
  ] as FlyerInput[][])
    expect(() => replayFlyer(course(), inputs, 60, 100, true)).toThrow();
});
it("places 1–3 optional coins per ten pipes deterministically outside buildings", () => {
  const run = course();
  for (let g = 0; g < 100; g++) {
    const coins = flyerCoins(run, g);
    expect(coins).toEqual(flyerCoins(run, g));
    expect(coins.length).toBeGreaterThanOrEqual(1);
    expect(coins.length).toBeLessThanOrEqual(3);
    for (const coin of coins) {
      const pipe = flyerPipe(run, coin.pipe, 0),
        next = flyerPipe(run, coin.pipe + 1, 0);
      expect(coin.x - coin.radius).toBeGreaterThan(pipe.x + c.pipeWidth * c.scale);
      expect(coin.x + coin.radius).toBeLessThan(next.x);
      expect(Math.floor(coin.pipe / 10)).toBe(g);
    }
  }
});
it("collects only by integer circle overlap, once per coin; a near miss is not a hit", () => {
  const run = course(),
    coin = flyerCoins(run, 0)[0]!,
    distance = coin.x - c.birdX * c.scale - c.v3.initialScrollSpeed;
  const state = { ...initialFlyer(), tick: 200, started: true, distance, y: coin.y - c.v3.gravity };
  const hit = stepFlyerV3(run, state);
  expect(hit.coins).toBe(1);
  expect(hit.score).toBe((hit.pipes ?? 0) + 1);
  expect(stepFlyerV3(run, hit).coins).toBe(1);
  const miss = stepFlyerV3(run, {
    ...state,
    y: state.y + (c.birdRadius + c.v3.coinRadius) * c.scale + 1,
  });
  expect(miss.coins).toBe(0);
});
it("retains the circular hitbox and caps visual tilt", () => {
  expect(c.birdRadius).toBe(12);
  expect(flyerBirdAngle(-99999)).toBe(-25);
  expect(flyerBirdAngle(99999)).toBe(70);
  expect(c.dailyPointsCap).toBe(50);
});
it("copies frozen chart samples instead of retaining caller-owned arrays", () => {
  const seed = syntheticDaylightCourse(3),
    samples = Array(10).fill("100") as string[];
  seed.segments[0]!.chart = samples;
  const frozen = flyerV3Course(1, "2026-10-26", "synthetic", seed.segments);
  samples[0] = "999";
  expect(frozen.segments.find((s) => s.ticker === seed.segments[0]!.ticker)?.chart?.[0]).toBe(
    "100",
  );
});
