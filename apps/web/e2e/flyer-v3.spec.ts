import { expect, test } from "@playwright/test";
import type { Page, Frame } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setupV3 } from "./flyer-v3-fixture.js";
import { en } from "../src/copy/en.js";
const copy = en.flyer,
  capture = process.env.T37_REVIEW_CAPTURES === "1",
  dir = resolve("docs/review/t37");
test.use({ video: { mode: "on", size: { width: 390, height: 844 } } });
function frame(page: Page, host: string) {
  return host === "discord" ? page.frames().find((f) => f !== page.mainFrame())! : page.mainFrame();
}
async function fit(f: Frame) {
  const content = f.locator(".flight-content");
  if (await content.count())
    expect(
      await content.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight + 1;
      }),
    ).toBe(true);
  expect(
    await f.evaluate(
      () =>
        document.documentElement.scrollHeight <= innerHeight &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await f
      .locator(".flight-screen")
      .evaluate((el) => Math.abs(el.getBoundingClientRect().height - innerHeight) < 2),
  ).toBe(true);
}
async function drive(f: Frame, goal: number) {
  await f.locator("canvas").press("Space");
  await f.evaluate((goal) => {
    let done = false;
    const loop = () => {
      const canvas = document.querySelector<HTMLCanvasElement>(".flight-world canvas");
      if (done || !canvas || document.querySelector('[data-flight-screen="result"]')) return;
      const pipes = Number(canvas.dataset.pipes ?? 0),
        velocity = Number(canvas.dataset.velocity ?? 0),
        y = Number(canvas.dataset.y ?? 240000),
        center = Number(canvas.dataset.targetCenter ?? 240000),
        tick = Number(canvas.dataset.tick ?? 0);
      if (tick === 0 || (pipes < goal && velocity > 0 && y + velocity * 3 > center + 10000))
        canvas.dispatchEvent(
          new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }),
        );
      if (pipes >= goal) done = true;
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, goal);
}
for (const host of ["telegram", "discord"] as const)
  for (const [width, height] of [
    [390, 844],
    [360, 640],
    [1440, 900],
  ])
    for (const count of [3, 30])
      test(`Flyer v3 ${host} ${width}x${height}, ${count} assets: start/play/result without scroll`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width: width!, height: height! });
        const f = await setupV3(page, count, host),
          root = f.root;
        try {
          await expect(root.getByRole("button", { name: copy.tapPlay, exact: true })).toBeEnabled();
          const activeFrame = frame(page, host);
          await fit(activeFrame);
          await expect(root.locator(".app-header")).toBeHidden();
          await expect(root.locator(".tabs-bottom")).toBeHidden();
          if (capture && count === 3) {
            await mkdir(dir, { recursive: true });
            await page.screenshot({ path: resolve(dir, `start-${host}-${width}.png`) });
          }
          await root.getByRole("button", { name: copy.howTo, exact: true }).click();
          await expect(root.getByRole("dialog")).toContainText(copy.v3Rules);
          await root.getByRole("button", { name: copy.close, exact: true }).click();
          await root.getByRole("button", { name: copy.tapPlay, exact: true }).click();
          const canvas = root.locator("canvas");
          await expect(root.getByText(copy.tapHint, { exact: true })).toBeVisible();
          await fit(activeFrame);
          await drive(activeFrame, 4);
          await expect(root.getByText(copy.tapHint, { exact: true })).toBeHidden();
          await expect
            .poll(async () => Number(await canvas.getAttribute("data-tick")))
            .toBeGreaterThan(160);
          if (capture && count === 3)
            await page.screenshot({ path: resolve(dir, `play-${host}-${width}.png`) });
          await expect(
            root.getByRole("heading", { name: copy.gameOver.toUpperCase(), exact: true }),
          ).toBeVisible({ timeout: 20000 });
          expect(f.finishes()).toBe(1);
          await fit(activeFrame);
          await expect(root.getByText(copy.chartTitle, { exact: true })).toBeVisible();
          await expect(root.getByRole("img", { name: /price chart/ }).first()).toBeVisible();
          const budget = Number(await canvas.getAttribute("data-frame-cost-ms"));
          expect(budget).toBeGreaterThan(0);
          expect(budget).toBeLessThan(1000 / 60);
          await info.attach("frame-cost", { body: String(budget), contentType: "text/plain" });
          if (host === "telegram")
            expect(
              await activeFrame.evaluate(() => Reflect.get(window, "flightHostCalls")),
            ).toEqual(["fullscreen", "disable", "enable", "exit"]);
          if (capture && count === 3)
            await page.screenshot({ path: resolve(dir, `result-${host}-${width}.png`) });
          await root.getByRole("button", { name: copy.ranks, exact: true }).click();
          await expect(root.getByRole("dialog", { name: copy.rankings })).toBeVisible();
          await root.getByRole("button", { name: copy.close, exact: true }).click();
          await root.getByRole("button", { name: copy.home, exact: true }).click();
          await expect(root.locator(".shell")).toHaveAttribute("data-screen", "home");
          expect(await activeFrame.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
          if (capture && host === "telegram" && width === 390 && count === 3) {
            const video = page.video();
            await page.close();
            await video?.saveAs(resolve(dir, "flyer-v3-flight.webm"));
          }
        } finally {
          await f.close();
        }
      });
test("Flyer v3 ends on visibility loss", async ({ page }) => {
  const f = await setupV3(page, 3, "telegram");
  try {
    await page.getByRole("button", { name: copy.tapPlay, exact: true }).click();
    await page.locator("canvas").press("Space");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(
      page.getByRole("heading", { name: copy.gameOver.toUpperCase(), exact: true }),
    ).toBeVisible();
    expect(f.finishes()).toBe(1);
  } finally {
    await f.close();
  }
});

test("Flyer v3 shows frozen-history fallback and survives resize without resetting the replay", async ({
  page,
}) => {
  const f = await setupV3(page, 3, "telegram", false);
  try {
    await page.getByRole("button", { name: copy.tapPlay, exact: true }).click();
    await drive(page.mainFrame(), 1);
    await expect
      .poll(async () => Number(await page.locator("canvas").getAttribute("data-tick")))
      .toBeGreaterThan(120);
    await page.setViewportSize({ width: 844, height: 390 });
    await fit(page.mainFrame());
    await expect(
      page.getByRole("heading", { name: copy.gameOver.toUpperCase(), exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(copy.noChart, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("img", { name: /price chart/ })).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test("Flyer v3 full-catalog frame work stays within budget at 4x CPU throttle", async ({
  page,
  context,
}) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const f = await setupV3(page, 468, "telegram");
  try {
    await page.getByRole("button", { name: copy.tapPlay, exact: true }).click();
    await drive(page.mainFrame(), 100);
    await page.waitForTimeout(16000);
    const canvas = page.locator("canvas"),
      ticks = Number(await canvas.getAttribute("data-tick")),
      meanFrameWorkMs = Number(await canvas.getAttribute("data-frame-cost-ms"));
    expect(ticks).toBeGreaterThan(800);
    expect(meanFrameWorkMs).toBeGreaterThan(0);
    expect(meanFrameWorkMs).toBeLessThan(1000 / 60);
    expect(f.finishes()).toBe(0);
    if (capture) {
      await mkdir(dir, { recursive: true });
      await writeFile(
        resolve(dir, "performance.json"),
        JSON.stringify(
          {
            environment: "Edge Chromium desktop emulation, not a physical phone",
            viewport: { width: 390, height: 844 },
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
    }
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await f.close();
  }
});
test.describe("Flyer v3 touch input", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("one touch makes one flap; compatibility/repeat events do not duplicate it", async ({
    page,
  }) => {
    const f = await setupV3(page, 3, "telegram");
    try {
      await page.getByRole("button", { name: copy.tapPlay, exact: true }).click();
      await page.touchscreen.tap(180, 400);
      await expect(page.getByText(copy.tapHint, { exact: true })).toBeHidden();
      await page.locator("canvas").dispatchEvent("keydown", { code: "Space", repeat: true });
      const finish = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/flyer/finish");
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      const body = (await finish).postDataJSON() as { inputs: { action: string }[] };
      expect(body.inputs).toHaveLength(1);
      expect(body.inputs[0]?.action).toBe("flap");
      await expect(
        page.getByRole("heading", { name: copy.gameOver.toUpperCase(), exact: true }),
      ).toBeVisible();
    } finally {
      await f.close();
    }
  });
});

test("Flyer fullscreen keeps login error and retry reachable", async ({ page }) => {
  const f = await setupV3(page, 3, "telegram");
  let attempts = 0;
  await page.route("**/api/auth/telegram", (route) =>
    ++attempts === 1
      ? route.fulfill({ status: 503, json: { error: { code: "AUTH_UNAVAILABLE" } } })
      : route.fallback(),
  );
  try {
    await page.reload();
    const retry = page.getByRole("button", { name: en.auth.retry, exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.getByRole("button", { name: copy.tapPlay, exact: true })).toBeEnabled();
    await expect(retry).toBeHidden();
  } finally {
    await f.close();
  }
});
