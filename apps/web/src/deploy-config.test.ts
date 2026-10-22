import { describe, expect, it } from "vitest";
import { createVercelConfig } from "./deploy-config.js";

describe("Vercel staging configuration", () => {
  it("preserves /api paths before the SPA fallback and produces static Vite output", () => {
    const config = createVercelConfig("https://arena-api.example.com/");
    expect(config.rewrites).toEqual([
      { source: "/api/:path*", destination: "https://arena-api.example.com/api/:path*" },
      { source: "/:path*", destination: "/index.html" },
    ]);
    expect(config).toMatchObject({
      framework: "vite",
      outputDirectory: "dist",
      installCommand: "pnpm install --frozen-lockfile",
      buildCommand: "pnpm build",
    });
    expect(config.headers).toEqual([
      {
        source: "/admin/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ]);
  });
  it.each([
    undefined,
    "",
    "http://api.example.com",
    "https://user:secret@api.example.com",
    "https://api.example.com/api",
    "https://api.example.com?secret=example",
    "https://api.example.com#fragment",
  ])("rejects invalid upstream origins without echoing their values", (url) => {
    expect(() => createVercelConfig(url)).toThrow(
      "Set RAILWAY_API_URL to the backend API HTTPS origin.",
    );
  });
});
