import { GAME_CONFIG } from "./config.js";
import { flyerV2Course, flyerPipe, flyerCenters } from "./flyer.js";
import type { FlyerCourse, FlyerSegment, FlyerState, FlyerInput } from "./flyer.js";
const c = GAME_CONFIG.flyer,
  p = c.v3;
export type FlyerCoin = { id: number; pipe: number; x: number; y: number; radius: number };
export function flyerV3Course(
  seed: number,
  day: string,
  version: string,
  segments: readonly FlyerSegment[],
): FlyerCourse {
  for (const s of segments)
    if (s.chart) {
      if (s.chart.length < 10 || s.chart.length > 20) throw new RangeError("Invalid frozen chart.");
      for (const price of s.chart) flyerCenters(Array(10).fill(price));
    }
  const course = flyerV2Course(
    seed,
    day,
    version,
    segments.map((s) => ({ ...s, chart: s.chart ? [...s.chart] : undefined })),
  );
  return { ...course, version: "flyer-3" };
}
function hash(seed: number) {
  let n = seed | 0;
  n ^= n << 13;
  n ^= n >>> 17;
  n ^= n << 5;
  return n >>> 0;
}
/** One optional 1–3-coin trail per ten pipes, derived solely from frozen course data. */
export function flyerCoins(course: FlyerCourse, group: number): FlyerCoin[] {
  if (course.version !== "flyer-3" || !Number.isSafeInteger(group) || group < 0) return [];
  const random = hash(course.seed ^ Math.imul(group + 1, 0x9e3779b1)),
    count = 1 + (random % 3);
  const index = group * p.coinGroupPipes + ((random >>> 8) % p.coinGroupPipes);
  const pipe = flyerPipe(course, index, 0),
    next = flyerPipe(course, index + 1, 0),
    sign = random & 16 ? 1 : -1;
  return Array.from({ length: count }, (_, i) => {
    const x = pipe.x + (c.pipeWidth + 40 + i * 24) * c.scale;
    const fraction = Math.trunc(((x - pipe.x) * 1000) / (c.pipeSpacing * c.scale));
    const line = pipe.center + Math.trunc(((next.center - pipe.center) * fraction) / 1000);
    const offset = sign * (i === 1 ? 18 : 30) * c.scale;
    return {
      id: group * 3 + i,
      pipe: index,
      x,
      y: Math.max(24 * c.scale, Math.min((c.height - 24) * c.scale, line + offset)),
      radius: p.coinRadius * c.scale,
    };
  });
}
export function flyerProgress(course: FlyerCourse, state: FlyerState) {
  return course.version === "flyer-3" ? (state.pipes ?? 0) : state.score;
}
export function flyerBirdAngle(velocity: number) {
  return Math.max(
    -25,
    Math.min(
      70,
      velocity >= 0 ? (velocity * 70) / p.maxFallSpeed : (velocity * 25) / -p.flapVelocity,
    ),
  );
}
export function stepFlyerV3(
  course: FlyerCourse,
  state: FlyerState,
  input?: FlyerInput,
): FlyerState {
  if (state.ended) return state;
  if (input && (input.action !== "flap" || input.tick !== state.tick))
    throw new RangeError("Invalid flap.");
  const started = state.started ?? false,
    pipesBefore = state.pipes ?? 0,
    coinsBefore = state.coins ?? 0,
    collected = state.collected ?? [];
  if (!started && !input)
    return { ...state, tick: state.tick + 1, pipes: 0, coins: 0, collected, started: false };
  const velocity = input ? p.flapVelocity : Math.min(p.maxFallSpeed, state.velocity + p.gravity),
    y = state.y + velocity;
  const difficulty = Math.floor(pipesBefore / c.pipesPerSegment),
    distance =
      state.distance + Math.min(p.maxScrollSpeed, p.initialScrollSpeed + difficulty * p.scrollRamp);
  let pipes = pipesBefore,
    coins = coinsBefore,
    ended = y - c.birdRadius * c.scale <= 0 || y + c.birdRadius * c.scale >= c.height * c.scale;
  for (let i = Math.max(0, pipesBefore - 1); i <= pipesBefore + 1; i++) {
    const pipe = flyerPipe(course, i, distance),
      right = pipe.x + c.pipeWidth * c.scale;
    if (
      pipe.x <= (c.birdX + c.birdRadius) * c.scale &&
      right >= (c.birdX - c.birdRadius) * c.scale &&
      (y - c.birdRadius * c.scale < pipe.center - pipe.gap / 2 ||
        y + c.birdRadius * c.scale > pipe.center + pipe.gap / 2)
    )
      ended = true;
    if (!ended && i === pipes && right < (c.birdX - c.birdRadius) * c.scale) pipes++;
  }
  const picked = [...collected],
    group = Math.floor(pipesBefore / p.coinGroupPipes);
  if (!ended)
    for (let g = Math.max(0, group - 1); g <= group + 1; g++)
      for (const coin of flyerCoins(course, g)) {
        if (picked.includes(coin.id)) continue;
        const dx = coin.x - distance - c.birdX * c.scale,
          dy = coin.y - y,
          radius = coin.radius + c.birdRadius * c.scale;
        if (Math.abs(dx) > radius || Math.abs(dy) > radius) continue;
        if (dx * dx + dy * dy <= radius * radius) {
          picked.push(coin.id);
          coins++;
        }
      }
  return {
    tick: state.tick + 1,
    y,
    velocity,
    distance,
    held: false,
    pipes,
    coins,
    collected: picked,
    started: true,
    score: pipes + coins,
    ended,
  };
}
