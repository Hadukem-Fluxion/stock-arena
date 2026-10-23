import type { AssetCatalog } from "./assets.js";

export type LeaderboardPeriod = "day" | "week" | "season";
export type LeaderboardPlatform = "all" | "discord" | "telegram";
export type Season = { id: string; name?: string; startsAt: string; endsAt: string | null };
export type LeaderboardEntry = {
  userId: string;
  displayName: string;
  rank: number;
  score: number;
  reachedAt: string;
};
export type LeaderboardView = {
  period: LeaderboardPeriod;
  platform: LeaderboardPlatform;
  generatedAt: string;
  startsAt: string;
  endsAt: string | null;
  season: Season & { ended: boolean };
  top: LeaderboardEntry[];
  caller: LeaderboardEntry | null;
};
export type LivePrice = {
  ticker: string;
  priceUsd: string | null;
  takenAt: string | null;
  change24hPct: number | null;
  state: "live" | "paused";
  reason: string | null;
  pool?: { priceUsd: string; takenAt: string } | null;
};
export type PricesView = { serverTime: string; catalog: AssetCatalog; prices: LivePrice[] };
