import { GAME_CONFIG } from "./config.js";
import type { Asset } from "./assets.js";

const c = GAME_CONFIG.flyer;
export type FlyerInput = { tick: number; action: "press" | "release" };
export type FlyerSegment = {
  ticker: string;
  asset: Asset;
  prices: string[];
  centers: number[];
  changePct: string;
  fact: string | null;
};
export type FlyerCourse = { version: string; seed: number; segments: FlyerSegment[] };
export type FlyerState = {
  tick: number;
  y: number;
  velocity: number;
  distance: number;
  held: boolean;
  score: number;
  ended: boolean;
};
export type FlyerPipe = {
  index: number;
  x: number;
  center: number;
  gap: number;
  segment: FlyerSegment;
};

/** Exact integer normalization; persisted prices are never rounded through floats. */
export function flyerCenters(prices: readonly string[]): number[] {
  if (prices.length !== c.pipesPerSegment || prices.some((p) => !/^\d{1,40}(\.\d{1,40})?$/.test(p)))
    throw new RangeError("Invalid chart.");
  const scale = Math.max(...prices.map((p) => p.split(".")[1]?.length ?? 0));
  const values = prices.map((p) => {
    const [whole, part = ""] = p.split(".");
    return BigInt(whole! + part.padEnd(scale, "0"));
  });
  if (values.some((n) => n <= 0n)) throw new RangeError("Invalid chart.");
  const min = values.reduce((a, b) => (a < b ? a : b)),
    max = values.reduce((a, b) => (a > b ? a : b));
  return values.map((n) =>
    max === min
      ? c.height / 2
      : c.height -
        c.chartMargin -
        Number(((n - min) * BigInt(c.height - 2 * c.chartMargin)) / (max - min)),
  );
}
/** Seeded Fisher-Yates: server chooses the seed, replay has no ambient randomness. */
export function flyerCourse(seed: number, segments: readonly FlyerSegment[]): FlyerCourse {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !segments.length)
    throw new RangeError("Invalid course.");
  let random = seed || 0x6d2b79f5;
  const order = segments.map((s) => ({
    ...s,
    prices: [...s.prices],
    centers: flyerCenters(s.prices),
  }));
  for (let i = order.length - 1; i > 0; i--) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    const j = (random >>> 0) % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return { version: c.version, seed, segments: order };
}
export function initialFlyer(): FlyerState {
  return {
    tick: 0,
    y: (c.height * c.scale) / 2,
    velocity: 0,
    distance: 0,
    held: false,
    score: 0,
    ended: false,
  };
}
export function flyerPipe(course: FlyerCourse, index: number, distance: number): FlyerPipe {
  const segmentIndex = Math.floor(index / c.pipesPerSegment),
    segment = course.segments[segmentIndex % course.segments.length]!;
  return {
    index,
    x: (c.firstPipeX + index * c.pipeSpacing) * c.scale - distance,
    center: segment.centers[index % c.pipesPerSegment]! * c.scale,
    gap: Math.max(c.minimumGap, c.initialGap - segmentIndex * c.gapRamp) * c.scale,
    segment,
  };
}
/** One fixed 60 Hz tick. All state/collision arithmetic is integer-only. */
export function stepFlyer(course: FlyerCourse, state: FlyerState, input?: FlyerInput): FlyerState {
  if (state.ended) return state;
  if (input && (input.tick !== state.tick || (input.action === "press") === state.held))
    throw new RangeError("Invalid input transition.");
  const held = input ? input.action === "press" : state.held;
  const velocity = Math.max(
    -c.maxRiseSpeed,
    Math.min(c.maxFallSpeed, state.velocity + (held ? -c.riseAcceleration : c.gravity)),
  );
  const y = state.y + velocity,
    segment = Math.floor(state.score / c.pipesPerSegment);
  const distance =
    state.distance + Math.min(c.maxScrollSpeed, c.initialScrollSpeed + segment * c.scrollRamp);
  let score = state.score,
    ended = y - c.birdRadius * c.scale <= 0 || y + c.birdRadius * c.scale >= c.height * c.scale;
  // At most two adjacent pipes can overlap the bird; do not scan the whole course.
  for (let i = Math.max(0, state.score - 1); i <= state.score + 1; i++) {
    const pipe = flyerPipe(course, i, distance),
      right = pipe.x + c.pipeWidth * c.scale;
    if (
      pipe.x <= (c.birdX + c.birdRadius) * c.scale &&
      right >= (c.birdX - c.birdRadius) * c.scale &&
      (y - c.birdRadius * c.scale < pipe.center - pipe.gap / 2 ||
        y + c.birdRadius * c.scale > pipe.center + pipe.gap / 2)
    )
      ended = true;
    if (!ended && i === score && right < (c.birdX - c.birdRadius) * c.scale) score++;
  }
  return { tick: state.tick + 1, y, velocity, distance, held, score, ended };
}
export function replayFlyer(
  course: FlyerCourse,
  inputs: readonly FlyerInput[],
  ticks: number,
  maxTicks: number,
): FlyerState {
  if (
    course.version !== c.version ||
    !course.segments.length ||
    !Number.isSafeInteger(ticks) ||
    ticks < 1 ||
    ticks > maxTicks ||
    inputs.length > ticks
  )
    throw new RangeError("Invalid replay.");
  let previous = -1;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    if (
      !Number.isSafeInteger(input.tick) ||
      input.tick <= previous ||
      input.tick >= ticks ||
      input.action !== (i % 2 === 0 ? "press" : "release")
    )
      throw new RangeError("Invalid input log.");
    previous = input.tick;
  }
  let state = initialFlyer(),
    cursor = 0;
  while (state.tick < ticks && !state.ended) {
    const input = inputs[cursor]?.tick === state.tick ? inputs[cursor++] : undefined;
    state = stepFlyer(course, state, input);
  }
  if (state.tick !== ticks || cursor !== inputs.length || (!state.ended && ticks !== maxTicks))
    throw new RangeError("Replay did not end at the submitted tick.");
  return state;
}
