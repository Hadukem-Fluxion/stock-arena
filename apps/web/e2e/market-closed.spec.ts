import { expect, test } from "@playwright/test";
import { en } from "../src/copy/en.js";
import { setupPrediction } from "./prediction-fixture.js";
import { resolve } from "node:path";
test.use({ timezoneId: "America/Los_Angeles" });
for (const count of [3, 30])
  for (const width of [390, 1440])
    test(`empty closed market ${count} assets at ${width}px`, async ({ page }, info) => {
      const fixture = await setupPrediction(page, count, true);
      fixture.withoutPrimaryHistory();
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
        await expect(
          page.locator(".stock-card-content").getByText(en.prices.awaitingOpen),
        ).toBeVisible();
        await expect(
          page.locator(".stock-card-content").getByText(en.checkin.lastPrice),
        ).toHaveCount(0);
        if (count === 3) {
          await page.screenshot({
            path: info.outputPath(`empty-home-${width}.png`),
          });
          if (process.env.OHIO_REVIEW_CAPTURES === "1")
            await page.screenshot({
              path: resolve(`docs/review/ohio-follow-up/empty-home-${width}.png`),
            });
        }
        await page
          .locator(".tabs-bottom")
          .getByRole("button", { name: en.tabs.markets, exact: true })
          .click();
        const markets = page.locator(".prices-card");
        await expect(markets.getByRole("status")).toHaveText(en.prices.awaitingOpen);
        await expect(markets.getByText(en.prices.awaitingOpen, { exact: true })).toHaveCount(1);
        await expect(markets.getByText(en.checkin.lastPrice, { exact: true })).toHaveCount(0);
        await expect(markets.getByText(en.prices.closed, { exact: true })).toHaveCount(0);
        // An available pool remains informational and never fills a missing primary price.
        await expect(markets.locator(".pool-quote").first()).toContainText("$100.25");
        await expect(markets.locator(".live-price-value > .number").first()).toHaveText(
          en.labels.unknown,
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (count === 3 && process.env.OHIO_REVIEW_CAPTURES === "1")
          await page.screenshot({
            path: resolve(`docs/review/ohio-follow-up/empty-markets-${width}.png`),
            fullPage: true,
          });
      } finally {
        await fixture.close();
      }
    });

test("missing prices during an outage do not claim a market reopening", async ({ page }) => {
  const fixture = await setupPrediction(page, 3);
  fixture.withoutPrimaryHistory("stale");
  try {
    await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
    await expect(
      page.locator(".stock-card-content").getByText(en.checkin.priceUnavailable),
    ).toBeVisible();
    await expect(page.getByText(en.prices.awaitingOpen)).toHaveCount(0);
    await page
      .locator(".tabs-bottom")
      .getByRole("button", { name: en.tabs.markets, exact: true })
      .click();
    await expect(page.getByText(en.prices.awaitingOpen)).toHaveCount(0);
  } finally {
    await fixture.close();
  }
});

for (const count of [3, 30])
  for (const width of [360, 1440])
    test(`queued prediction ${count} assets at ${width}px`, async ({ page }, testInfo) => {
      const fixture = await setupPrediction(page, count, true);
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
        await page
          .locator(".tabs-bottom")
          .getByRole("button", { name: en.tabs.markets, exact: true })
          .click();
        await expect(page.locator(".prices-card").getByText(en.prices.closed)).toBeVisible();
        await expect(page.locator(".price-row").first().getByText(en.prices.pool)).toBeVisible();
        await page
          .locator(".tabs-bottom")
          .getByRole("button", { name: en.tabs.home, exact: true })
          .click();
        await page.getByRole("button", { name: en.games.higherLower.name }).click();
        const panel = page.locator(".hl-panel");
        await panel.getByRole("button", { name: en.hl.start }).click();
        await panel.getByRole("button", { name: en.hl.up, exact: true }).click();
        await expect(panel.getByText(en.hl.waitingOpen, { exact: true })).toBeVisible();
        await expect(panel.getByText("2026-10-21 00:00 UTC", { exact: false })).toBeVisible();
        await expect(panel.getByText(/Which stock moved more/)).toHaveCount(0);
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
