import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @stock-arena/web dev --host 127.0.0.1 --strictPort",
      cwd: "../..",
      env: { VITE_DISCORD_CLIENT_ID: "111111111111111111" },
      url: "http://127.0.0.1:5173",
    },
    {
      command: "pnpm --filter @stock-arena/web preview --host 127.0.0.1 --port 5174 --strictPort",
      cwd: "../..",
      url: "http://127.0.0.1:5174",
    },
  ],
});
