import { describe, expect, it } from "vitest";
import { checkTicker, twap } from "./index.js";

const at = (iso: string) => new Date(`2026-10-15T${iso}Z`);

describe("twap", () => {
  it("weights each price by how long it held", () => {
    const snaps = [
      { priceUsd: 100, takenAt: at("12:00:00") },
      { priceUsd: 110, takenAt: at("12:10:00") },
    ];
    // 10 min at 100, 5 min at 110 over a 15-minute window
    expect(twap(snaps, at("12:15:00"), 15)).toBeCloseTo((100 * 10 + 110 * 5) / 15);
  });

  it("returns null without data in the window", () => {
    expect(twap([], at("12:15:00"), 15)).toBeNull();
  });
});

describe("checkTicker", () => {
  const opts = { staleAfterSeconds: 120, jumpLimitPct: 5 };

  it("is live with fresh, steady prices", () => {
    const snaps = [
      { priceUsd: 100, takenAt: at("12:00:00") },
      { priceUsd: 101, takenAt: at("12:00:15") },
    ];
    expect(checkTicker(snaps, at("12:00:30"), opts)).toEqual({ state: "live" });
  });

  it("pauses on stale data", () => {
    const snaps = [{ priceUsd: 100, takenAt: at("12:00:00") }];
    expect(checkTicker(snaps, at("12:03:00"), opts)).toEqual({ state: "paused", reason: "stale" });
  });

  it("pauses on a jump above the limit", () => {
    const snaps = [
      { priceUsd: 100, takenAt: at("12:00:00") },
      { priceUsd: 107, takenAt: at("12:00:15") },
    ];
    expect(checkTicker(snaps, at("12:00:20"), opts)).toEqual({ state: "paused", reason: "jump" });
  });
});
