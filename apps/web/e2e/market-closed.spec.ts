import { expect, test } from "@playwright/test";
import { en } from "../src/copy/en.js";
import { setupPrediction } from "./prediction-fixture.js";
test.use({ timezoneId: "America/Los_Angeles" });
for (const count of [3, 30])
  for (const width of [360, 1440])
    test(`queued prediction ${count} assets at ${width}px`, async ({ page }, testInfo) => {
      const fixture = await setupPrediction(page, count, true);
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
        await expect(page.locator(".prices-card").getByText(en.prices.closed)).toBeVisible();
        await expect(page.locator(".price-row").first().getByText(en.prices.pool)).toBeVisible();
        await page.getByRole("button", { name: en.games.higherLower.name }).click();
        const panel = page.locator(".hl-panel");
        await panel.getByRole("button", { name: en.hl.start }).click();
        await panel.getByRole("button", { name: en.hl.up, exact: true }).click();
        await expect(panel.getByText(en.hl.waitingOpen, { exact: true })).toBeVisible();
        await expect(panel.getByText("2026-10-21 00:00 UTC", { exact: false })).toBeVisible();
        await expect(panel.getByText(en.hl.lastSession, { exact: true })).toHaveCount(0);
        await expect(panel.getByLabel(en.hl.countdown)).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (width === 360) await panel.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`queued-${count}-${width}.png`),
          fullPage: width !== 360,
        });
      } finally {
        await fixture.close();
      }
    });
