import { expect, it } from "vitest";
import { flyerCoins, flyerCoinGroup, flyerV3Course, flyerV3bCourse } from "./flyer-v3.js";
import { flyerPipe, replayFlyer } from "./flyer.js";
import { syntheticV3Course, syntheticFlaps } from "./testing/flyer-v3-fixture.js";
import { GAME_CONFIG } from "./config.js";
it("preserves the released flyer-3 coin positions and replay", () => {
  const course = syntheticV3Course();
  expect(flyerCoins(course, 0)).toEqual([
    { id: 0, pipe: 6, x: 1768000, y: 208324, radius: 7000 },
    { id: 1, pipe: 6, x: 1792000, y: 219868, radius: 7000 },
    { id: 2, pipe: 6, x: 1816000, y: 207412, radius: 7000 },
  ]);
  const flight = syntheticFlaps(course, 5);
  expect(flight).toMatchObject({
    ticks: 680,
    score: 5,
    state: { pipes: 5, coins: 0, collected: [] },
  });
  expect(replayFlyer(course, flight.inputs, flight.ticks, 36000)).toEqual(flight.state);
});
it.each([3, 30])("places deterministic trails exactly 3–4 pipes apart with %i assets", (count) => {
  const old = syntheticV3Course(count),
    course = flyerV3bCourse(old.seed, old.day!, old.catalogVersion!, old.segments);
  let previous = -1;
  for (let group = 0; group < 100; group++) {
    const trail = flyerCoins(course, group);
    expect(trail).toEqual(flyerCoins(course, group));
    expect(trail.length).toBeGreaterThanOrEqual(1);
    expect(trail.length).toBeLessThanOrEqual(3);
    const index = trail[0]!.pipe;
    if (previous >= 0) expect([3, 4]).toContain(index - previous);
    else expect(index).toBe(2);
    previous = index;
    for (const coin of trail) {
      const pipe = flyerPipe(course, coin.pipe, 0),
        next = flyerPipe(course, coin.pipe + 1, 0);
      expect(coin.x - coin.radius).toBeGreaterThan(pipe.x + GAME_CONFIG.flyer.pipeWidth * 1000);
      expect(coin.x + coin.radius).toBeLessThan(next.x);
      expect(coin.y - coin.radius).toBeGreaterThan(0);
      expect(coin.y + coin.radius).toBeLessThan(480000);
    }
  }
  const flight = syntheticFlaps(course, 30);
  expect(replayFlyer(course, flight.inputs, flight.ticks, 36000)).toEqual(flight.state);
  expect(flight.score).toBe(flight.state.pipes! + flight.state.coins!);
  expect(new Set(flight.state.collected).size).toBe(flight.state.coins);
  // More trails do not alter the physics, terminal tick or input protocol.
  const legacy = syntheticFlaps(
    flyerV3Course(old.seed, old.day!, old.catalogVersion!, old.segments),
    30,
  );
  expect(flight.inputs).toEqual(legacy.inputs);
  expect(flight.ticks).toBe(legacy.ticks);
  expect(flight.state.pipes).toBe(legacy.state.pipes);
});
it("keeps every potentially collectible trail in the bounded nearby lookup", () => {
  const old = syntheticV3Course(),
    course = flyerV3bCourse(9, old.day!, old.catalogVersion!, old.segments);
  for (let pipes = 0; pipes < 100; pipes++) {
    const group = flyerCoinGroup(course, pipes),
      visible = new Set([group - 1, group, group + 1].filter((g) => g >= 0));
    for (let g = 0; g < 40; g++)
      for (const coin of flyerCoins(course, g))
        if (coin.pipe >= pipes - 1 && coin.pipe <= pipes + 1) expect(visible.has(g)).toBe(true);
  }
});
