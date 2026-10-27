import { expect, test } from "@playwright/test";
import type { Page, FrameLocator } from "@playwright/test";
import { resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { replayFlyer } from "@stock-arena/game-core";
import type { FlyerInput } from "@stock-arena/game-core";
import { syntheticDaylightCourse } from "../../../packages/game-core/src/testing/daylight-fixture.js";
import { en } from "../src/copy/en.js";
import { setupPrediction } from "./prediction-fixture.js";
const capture = process.env.T36_REVIEW_CAPTURES === "1",
  directory = fileURLToPath(new URL("../../../docs/review/t36/", import.meta.url));
test.use({ video: { mode: "on", size: { width: 390, height: 844 } } });
async function setup(page: Page, count: number, host: "discord" | "telegram") {
  const parent = await setupPrediction(page, 3),
    course = syntheticDaylightCourse(count);
  let finishes = 0;
  await page.addInitScript(() => {
    Reflect.set(window, "daylightHaptics", []);
    if (window.Telegram?.WebApp)
      window.Telegram.WebApp.HapticFeedback = {
        impactOccurred: () => Reflect.get(window, "daylightHaptics").push("score"),
        notificationOccurred: () => Reflect.get(window, "daylightHaptics").push("collision"),
      };
  });
  await page.route("**/api/flyer{,/**}", (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.endsWith("/start"))
      return route.fulfill({
        json: {
          id: "a1000000-0000-4000-8000-000000000001",
          course,
          startedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          maxTicks: 36000,
        },
      });
    if (path.endsWith("/finish")) {
      const input = request.postDataJSON() as {
        inputs: FlyerInput[];
        ticks: number;
        score: number;
      };
      const result = replayFlyer(course, input.inputs, input.ticks, 36000);
      expect(result.score).toBe(input.score);
      finishes++;
      return route.fulfill({
        json: {
          id: "a1000000-0000-4000-8000-000000000001",
          course,
          day: course.day,
          score: result.score,
          best: result.score,
          pointsAwarded: Math.min(50, result.score),
          pointsToday: Math.min(50, result.score),
          newBest: true,
        },
      });
    }
    if (path.endsWith("/leaderboard"))
      return route.fulfill({
        json: {
          period: "day",
          entries: [],
          caller: null,
          season: {
            id: "season-1",
            name: "Season 1",
            startsAt: "2026-10-16T00:00:00Z",
            endsAt: null,
          },
        },
      });
    return route.fulfill({
      json: {
        day: course.day,
        best: 42,
        pointsToday: 0,
        dailyCap: 50,
        maintenance: false,
        available: true,
        canStart: true,
        active: null,
      },
    });
  });
  if (host === "discord") {
    await page.addInitScript(() => {
      if (window.parent !== window) return;
      addEventListener("message", (event) => {
        const frame: unknown = event.data;
        if (!Array.isArray(frame)) return;
        if (frame[0] === 0) {
          (event.source as Window).postMessage(
            [
              1,
              {
                cmd: "DISPATCH",
                evt: "READY",
                nonce: null,
                data: { v: 1, config: { api_endpoint: "//discord.test", environment: "test" } },
              },
            ],
            location.origin,
          );
          return;
        }
        const msg = frame[1] as { cmd: string; nonce?: string; evt?: string };
        if (frame[0] !== 1 || !msg.nonce || msg.evt !== undefined) return;
        const data =
          msg.cmd === "AUTHORIZE"
            ? { code: "synthetic-code" }
            : msg.cmd === "AUTHENTICATE"
              ? {
                  access_token: "synthetic-access",
                  user: {
                    id: "111111111111111111",
                    username: "Synthetic",
                    discriminator: "0001",
                    public_flags: 0,
                    avatar: null,
                  },
                  scopes: ["identify"],
                  expires: "2099-01-01T00:00:00Z",
                  application: { id: "111111111111111111", name: "Synthetic", description: "" },
                }
              : {};
        (event.source as Window).postMessage(
          [1, { cmd: msg.cmd, evt: null, nonce: msg.nonce, data }],
          location.origin,
        );
      });
    });
    await page.route("**/daylight-discord", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><body style="margin:0"><iframe title="Discord Activity" src="/?frame_id=synthetic&instance_id=synthetic&platform=desktop#screen=flyer" style="border:0;width:100vw;height:100vh"></iframe></body></html>',
      }),
    );
    await page.route("**/api/auth/discord", (route) =>
      route.fulfill({
        json: {
          access_token: "synthetic-access",
          session: {
            token: "synthetic-session",
            expiresAt: "2099-01-01T00:00:00Z",
            user: {
              id: "61f11783-6200-4dfb-b1a6-a511c558e8a5",
              displayName: "Synthetic Discord",
              avatarUrl: null,
              identity: { platform: "discord", platformUserId: "111111111111111111" },
            },
          },
        },
      }),
    );
  }
  await page.goto(
    host === "discord" ? "/daylight-discord" : "/#tgWebAppData=synthetic&screen=flyer",
  );
  const root: Page | FrameLocator = host === "discord" ? page.frameLocator("iframe") : page;
  return { root, finishes: () => finishes, close: parent.close };
}
async function drive(page: Page, host: "discord" | "telegram", goal: number) {
  const frame =
    host === "discord" ? page.frames().find((f) => f !== page.mainFrame())! : page.mainFrame();
  await frame.evaluate((goal) => {
    const loop = () => {
      const canvas = document.querySelector<HTMLCanvasElement>(".flight-world canvas");
      if (!canvas) return;
      const held =
        Number(canvas.dataset.score ?? 0) < goal &&
        Number(canvas.dataset.y ?? 240000) + Number(canvas.dataset.velocity ?? 0) * 12 >
          Number(canvas.dataset.targetCenter ?? 240000);
      if (held !== (canvas.dataset.held === "true"))
        canvas.dispatchEvent(
          new KeyboardEvent(held ? "keydown" : "keyup", {
            code: "Space",
            key: " ",
            bubbles: true,
            cancelable: true,
          }),
        );
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, goal);
}
for (const host of ["telegram", "discord"] as const)
  for (const width of [390, 1440])
    for (const count of [3, 30])
      test(`Daylight ${host} ${width}px ${count} stocks: countdown, play and verified result`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        const f = await setup(page, count, host),
          root = f.root;
        try {
          await expect(
            root.getByRole("heading", { name: /mStocks.*FLYER/, exact: false }),
          ).toBeVisible();
          await root.getByRole("button", { name: en.flyer.tapPlay, exact: true }).click();
          const canvas = root.locator("canvas");
          await expect(canvas).toBeVisible();
          await expect(
            root.getByRole("button", { name: en.flyer.mute, exact: true }),
          ).toBeVisible();
          await root.getByRole("button", { name: en.flyer.mute, exact: true }).click();
          await expect(
            root.getByRole("button", { name: en.flyer.unmute, exact: true }),
          ).toHaveAttribute("aria-pressed", "true");
          await drive(page, host, 3);
          await expect
            .poll(async () => Number(await canvas.getAttribute("data-tick")))
            .toBeGreaterThan(200);
          await page.waitForTimeout(1500);
          await expect(root.locator(".flyer-status")).toHaveCount(0);
          if (capture && count === 3) {
            await mkdir(directory, { recursive: true });
            await page.screenshot({
              path: resolve(directory, `daylight-${host}-${width}.png`),
              fullPage: true,
            });
          }
          await expect(root.getByText(en.flyer.newBest, { exact: true })).toBeVisible({
            timeout: 25000,
          });
          expect(f.finishes()).toBe(1);
          await expect(root.getByText(en.flyer.gainers, { exact: true })).toBeVisible();
          if (capture && count === 3)
            await page.screenshot({
              path: resolve(directory, `result-${host}-${width}.png`),
              fullPage: true,
            });
          const frame =
            host === "discord"
              ? page.frames().find((fr) => fr !== page.mainFrame())!
              : page.mainFrame();
          expect(
            await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          const haptics = await frame.evaluate(
            () => Reflect.get(window, "daylightHaptics") as string[],
          );
          expect(haptics.length > 0).toBe(host === "telegram");
          if (capture && host === "telegram" && width === 390 && count === 3) {
            const video = page.video();
            await page.close();
            await video?.saveAs(resolve(directory, "daylight-flight.webm"));
          }
          await info.attach("course-size", { body: String(count), contentType: "text/plain" });
        } finally {
          await f.close();
        }
      });
test("Daylight 468-stock course stays within the emulated phone frame budget through refresh", async ({
  page,
  context,
}) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  const f = await setup(page, 468, "telegram");
  try {
    await page.getByRole("button", { name: en.flyer.tapPlay, exact: true }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await drive(page, "telegram", 100);
    await page.waitForTimeout(16000);
    const canvas = page.locator("canvas"),
      ticks = Number(await canvas.getAttribute("data-tick")),
      meanFrameWorkMs = Number(await canvas.getAttribute("data-frame-cost-ms"));
    expect(ticks).toBeGreaterThan(800);
    expect(meanFrameWorkMs).toBeLessThan(1000 / 60);
    expect(f.finishes()).toBe(0);
    if (capture)
      await writeFile(
        resolve(directory, "performance.json"),
        JSON.stringify(
          {
            environment: "Edge Chromium desktop emulation, not a physical phone",
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
            cpuThrottle: 4,
            catalogSize: 468,
            durationSeconds: 16,
            ticks,
            meanFrameWorkMs,
            frameBudgetMs: 1000 / 60,
          },
          null,
          2,
        ) + "\n",
      );
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await f.close();
  }
});
test("Daylight reduced motion still plays without Telegram vibration", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await setup(page, 3, "telegram");
  try {
    await page.getByRole("button", { name: en.flyer.tapPlay, exact: true }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await drive(page, "telegram", 1);
    await expect(page.getByText(en.flyer.newBest, { exact: true })).toBeVisible({ timeout: 25000 });
    expect(await page.evaluate(() => Reflect.get(window, "daylightHaptics"))).toEqual([]);
  } finally {
    await f.close();
  }
});
