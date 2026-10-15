import { GAME_CONFIG, TICKERS, type Ticker } from "./config.js";
import { addDays, dayNumber, type GameDay } from "./time.js";

export type PointsAward = { amount: number; reason: string };

/**
 * Streak after a check-in on `today`, given the player's last check-in day and streak.
 * Missing a day resets the streak to 1.
 */
export function nextStreak(today: GameDay, last: { day: GameDay; streak: number } | null): number {
  if (!last) return 1;
  if (last.day === today) {
    throw new Error("Already checked in today");
  }
  return last.day === addDays(today, -1) ? last.streak + 1 : 1;
}

/** Points earned for a check-in that brings the streak to `streak`. */
export function checkinAwards(streak: number): PointsAward[] {
  const { pointsPerDay, streakBonuses } = GAME_CONFIG.checkin;
  const awards: PointsAward[] = [{ amount: pointsPerDay, reason: "checkin" }];
  for (const bonus of streakBonuses) {
    if (streak === bonus.day) {
      awards.push({ amount: bonus.points, reason: `streak_bonus_${bonus.day}` });
    }
  }
  return awards;
}

/** Quiz points for a finished attempt. */
export function quizPoints(correctCount: number): number {
  const { questionsPerDay, pointsPerCorrect, perfectBonus } = GAME_CONFIG.quiz;
  if (!Number.isInteger(correctCount) || correctCount < 0 || correctCount > questionsPerDay) {
    throw new RangeError(`correctCount must be 0..${questionsPerDay}`);
  }
  const bonus = correctCount === questionsPerDay ? perfectBonus : 0;
  return correctCount * pointsPerCorrect + bonus;
}

/** True when an answer arrived inside the allowed window (measured on the server). */
export function quizAnswerInTime(servedAt: Date, answeredAt: Date): boolean {
  const { secondsPerQuestion, graceSeconds } = GAME_CONFIG.quiz;
  const elapsed = (answeredAt.getTime() - servedAt.getTime()) / 1000;
  return elapsed >= 0 && elapsed <= secondsPerQuestion + graceSeconds;
}

/**
 * Higher or Lower: which of two tickers moved more over 24h (absolute % change).
 * Returns null when the gap is too small to be a fair round.
 */
export function higherOrLowerWinner(
  a: { ticker: Ticker; change24hPct: number },
  b: { ticker: Ticker; change24hPct: number },
): Ticker | null {
  const gap = Math.abs(Math.abs(a.change24hPct) - Math.abs(b.change24hPct));
  if (gap < GAME_CONFIG.higherOrLower.minChangeGapPct) return null;
  return Math.abs(a.change24hPct) > Math.abs(b.change24hPct) ? a.ticker : b.ticker;
}

/** Stock of the Day: deterministic rotation over the launch tickers. */
export function stockOfTheDay(day: GameDay, tickers: readonly Ticker[] = TICKERS): Ticker {
  const index = ((dayNumber(day) % tickers.length) + tickers.length) % tickers.length;
  const ticker = tickers.at(index);
  if (!ticker) throw new Error("No tickers configured");
  return ticker;
}
