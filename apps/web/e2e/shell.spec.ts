import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { en } from "../src/copy/en.js";

for (const width of [360, 768, 1024, 1440]) {
  test(`shell navigation and layout at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const apiRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
    });
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(en.auth.preview);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const columns = await page
      .locator(".arena-grid")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width >= 1024 ? 3 : width >= 768 ? 2 : 1);
    const nav = page.locator(width >= 1024 ? ".tabs-header" : ".tabs-bottom");
    await expect(nav).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`shell-${width}.png`), fullPage: true });
    await nav.getByRole("button", { name: en.tabs.leaderboard, exact: true }).click();
    await expect(page.getByRole("heading", { name: en.leaderboard.title, level: 1 })).toBeVisible();
    await expect(page.getByText(en.leaderboard.empty)).toBeVisible();
    await nav.getByRole("button", { name: en.tabs.profile, exact: true }).click();
    await expect(page.getByRole("heading", { name: en.auth.previewPlayer })).toBeVisible();
    await nav.getByRole("button", { name: en.tabs.play, exact: true }).click();
    await page.getByRole("button", { name: en.games.quiz.name }).click();
    await expect(page.locator("#active-title")).toHaveText(en.games.quiz.name);
    await expect(page.locator(".legal-notice")).toHaveText(en.regionNotice);
    await expect(page.locator(".legal-notice")).toHaveAttribute(
      "href",
      "https://assets.backed.fi/legal-documentation",
    );
    expect(await page.locator(".stock-logo-badge").count()).toBe(9);
    expect(errors).toEqual([]);
    expect(apiRequests).toEqual([]);
  });
}

test("production disables the local user and game buttons", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/");
  await expect(page.getByRole("status")).toHaveText(en.auth.errors.BROWSER_DISABLED);
  await expect(page.getByRole("button", { name: en.games.quiz.name })).toBeDisabled();
  await expect(page.getByText(en.auth.preview)).toHaveCount(0);
  await expect(page.locator(".legal-notice")).toHaveAttribute(
    "href",
    "https://assets.backed.fi/legal-documentation",
  );
});

async function telegramPage(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, { bridgeCalls: calls });
    window.Telegram = {
      WebApp: {
        initData: "mock-raw-init-data",
        colorScheme: "dark",
        themeParams: { bg_color: "#0b0e11", button_color: "#1fd59a" },
        ready() {
          calls.push("ready");
        },
        expand() {
          calls.push("expand");
        },
        openLink(url: string) {
          calls.push("open:" + url);
        },
        onEvent() {},
        setHeaderColor() {},
        setBackgroundColor() {},
      },
    };
  });
}
function session(displayName: string) {
  return {
    token: "mock-session",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    user: {
      id: "79703e93-9461-49ad-ae16-4d2a5af06126",
      displayName,
      avatarUrl: null,
      identity: { platform: "telegram", platformUserId: "123" },
    },
  };
}

test("Telegram production login uses the relative API and host links", async ({ page }) => {
  await telegramPage(page);
  let count = 0;
  await page.route("**/api/auth/telegram", async (route) => {
    count++;
    expect(route.request().postDataJSON()).toEqual({ initData: "mock-raw-init-data" });
    await route.fulfill({ json: { session: session("Telegram test player") } });
  });
  await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
  await expect(page.getByRole("status")).toContainText("Telegram test player");
  await page.getByRole("link", { name: en.labels.viewOnFluxion }).click();
  expect(await page.evaluate(() => Reflect.get(window, "bridgeCalls"))).toEqual([
    "ready",
    "expand",
    "open:https://app.fluxion.network/trade",
  ]);
  expect(count).toBe(1);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test("login errors show safe copy and a retry succeeds", async ({ page }) => {
  await telegramPage(page);
  let attempts = 0;
  await page.route("**/api/auth/telegram", async (route) => {
    attempts++;
    if (attempts === 1)
      await route.fulfill({ status: 503, json: { error: { code: "AUTH_UNAVAILABLE" } } });
    else await route.fulfill({ json: { session: session("Retry player") } });
  });
  await page.goto("/#tgWebAppData=mock");
  await expect(page.getByRole("status")).toContainText(en.auth.errors.CONFIGURATION_REQUIRED);
  await page.getByRole("button", { name: en.auth.retry }).click();
  await expect(page.getByRole("status")).toContainText("Retry player");
  expect(attempts).toBe(2);
});
