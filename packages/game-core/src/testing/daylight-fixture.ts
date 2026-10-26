import { syntheticFlyerCourse } from "./flyer-fixture.js";
import { flyerV2Course } from "../flyer.js";
export function syntheticDaylightCourse(count = 3, day = "2026-10-26", seed = 123) {
  return flyerV2Course(
    seed,
    day,
    "synthetic-catalog",
    syntheticFlyerCourse(count).segments.map((s, i) => ({
      ...s,
      prices: ["100", String(100 + ((i % 3) - 1))],
      changePct: String((i % 3) - 1),
      asset: { ...s.asset, primaryColor: ["#4262ea", "#ff9325", "#d43e58"][i % 3] },
      lastSession: false,
    })),
  );
}
