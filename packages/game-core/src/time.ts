/** A game day is the UTC calendar date, formatted YYYY-MM-DD. */
export type GameDay = string;

const DAY_MS = 86_400_000;

export function gameDay(at: Date): GameDay {
  return at.toISOString().slice(0, 10);
}

export function addDays(day: GameDay, delta: number): GameDay {
  return gameDay(new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS));
}

/** Whole days since 1970-01-01 (UTC). Used for deterministic rotations. */
export function dayNumber(day: GameDay): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

/** Monday of the ISO week containing `day` (weeks run Monday 00:00 to Sunday 23:59 UTC). */
export function weekStart(day: GameDay): GameDay {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  return addDays(day, -sinceMonday);
}
