/** Synthetic replay support for tests/review only; never connects to a real game. */
import { ASSETS } from "../assets.js";
import { flyerCourse, flyerPipe, initialFlyer, stepFlyer } from "../flyer.js";
import type { FlyerCourse, FlyerInput } from "../flyer.js";
export function syntheticFlyerCourse(count = 3): FlyerCourse {
  return flyerCourse(
    123,
    Array.from({ length: count }, (_, i) => ({
      ticker: `SYN${i}`,
      asset: {
        ...ASSETS.AAPL,
        symbol: `SYN${i}x`,
        referenceTicker: `SYN${i}`,
        name: `Synthetic company ${i}`,
      },
      prices: Array.from({ length: 10 }, () => "100"),
      centers: [],
      changePct: "0",
      fact: "Synthetic company for interface tests.",
    })),
  );
}
export function syntheticFlight(course: FlyerCourse, goal = 5, maxTicks = 36000) {
  let state = initialFlyer();
  const inputs: FlyerInput[] = [];
  while (!state.ended && state.tick < maxTicks) {
    const pipe = flyerPipe(course, state.score, state.distance);
    const held = state.score < goal && state.y + state.velocity * 12 > pipe.center;
    const input =
      held !== state.held
        ? { tick: state.tick, action: held ? ("press" as const) : ("release" as const) }
        : undefined;
    if (input) inputs.push(input);
    state = stepFlyer(course, state, input);
  }
  return { inputs, ticks: state.tick, score: state.score, state };
}
