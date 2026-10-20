import { expect, test } from "@playwright/test";
import { en } from "../src/copy/en.js";
import { setupPrediction } from "./prediction-fixture.js";

for (const [change, displayed] of [
  ["-0.37", "-0.37%"],
  ["0", "0.00%"],
] as const)
  test(`formats a ${change} price move with two decimal places`, async ({ page }) => {
    const fixture = await setupPrediction(page, 3);
    try {
      await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
      await page.getByRole("button", { name: en.games.higherLower.name }).click();
      const panel = page.locator(".hl-panel");
      await panel.getByRole("button", { name: en.hl.start }).click();
      await panel.getByRole("button", { name: en.hl.up, exact: true }).click();
      await expect(panel.getByText(en.hl.pending, { exact: true })).toBeVisible();
      fixture.resolve(change);
      await page.reload();
      await page.getByRole("button", { name: en.games.higherLower.name }).click();
      await expect(panel.getByText(`${en.hl.move}: ${displayed}`, { exact: true })).toBeVisible();
    } finally {
      await fixture.close();
    }
  });

test("refreshes the balance on worker settlement even when older scored history expires", async ({
  page,
}) => {
  const fixture = await setupPrediction(page, 3);
  fixture.includeExpiringHistory();
  try {
    await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
    await page.getByRole("button", { name: en.games.higherLower.name }).click();
    const panel = page.locator(".hl-panel");
    await panel.getByRole("button", { name: en.hl.start }).click();
    await panel.getByRole("button", { name: en.hl.up, exact: true }).click();
    await expect(panel.getByText(en.hl.pending, { exact: true })).toBeVisible();
    await expect(page.locator(".player-stats .points .number")).toHaveText("95");
    fixture.resolve();
    await expect(panel.getByText(en.hl.results.won, { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(".player-stats .points .number")).toHaveText("100");
  } finally {
    await fixture.close();
  }
});
for (const count of [3, 30])
  for (const width of [360, 1440])
    test(`Up/Down ${count} assets at ${width}px`, async ({ page }, testInfo) => {
      const fixture = await setupPrediction(page, count);
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
        await page.getByRole("button", { name: en.games.higherLower.name }).click();
        const panel = page.locator(".hl-panel");
        await expect(panel.locator(".prediction-slot")).toHaveCount(3);
        await panel.getByRole("button", { name: en.hl.start }).click();
        await expect(panel.getByText(en.hl.question("STOCK_0"), { exact: true })).toBeVisible();
        await panel.getByRole("button", { name: en.hl.up, exact: true }).click();
        await expect(panel.getByText(en.hl.pending, { exact: true })).toBeVisible();
        await expect(panel.getByLabel(en.hl.countdown)).toBeVisible();
        expect(fixture.picks()).toBe(1);
        await page.reload();
        await page.getByRole("button", { name: en.games.higherLower.name }).click();
        await expect(panel.getByText(en.hl.pending, { exact: true })).toBeVisible();
        await expect(page.locator(".price-row")).toHaveCount(count);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.evaluate(() => document.fonts.ready);
        if (width === 360)
          await page
            .locator("#active-panel")
            .evaluate((element) =>
              window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 20),
            );
        else await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: testInfo.outputPath(`prediction-${count}-${width}.png`),
          fullPage: width !== 360,
        });
        fixture.resolve();
        await page.reload();
        await page.getByRole("button", { name: en.games.higherLower.name }).click();
        await expect(panel.getByText(en.hl.results.won, { exact: true })).toBeVisible();
        await expect(panel.getByText("$101.00", { exact: false })).toBeVisible();
        await expect(panel.getByText(`${en.hl.move}: +1.00%`, { exact: true })).toBeVisible();
        await expect(page.locator(".player-stats .points .number")).toHaveText("100");
        if (width === 360) await panel.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`prediction-result-${count}-${width}.png`),
          fullPage: width !== 360,
        });
      } finally {
        await fixture.close();
      }
    });
