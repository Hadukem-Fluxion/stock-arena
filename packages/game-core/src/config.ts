/**
 * Single source of truth for game rules, point values and limits.
 * Mirrors docs/GAME_RULES.md. Change values here only when a task brief says so,
 * and update docs/GAME_RULES.md in the same pull request.
 */

export const TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"] as const;
export type Ticker = (typeof TICKERS)[number];

export const COMPANY_NAMES: Record<Ticker, string> = {
  AAPL: "Apple",
  MSFT: "Microsoft",
  GOOGL: "Alphabet",
  AMZN: "Amazon",
  META: "Meta",
  NVDA: "Nvidia",
  TSLA: "Tesla",
};

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
    /** Pairs whose absolute 24h changes differ by less than this (percentage points) are skipped. */
    minChangeGapPct: 0.1,
  },
  referrals: {
    pointsPerQualifiedFriend: 50,
    maxPerSeason: 10,
    /** The invited friend must check in on this many distinct days. */
    qualifyingCheckinDays: 3,
  },
  dailyCall: {
    tickersPerDay: 3,
    closeHourUtc: 20,
    pointsPerCorrect: 30,
    /** Moves smaller than this (percent) settle as no result. */
    noResultBandPct: 0.1,
    settlementHours: 24,
    /** If a ticker is paused at settlement, retry for this long, then void. */
    settlementRetryHours: 6,
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
