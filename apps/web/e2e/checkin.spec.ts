import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ASSETS, assetTickers, stockOfTheDay } from "@stock-arena/game-core";
import type { AssetCatalog, CheckinView } from "@stock-arena/game-core";
import { en } from "../src/copy/en.js";

function viewFor(count: number, checkedIn = false): CheckinView {
  const catalog: AssetCatalog = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `STOCK_${index}`,
      {
        ...ASSETS.AAPL,
        name: `Company ${index}`,
        symbol: `STOCK_${index}`,
        referenceTicker: `REFERENCE_${index}`,
      },
    ]),
  );
  const ticker = stockOfTheDay("2026-10-15", assetTickers(catalog));
  return {
    serverTime: "2026-10-15T12:00:00.000Z",
    day: "2026-10-15",
    checkedIn,
    streak: checkedIn ? 7 : 6,
    balance: checkedIn ? 180 : 120,
    awardsToday: checkedIn
      ? [
          { amount: 10, reason: "checkin" },
          { amount: 50, reason: "streak_bonus_7" },
        ]
      : [],
    catalog,
    stock: {
      ticker,
      asset: catalog[ticker]!,
      fact: "A company fact from the server.",
      price: {
        usd: "110.50",
        change24hPct: -1.5,
        takenAt: "2026-10-15T12:00:00.000Z",
        state: "paused",
        reason: "closed",
      },
    },
  };
}
async function login(page: Page) {
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        initData: "test-init-data",
        colorScheme: "dark",
        themeParams: {},
        ready() {},
        expand() {},
        openLink() {},
        onEvent() {},
        setHeaderColor() {},
        setBackgroundColor() {},
      },
    };
  });
  await page.route("**/api/auth/telegram", (route) =>
    route.fulfill({
      json: {
        session: {
          token: "fake-checkin-token",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          user: {
            id: "79703e93-9461-49ad-ae16-4d2a5af06126",
            displayName: "Checkin player",
            avatarUrl: null,
            identity: { platform: "telegram", platformUserId: "123" },
          },
        },
      },
    }),
  );
}

for (const count of [3, 30])
  for (const width of [360, 1440])
    test(`check-in with ${count} assets at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page);
      let posts = 0;
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/checkin", async (route) => {
        expect(route.request().headers().authorization).toBe("Bearer fake-checkin-token");
        if (route.request().method() === "POST") {
          posts++;
          expect(route.request().postDataJSON()).toEqual({});
          await gate;
          await route.fulfill({ status: 201, json: viewFor(count, true) });
        } else await route.fulfill({ json: viewFor(count) });
      });
      await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
      await page
        .locator(".tabs-bottom")
        .getByRole("button", { name: en.tabs.markets, exact: true })
        .click();
      await expect(page.locator(".price-row")).toHaveCount(count);
      await page
        .locator(".tabs-bottom")
        .getByRole("button", { name: en.tabs.home, exact: true })
        .click();
      const card = page.locator(".featured-card");
      await expect(card.getByText("$110.50")).toBeVisible();
      await expect(card.getByText("▼ 1.50%")).toBeVisible();
      await expect(card.getByText(en.status.marketClosed)).toBeVisible();
      await expect(page.locator(".player-stats .points .number")).toHaveText("120");
      await card.getByRole("button", { name: en.navigation.checkin(10), exact: true }).click();
      await expect.poll(() => posts).toBe(1);
      await expect(
        card.getByRole("button", { name: en.checkin.saving, exact: true }),
      ).toBeDisabled();
      await expect(page.locator(".player-stats .points .number")).toHaveText("120");
      release();
      await expect(
        card.getByRole("button", { name: en.navigation.checkedIn(60), exact: true }),
      ).toBeDisabled();
      await expect(page.locator(".player-stats .points .number")).toHaveText("180");
      await expect(card.getByRole("button").first()).toHaveText(en.navigation.checkedIn(60));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole("button", { name: en.navigation.legal, exact: true }).click();
      await expect(page.getByRole("dialog").getByRole("link")).toHaveText(
        en.providers.xstocks.legalNotice,
      );
      await page.getByRole("button", { name: en.navigation.closeLegal }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`checkin-${count}-${width}.png`),
        fullPage: true,
      });
      expect(posts).toBe(1);
    });

test("a lost-response retry reloads the server's already-awarded check-in", async ({ page }) => {
  await login(page);
  let awarded = false;
  await page.route("**/api/checkin", async (route) => {
    if (route.request().method() === "POST") {
      awarded = true;
      await route.fulfill({ status: 409, json: { error: { code: "ALREADY_CHECKED_IN" } } });
    } else await route.fulfill({ json: viewFor(3, awarded) });
  });
  await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
  const card = page.locator(".featured-card");
  await card.getByRole("button", { name: en.navigation.checkin(10), exact: true }).click();
  await expect(
    card.getByRole("button", { name: en.navigation.checkedIn(60), exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".player-stats .points .number")).toHaveText("180");
});

test("an API failure does not award points locally and the player can retry", async ({ page }) => {
  await login(page);
  let failed = false;
  await page.route("**/api/checkin", async (route) => {
    if (route.request().method() === "POST" && !failed) {
      failed = true;
      await route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR" } } });
    } else await route.fulfill({ json: viewFor(3, route.request().method() === "POST") });
  });
  await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
  const card = page.locator(".featured-card");
  await card.getByRole("button", { name: en.navigation.checkin(10), exact: true }).click();
  await expect(card.getByRole("alert")).toContainText(en.checkin.errors.unavailable);
  await expect(page.locator(".player-stats .points .number")).toHaveText("120");
  await card.getByRole("button", { name: en.navigation.checkin(10), exact: true }).click();
  await expect(page.locator(".player-stats .points .number")).toHaveText("180");
});
