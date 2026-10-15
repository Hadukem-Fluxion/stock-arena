import { describe, expect, it } from "vitest";
import { detectHost } from "./detect.js";

describe("detectHost", () => {
  it("detects Discord from frame_id", () => {
    expect(detectHost({ search: "?frame_id=abc&instance_id=1", hash: "" })).toBe("discord");
  });

  it("detects Telegram from tgWebAppData", () => {
    expect(detectHost({ search: "", hash: "#tgWebAppData=query_id%3D1" })).toBe("telegram");
  });

  it("falls back to browser", () => {
    expect(detectHost({ search: "", hash: "" })).toBe("browser");
  });
});
