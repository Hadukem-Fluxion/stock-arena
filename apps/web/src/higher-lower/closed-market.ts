import type { HlView } from "@stock-arena/game-core";
import { en } from "../copy/en.js";

/** Display the source's next opening, never a calculated exchange schedule. */
export function closedMarketNotice(view: HlView | null): string | null {
  if (
    view?.status !== "paused" ||
    !view.paused.length ||
    !view.paused.every((stock) => stock.reason === "closed")
  )
    return null;
  const now = Date.parse(view.serverTime);
  const openings = view.paused
    .map((stock) => Date.parse(stock.nextChangeAt ?? ""))
    .filter((time) => Number.isFinite(time) && time > now);
  if (!openings.length) return en.hl.closed;
  const time = `${new Date(Math.min(...openings)).toISOString().slice(0, 16).replace("T", " ")} ${en.labels.utc}`;
  return en.hl.closedWithTime(time);
}
