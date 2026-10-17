import type { Asset } from "./assets.js";

export type HlStock = { ticker: string; asset: Asset; priceUsd: string };
export type HlView = {
  day: string;
  serverTime: string;
  status: "ready" | "round" | "feedback" | "completed" | "paused";
  runsUsed: number;
  runsLimit: number;
  maxCorrect: number;
  pointsPerCorrect: number;
  run: { id: string; number: number; correctCount: number; score: number } | null;
  round: { id: string; position: number; stocks: [HlStock, HlStock] } | null;
  feedback: {
    correct: boolean;
    choice: string;
    winner: string;
    stocks: [HlStock & { change24hPct: number }, HlStock & { change24hPct: number }];
  } | null;
  paused: { ticker: string; reason: string }[];
};
