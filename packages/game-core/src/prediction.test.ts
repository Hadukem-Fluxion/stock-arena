import { describe, expect, it } from "vitest";
import { predictionResult, predictionChange } from "./prediction.js";
describe("exact primary prediction prices", () => {
  it("compares tiny movements and insignificant zeros without float equality or a neutral band", () => {
    expect(predictionResult("100.000", "100", "up")).toBe("equal");
    expect(predictionResult("100.00000000000000000001", "100.00000000000000000002", "up")).toBe(
      "won",
    );
    expect(predictionResult("100", "99.99999999999999999999", "down")).toBe("won");
    expect(predictionResult("100", "99", "up")).toBe("lost");
    expect(predictionChange("100", "101")).toBe("1");
  });
  it("rejects non-positive or invalid decimal prices", () => {
    for (const value of ["0", "NaN", "-1", "Infinity"])
      expect(() => predictionResult(value, "100", "up")).toThrow();
  });
});
