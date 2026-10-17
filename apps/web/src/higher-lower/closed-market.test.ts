import { describe, expect, it } from "vitest";
import type { HlView } from "@stock-arena/game-core";
import { closedMarketNotice } from "./closed-market.js";
import { en } from "../copy/en.js";

const view: HlView = {
  day: "2026-10-17",
  serverTime: "2026-10-17T12:00:00.000Z",
  status: "paused",
  runsUsed: 0,
  runsLimit: 3,
  maxCorrect: 10,
  pointsPerCorrect: 5,
  run: null,
  round: null,
  feedback: null,
  paused: [],
};
describe("closed-market notice", () => {
  it.each([3, 30])("uses the source's next opening in UTC for %s paused assets", (count) => {
    const paused = Array.from({ length: count }, (_, i) => ({
      ticker: `SYNTHETIC_${i}`,
      reason: "closed",
      nextChangeAt: "2026-10-18T20:00:00-04:00",
    }));
    expect(closedMarketNotice({ ...view, paused })).toBe(
      en.hl.closedWithTime("2026-10-19 00:00 UTC"),
    );
  });
  it("never invents a reopening for missing, invalid or expired metadata", () => {
    for (const nextChangeAt of [null, undefined, "invalid", "2026-10-16T00:00:00Z"])
      expect(
        closedMarketNotice({
          ...view,
          paused: [{ ticker: "TEST", reason: "closed", nextChangeAt }],
        }),
      ).toBe(en.hl.closed);
  });
  it("keeps generic pauses distinct from a closed market", () => {
    expect(
      closedMarketNotice({ ...view, paused: [{ ticker: "TEST", reason: "manual" }] }),
    ).toBeNull();
    expect(
      closedMarketNotice({
        ...view,
        paused: [
          { ticker: "TEST", reason: "closed" },
          { ticker: "OTHER", reason: "divergence" },
        ],
      }),
    ).toBeNull();
    expect(closedMarketNotice(null)).toBeNull();
  });
});
