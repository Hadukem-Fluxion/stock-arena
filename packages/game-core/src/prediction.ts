import type { Asset } from "./assets.js";

/** Postgres numeric values are compared exactly, including insignificant zeros. */
function decimal(value: string) {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new RangeError("Invalid decimal price.");
  const [whole, fraction = ""] = value.split(".");
  const coefficient = BigInt(whole! + fraction);
  if (coefficient <= 0n) throw new RangeError("Price must be positive.");
  return { coefficient, scale: fraction.length };
}
export function predictionResult(start: string, end: string, direction: "up" | "down") {
  const a = decimal(start),
    b = decimal(end),
    scale = Math.max(a.scale, b.scale);
  const initial = a.coefficient * 10n ** BigInt(scale - a.scale);
  const final = b.coefficient * 10n ** BigInt(scale - b.scale);
  return final === initial
    ? "equal"
    : (final > initial ? direction === "up" : direction === "down")
      ? "won"
      : "lost";
}
/** Display only; never used for equality, direction, limits or points. */
export function predictionChange(start: string, end: string): string {
  const a = decimal(start),
    b = decimal(end),
    scale = Math.max(a.scale, b.scale);
  const initial = a.coefficient * 10n ** BigInt(scale - a.scale);
  const difference = b.coefficient * 10n ** BigInt(scale - b.scale) - initial;
  return String((Number(difference) / Number(initial)) * 100);
}
export type PredictionState =
  "offered" | "waiting_open" | "waiting_start" | "pending" | "won" | "lost" | "equal" | "void";
export type PredictionRound = {
  id: string;
  ticker: string;
  asset: Asset;
  state: PredictionState;
  direction: "up" | "down" | null;
  lockedAt: string | null;
  scheduledOpenAt: string | null;
  startPrice: string | null;
  startTakenAt: string | null;
  targetAt: string | null;
  endPrice: string | null;
  endTakenAt: string | null;
  settledAt: string | null;
  changePct: string | null;
};
export type PredictionView = {
  maintenance?: boolean;
  day: string;
  serverTime: string;
  runsUsed: number;
  runsLimit: number;
  maxCorrect: number;
  pointsPerCorrect: number;
  canStart: boolean;
  runs: {
    id: string;
    day: string;
    number: number;
    correctCount: number;
    score: number;
    canPick: boolean;
    endedAt: string | null;
    expiresAt: string;
    round: PredictionRound | null;
  }[];
};
