/**
 * Single source of truth for game rules, point values and limits.
 * Mirrors docs/GAME_RULES.md. Change values here only when a task brief says so,
 * and update docs/GAME_RULES.md in the same pull request.
 */

import { ASSETS, assetTickers } from "./assets.js";
import type { Ticker } from "./assets.js";
export type { Ticker } from "./assets.js";

export const TICKERS = assetTickers(ASSETS);
export const COMPANY_NAMES = Object.fromEntries(
  TICKERS.map((ticker) => [ticker, ASSETS[ticker].name]),
) as Record<Ticker, string>;

export const GAME_CONFIG = {
  checkin: {
    pointsPerDay: 10,
    /** Bonus paid on the day the streak reaches this length. */
    streakBonuses: [
      { day: 7, points: 50 },
      { day: 30, points: 300 },
    ],
  },
  quiz: {
    questionsPerDay: 3,
    secondsPerQuestion: 30,
    /** Network grace added to the server-side timer. */
    graceSeconds: 2,
    pointsPerCorrect: 20,
    perfectBonus: 15,
    attemptsPerDay: 1,
  },
  higherOrLower: {
    runsPerDay: 3,
    maxCorrectPerRun: 10,
    pointsPerCorrect: 5,
    predictionMinutes: 15,
    settlementRetryHours: 6,
    runExpiryHours: 24,
    /** Pairs whose absolute 24h changes differ by less than this (percentage points) are skipped. */
    minChangeGapPct: 0.1,
  },
  referrals: {
    pointsPerQualifiedFriend: 50,
    maxPerSeason: 10,
    /** The invited friend must check in on this many distinct days. */
    qualifyingCheckinDays: 3,
  },
  prices: {
    pollSeconds: 15,
    twapMinutes: 15,
    staleAfterSeconds: 120,
    defaultJumpLimitPct: 5,
  },
  antiAbuse: {
    minDiscordAccountAgeDays: 30,
  },
} as const;

export type GameConfig = typeof GAME_CONFIG;
