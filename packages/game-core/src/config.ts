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
    pointsPerInvitee: 20,
    maxRewardsPerDay: 50,
    qualifyingGamePoints: 200,
  },
  flyer: {
    version: "flyer-3b",
    previousVersion: "flyer-3",
    legacyVersion: "flyer-1",
    v3: {
      gravity: 220,
      flapVelocity: -3800,
      maxFallSpeed: 5800,
      initialScrollSpeed: 2000,
      scrollRamp: 150,
      maxScrollSpeed: 3000,
      initialGap: 152,
      gapRamp: 8,
      minimumGap: 116,
      coinRadius: 7,
      coinGroupPipes: 10,
      chartPoints: 10,
      visibleCharts: 12,
    },
    v3b: { coinTrailMinPipes: 3, coinTrailMaxPipes: 4 },
    // V2 gap centers span 160..320px; +/-5% reaches the clamp.
    moveClampPct: 5,
    moveRangePixels: 80,
    countdownSeconds: 3,
    ticksPerSecond: 60,
    sessionExpirySeconds: 600,
    pointsPerPipe: 1,
    dailyPointsCap: 50,
    timingTolerancePct: 15,
    pipesPerSegment: 10,
    // World dimensions in pixels; physics uses 1000 integer units per pixel.
    width: 360,
    height: 480,
    scale: 1000,
    birdX: 78,
    birdRadius: 12,
    pipeWidth: 48,
    pipeSpacing: 210,
    firstPipeX: 420,
    chartMargin: 100,
    // Integer units/tick^2: 0.14 px rise acceleration, 0.12 px gravity.
    riseAcceleration: 140,
    gravity: 120,
    // Integer units/tick: 216 px/s maximum rise; 240 px/s maximum fall.
    maxRiseSpeed: 3600,
    maxFallSpeed: 4000,
    // Scroll: 108 px/s initially, +9 px/s per segment, up to 168 px/s.
    initialScrollSpeed: 1800,
    scrollRamp: 150,
    maxScrollSpeed: 2800,
    // Gaps: 180 px initially, -8 px per segment, minimum 130 px.
    initialGap: 180,
    gapRamp: 8,
    minimumGap: 130,
  },
  prices: {
    pollSeconds: 15,
    twapMinutes: 15,
    staleAfterSeconds: 120,
    defaultJumpLimitPct: 5,
  },
  extendedPrices: {
    pollSeconds: 300,
    batchSize: 4,
    batchDelayMs: 250,
    referenceHours: 26,
    coreRequestReserve: 50,
  },
  antiAbuse: {
    minDiscordAccountAgeDays: 30,
  },
} as const;

export type GameConfig = typeof GAME_CONFIG;
