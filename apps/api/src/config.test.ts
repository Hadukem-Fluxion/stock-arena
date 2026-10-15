import { describe, expect, it } from "vitest";
import { readApiPort } from "./config.js";

describe("API port configuration", () => {
  it("prefers Railway PORT, falls back to API_PORT and then the local default", () => {
    expect(readApiPort({ PORT: "9000", API_PORT: "8788" })).toBe(9000);
    expect(readApiPort({ API_PORT: "8788" })).toBe(8788);
    expect(readApiPort({})).toBe(8787);
  });
  it.each(["", "0", "65536", "-1", "1.5", "invalid"])(
    "rejects invalid PORT %s without exposing input",
    (PORT) => {
      expect(() => readApiPort({ PORT, API_PORT: "8787" })).toThrow(
        "Invalid API port configuration.",
      );
    },
  );
});
