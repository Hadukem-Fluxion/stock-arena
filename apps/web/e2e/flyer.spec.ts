import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { replayFlyer } from "@stock-arena/game-core";
import type { FlyerInput } from "@stock-arena/game-core";
import { syntheticFlyerCourse } from "../../../packages/game-core/src/testing/flyer-fixture.js";
import { en } from "../src/copy/en.js";
import { setupPrediction } from "./prediction-fixture.js";
const c = en.flyer,
  sessionId = "a1000000-0000-4000-8000-000000000001";
test.use({ video: { mode: "on", size: { width: 390, height: 844 } } });
async function fixture(page: Page, count = 3, maintenance = false, lastSession = false) {
  const host = await setupPrediction(page, count),
    course = syntheticFlyerCourse(count);
  if (lastSession)
    for (const segment of course.segments) {
      segment.lastSession = true;
      segment.windowEndsAt = "2026-10-23T21:00:00Z";
    }
  let best = 0,
    paid = 0,
    active = false;
  const finishes: { ticks: number; score: number; inputs: FlyerInput[] }[] = [];
  await page.route("**/api/flyer{,/**}", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path.endsWith("/start")) {
      active = true;
      return route.fulfill({
        json: {
          id: sessionId,
          startedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          maxTicks: 36000,
          course,
        },
      });
    }
    if (path.endsWith("/cancel")) {
      active = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/finish")) {
      const body = req.postDataJSON() as { ticks: number; score: number; inputs: FlyerInput[] };
      finishes.push(body);
      const result = replayFlyer(course, body.inputs, body.ticks, 36000);
      expect(result.score).toBe(body.score);
      const previous = best;
      best = Math.max(best, result.score);
      const delta = Math.min(50, best) - paid;
      paid += delta;
      active = false;
      return route.fulfill({
        json: {
          id: sessionId,
          day: "2026-10-25",
          score: result.score,
          best,
          pointsAwarded: delta,
          pointsToday: paid,
          newBest: best > previous,
          course,
        },
      });
    }
    if (path.endsWith("/leaderboard"))
      return route.fulfill({
        json: {
          period: new URL(req.url()).searchParams.get("period"),
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
        day: "2026-10-25",
        best,
        pointsToday: paid,
        dailyCap: 50,
        maintenance,
        available: true,
        canStart: !active && !maintenance,
        active: active
          ? {
              id: sessionId,
              startedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 600000).toISOString(),
            }
          : null,
      },
    });
  });
  return { close: host.close, course, finishes };
}
async function drive(page: Page, goal: number) {
  await page.evaluate((goal) => {
    let stop = false;
    Reflect.set(window, "stopFlyerReview", () => {
      stop = true;
    });
    const loop = () => {
      const canvas = document.querySelector<HTMLCanvasElement>(".flyer-stage canvas");
      if (stop || !canvas) return;
      const next =
        Number(canvas.dataset.score ?? 0) < goal &&
        Number(canvas.dataset.y ?? 240000) + Number(canvas.dataset.velocity ?? 0) * 12 >
          Number(canvas.dataset.targetCenter ?? 240000);
      if (next !== (canvas.dataset.held === "true")) {
        canvas.dispatchEvent(
          new KeyboardEvent(next ? "keydown" : "keyup", {
            code: "Space",
            key: " ",
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, goal);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    (document.activeElement as HTMLElement | null)?.blur();
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(name), fullPage: true });
  if (process.env.T27_REVIEW_CAPTURES === "1")
    await page.screenshot({ path: resolve("docs/review/t27", name), fullPage: true });
}
for (const width of [390, 1440])
  for (const count of [3, 30])
    test(`Flyer ${width}px catalog ${count}: playable chart, replay and verified result`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const f = await fixture(page, count);
      try {
        await page.goto("/#tgWebAppData=synthetic");
        await page.getByRole("button", { name: en.games.flyer.name }).click();
        await page.getByRole("button", { name: c.start, exact: true }).click();
        const canvas = page
          .getByRole("application", { name: c.canvas })
          .or(page.getByLabel(c.canvas));
        await expect(canvas).toBeVisible();
        await drive(page, 3);
        await expect.poll(() => canvas.getAttribute("data-tick")).not.toBeNull();
        await page.waitForTimeout(3500);
        await capture(page, info, `flyer-${width}-${count}.png`);
        await expect(page.getByText(c.newBest, { exact: true })).toBeVisible({ timeout: 20000 });
        expect(f.finishes).toHaveLength(1);
        expect(f.finishes[0]!.score).toBeGreaterThan(0);
        await capture(page, info, `flyer-result-${width}-${count}.png`);
        await page.getByRole("button", { name: en.navigation.back, exact: true }).click();
        await expect(page.locator(".shell")).toHaveAttribute("data-screen", "home");
      } finally {
        await f.close();
      }
    });
for (const width of [390, 1440])
  test(`Flyer last session label survives replay and result at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const f = await fixture(page, 3, false, true);
    try {
      await page.goto("/#tgWebAppData=synthetic&screen=flyer");
      await page.getByRole("button", { name: c.start, exact: true }).click();
      await expect(page.locator(".flyer-status")).toContainText(c.lastSession);
      await drive(page, 1);
      await expect
        .poll(async () => Number(await page.locator("canvas").getAttribute("data-tick")))
        .toBeGreaterThan(150);
      await capture(page, info, `flyer-last-session-${width}.png`);
      await expect(page.getByText(c.newBest, { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator(".flyer-chart").getByText(c.lastSession, { exact: true }),
      ).toBeVisible();
      expect(f.finishes).toHaveLength(1);
      await capture(page, info, `flyer-last-session-result-${width}.png`);
    } finally {
      await f.close();
    }
  });
test("Flyer releases outside canvas, blocks touch menus and remains usable in landscape", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const f = await fixture(page);
  try {
    await page.goto("/#tgWebAppData=synthetic&screen=flyer");
    await page.getByRole("button", { name: c.start, exact: true }).click();
    const canvas = page.locator(".flyer-stage canvas");
    await canvas.scrollIntoViewIfNeeded();
    await canvas.dispatchEvent("pointerdown", { button: 0, isPrimary: true });
    await expect(canvas).toHaveAttribute("data-held", "true");
    await page.dispatchEvent("body", "pointerup", { button: 0 });
    await expect(canvas).toHaveAttribute("data-held", "false");
    const prevented = await canvas.evaluate((el) => {
      const touch = new Event("touchstart", { bubbles: true, cancelable: true }),
        menu = new Event("contextmenu", { bubbles: true, cancelable: true });
      el.dispatchEvent(touch);
      el.dispatchEvent(menu);
      window.dispatchEvent(new Event("touchend"));
      return {
        touch: touch.defaultPrevented,
        menu: menu.defaultPrevented,
        action: getComputedStyle(el).touchAction,
        select: getComputedStyle(el).userSelect,
      };
    });
    expect(prevented).toEqual({ touch: true, menu: true, action: "none", select: "none" });
    await capture(page, info, "flyer-landscape.png");
  } finally {
    await f.close();
  }
});
test("Flyer keeps its flight through the 15-second parent refresh and meets the emulated phone frame budget", async ({
  page,
  context,
}) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page, 30);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  try {
    await page.goto("/#tgWebAppData=synthetic&screen=flyer");
    await page.getByRole("button", { name: c.start, exact: true }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await drive(page, 100);
    await page.waitForTimeout(16000);
    expect(Number(await page.locator("canvas").getAttribute("data-tick"))).toBeGreaterThan(800);
    const meanFrameWorkMs = Number(await page.locator("canvas").getAttribute("data-frame-cost-ms"));
    expect(meanFrameWorkMs).toBeLessThan(1000 / 60);
    if (process.env.T27_REVIEW_CAPTURES === "1")
      await writeFile(
        resolve("docs/review/t27/performance.json"),
        JSON.stringify(
          {
            environment: "Chromium desktop emulation, not a physical phone",
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
            cpuThrottle: 4,
            catalogSize: 30,
            durationSeconds: 16,
            ticks: Number(await page.locator("canvas").getAttribute("data-tick")),
            meanFrameWorkMs,
            frameBudgetMs: 1000 / 60,
          },
          null,
          2,
        ) + "\n",
      );
    expect(f.finishes).toEqual([]);
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await f.close();
  }
});
for (const width of [390, 1440])
  test(`Flyer getting charts ready at ${width}px retries without a broken Home card`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const f = await fixture(page);
    let attempts = 0;
    await page.route("**/api/flyer/start", async (route) => {
      attempts++;
      if (attempts === 1)
        return route.fulfill({ status: 503, json: { error: { code: "FLYER_UNAVAILABLE" } } });
      return route.fallback();
    });
    try {
      await page.goto("/#tgWebAppData=synthetic");
      const card = page.getByRole("button", { name: en.games.flyer.name });
      await expect(card).toBeEnabled();
      await card.click();
      await page.getByRole("button", { name: c.start, exact: true }).click();
      await expect(page.getByText(c.gettingCharts, { exact: true })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await capture(page, info, `flyer-getting-charts-${width}.png`);
      await page.getByRole("button", { name: c.retry, exact: true }).click();
      await expect(page.locator(".flyer-stage canvas")).toBeVisible();
      expect(attempts).toBe(2);
      await page.getByRole("button", { name: en.navigation.back, exact: true }).click();
      await expect(card).toBeEnabled();
    } finally {
      await f.close();
    }
  });
test("Flyer browser preview cannot start or submit, and maintenance blocks start", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/flyer")) requested.push(req.url());
  });
  await page.goto("/#screen=flyer");
  await expect(page.getByText(c.preview)).toBeVisible();
  expect(requested).toEqual([]);
  const f = await fixture(page, 3, true);
  try {
    await page.goto("/#tgWebAppData=synthetic&screen=flyer");
    await page.reload();
    await expect(page.getByText(en.maintenance)).toBeVisible();
    await expect(page.getByRole("button", { name: c.start, exact: true })).toBeDisabled();
  } finally {
    await f.close();
  }
});
test.describe("Flyer review recording", () => {
  test("records a short synthetic flight with the supplied Fluxion symbol", async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const f = await fixture(page);
    try {
      await page.goto("/#tgWebAppData=synthetic&screen=flyer");
      await page.getByRole("button", { name: c.start, exact: true }).click();
      await expect(page.locator("canvas")).toBeVisible();
      await drive(page, 3);
      await expect(page.getByText(c.newBest, { exact: true })).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(500);
      const video = page.video();
      await page.close();
      if (process.env.T27_REVIEW_CAPTURES === "1" && video)
        await video.saveAs(resolve("docs/review/t27/flyer-flight.webm"));
      await info.attach("synthetic-flight", {
        path: await video!.path(),
        contentType: "video/webm",
      });
    } finally {
      await f.close();
    }
  });
});
