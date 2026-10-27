import { GAME_CONFIG } from "./config.js";
import type { ReferenceAsset } from "./assets.js";
import { stepFlyerV3 } from "./flyer-v3.js";

const c = GAME_CONFIG.flyer;
export type FlyerInput = { tick: number; action: "press" | "release" | "flap" };
export type FlyerSegment = {
  ticker: string;
  asset: ReferenceAsset;
  prices: string[];
  centers: number[];
  changePct: string;
  fact: string | null;
  /** Optional for sessions frozen before the per-ticker history window follow-up. */
  windowEndsAt?: string;
  lastSession?: boolean;
  chart?: string[];
};
export type FlyerCourse = {
  version: "flyer-1" | "flyer-2" | "flyer-3";
  seed: number;
  segments: FlyerSegment[];
  day?: string;
  catalogVersion?: string;
};
export type FlyerCourseReference = {
  version: "flyer-2" | "flyer-3";
  dailyDay: string;
  seed: number;
};
export type StoredFlyerCourse = FlyerCourse | FlyerCourseReference;
export type FlyerState = {
  tick: number;
  y: number;
  velocity: number;
  distance: number;
  held: boolean;
  score: number;
  ended: boolean;
  pipes?: number;
  coins?: number;
  collected?: number[];
  started?: boolean;
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
  return { version: "flyer-1", seed, segments: order };
}
/** V2 maps signed percentage change to an integer center with a playable clamp. */
export function flyerMoveCenter(changePct: string): number {
  if (!/^-?\d{1,30}(\.\d{1,18})?$/.test(changePct)) throw new RangeError("Invalid price move.");
  const negative = changePct.startsWith("-"),
    [whole, part = ""] = changePct.replace(/^-/u, "").split("."),
    precision = 10n ** BigInt(part.length);
  const value = (BigInt(whole!) * precision + BigInt(part || "0")) * (negative ? -1n : 1n),
    clamp = BigInt(c.moveClampPct) * precision;
  const bounded = value > clamp ? clamp : value < -clamp ? -clamp : value;
  return c.height / 2 - Number((bounded * BigInt(c.moveRangePixels)) / clamp);
}
export function flyerV2Course(
  seed: number,
  day: string,
  catalogVersion: string,
  segments: readonly FlyerSegment[],
): FlyerCourse {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !catalogVersion)
    throw new RangeError("Invalid course day.");
  const order = flyerCourse(
    seed,
    segments.map((s) => ({
      ...s,
      prices: Array.from({ length: 10 }, () => s.prices.at(-1) ?? "0"),
    })),
  ).segments;
  const originals = new Map(segments.map((s) => [s.ticker, s]));
  if (originals.size !== segments.length) throw new RangeError("Duplicate stock.");
  return {
    version: "flyer-2",
    seed,
    day,
    catalogVersion,
    segments: order.map((s) => {
      const original = originals.get(s.ticker)!;
      if (original.prices.length !== 2) throw new RangeError("Invalid reference prices.");
      flyerCenters(Array(10).fill(original.prices[0]!));
      return {
        ...original,
        asset: { ...original.asset },
        prices: [...original.prices],
        centers: [flyerMoveCenter(original.changePct)],
      };
    }),
  };
}
export function flyerAssetIndex(course: FlyerCourse, pipeIndex: number): number {
  return (
    (course.version !== "flyer-1" ? pipeIndex : Math.floor(pipeIndex / c.pipesPerSegment)) %
    course.segments.length
  );
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
  const physics = course.version === "flyer-3" ? c.v3 : c;
  const segmentIndex = Math.floor(index / c.pipesPerSegment),
    segment = course.segments[flyerAssetIndex(course, index)]!;
  return {
    index,
    x: (c.firstPipeX + index * c.pipeSpacing) * c.scale - distance,
    center:
      segment.centers[course.version !== "flyer-1" ? 0 : index % c.pipesPerSegment]! * c.scale,
    gap:
      Math.max(physics.minimumGap, physics.initialGap - segmentIndex * physics.gapRamp) * c.scale,
    segment,
  };
}
/** One fixed 60 Hz tick. All state/collision arithmetic is integer-only. */
export function stepFlyer(course: FlyerCourse, state: FlyerState, input?: FlyerInput): FlyerState {
  if (course.version === "flyer-3") return stepFlyerV3(course, state, input);
  if (state.ended) return state;
  if (
    input &&
    (input.action === "flap" ||
      input.tick !== state.tick ||
      (input.action === "press") === state.held)
  )
    throw new RangeError("Invalid input transition.");
  const held = input ? input.action === "press" : state.held;
  // Countdown ticks are part of the recorded wall-clock duration, not extra time.
  if (course.version === "flyer-2" && state.tick < c.countdownSeconds * c.ticksPerSecond)
    return { ...state, tick: state.tick + 1, held };
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
  stop = false,
): FlyerState {
  if (
    !["flyer-1", "flyer-2", "flyer-3"].includes(course.version) ||
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
      input.action !== (course.version === "flyer-3" ? "flap" : i % 2 === 0 ? "press" : "release")
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
  if (
    state.tick !== ticks ||
    cursor !== inputs.length ||
    (!state.ended && ticks !== maxTicks && !(stop && course.version === "flyer-3"))
  )
    throw new RangeError("Replay did not end at the submitted tick.");
  return state;
}
