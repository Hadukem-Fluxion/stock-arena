import { describe, expect, it } from "vitest";
import {
  checkinAwards,
  higherOrLowerWinner,
  nextStreak,
  quizAnswerInTime,
  quizPoints,
  stockOfTheDay,
} from "./scoring.js";
import { addDays, gameDay, weekStart } from "./time.js";

describe("time", () => {
  it("uses the UTC date as the game day", () => {
    expect(gameDay(new Date("2026-10-15T23:59:59Z"))).toBe("2026-10-15");
    expect(gameDay(new Date("2026-10-16T00:00:00Z"))).toBe("2026-10-16");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-15")).toBe("2026-10-12"); // Thursday
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // Monday
  });
});

describe("check-in", () => {
  it("starts a streak at 1", () => {
    expect(nextStreak("2026-10-15", null)).toBe(1);
  });

  it("continues a streak from yesterday", () => {
    expect(nextStreak("2026-10-15", { day: "2026-10-14", streak: 6 })).toBe(7);
  });

  it("resets after a missed day", () => {
    expect(nextStreak("2026-10-15", { day: "2026-10-13", streak: 6 })).toBe(1);
  });

  it("rejects a second check-in on the same day", () => {
    expect(() => nextStreak("2026-10-15", { day: "2026-10-15", streak: 3 })).toThrow();
  });

  it("pays streak bonuses on day 7 and day 30 only", () => {
    expect(checkinAwards(1)).toEqual([{ amount: 10, reason: "checkin" }]);
    expect(checkinAwards(7)).toEqual([
      { amount: 10, reason: "checkin" },
      { amount: 50, reason: "streak_bonus_7" },
    ]);
    expect(checkinAwards(8)).toHaveLength(1);
    expect(checkinAwards(30).at(1)).toEqual({ amount: 300, reason: "streak_bonus_30" });
  });
});

describe("quiz", () => {
  it("scores 20 per correct answer plus 15 for a perfect run", () => {
    expect(quizPoints(0)).toBe(0);
    expect(quizPoints(2)).toBe(40);
    expect(quizPoints(3)).toBe(75);
  });

  it("rejects impossible scores", () => {
    expect(() => quizPoints(4)).toThrow(RangeError);
  });

  it("accepts answers within 30 s plus grace", () => {
    const served = new Date("2026-10-15T12:00:00Z");
    expect(quizAnswerInTime(served, new Date("2026-10-15T12:00:31Z"))).toBe(true);
    expect(quizAnswerInTime(served, new Date("2026-10-15T12:00:33Z"))).toBe(false);
  });
});

describe("higher or lower", () => {
  it("picks the bigger absolute move", () => {
    expect(
      higherOrLowerWinner(
        { ticker: "NVDA", change24hPct: -3.2 },
        { ticker: "AAPL", change24hPct: 1.1 },
      ),
    ).toBe("NVDA");
  });

  it("skips near ties", () => {
    expect(
      higherOrLowerWinner(
        { ticker: "MSFT", change24hPct: 1.0 },
        { ticker: "META", change24hPct: -1.05 },
      ),
    ).toBeNull();
  });
});

describe("stock of the day", () => {
  it("is deterministic and rotates daily", () => {
    const today = stockOfTheDay("2026-10-15");
    expect(stockOfTheDay("2026-10-15")).toBe(today);
    expect(stockOfTheDay("2026-10-16")).not.toBe(today);
  });
});
