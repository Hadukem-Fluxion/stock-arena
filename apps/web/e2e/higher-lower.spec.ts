import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ASSETS } from "@stock-arena/game-core";
import type { AssetCatalog, CheckinView, HlView } from "@stock-arena/game-core";
import { en } from "../src/copy/en.js";

const runId = "61f11783-6200-4dfb-b1a6-a511c558e8a5";
const roundId = "b21cb4bd-d22c-4879-9444-d9429cd80d4e";
function fixtures(count: number) {
  const catalog: AssetCatalog = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `STOCK_${i}`,
      {
        ...ASSETS.AAPL,
        name: `Company ${i + 1}`,
        symbol: `STOCK_${i}`,
        referenceTicker: `REF_${i}`,
      },
    ]),
  );
  const day = "2026-10-17",
    serverTime = `${day}T12:00:00.000Z`;
  const stocks: [
    NonNullable<HlView["round"]>["stocks"][0],
    NonNullable<HlView["round"]>["stocks"][0],
  ] = [
    { ticker: "STOCK_0", asset: catalog.STOCK_0!, priceUsd: "101.25" },
    { ticker: "STOCK_1", asset: catalog.STOCK_1!, priceUsd: "96.50" },
  ];
  const view: HlView = {
    day,
    serverTime,
    status: "ready",
    runsUsed: 0,
    runsLimit: 3,
    maxCorrect: 10,
    pointsPerCorrect: 5,
    run: null,
    round: null,
    feedback: null,
    paused: [],
  };
  const checkin: CheckinView = {
    day,
    serverTime,
    checkedIn: true,
    streak: 4,
    balance: 95,
    awardsToday: [{ amount: 10, reason: "checkin" }],
    catalog,
    stock: {
      ticker: "STOCK_0",
      asset: catalog.STOCK_0!,
      fact: "Synthetic company fact for a layout test.",
      price: {
        usd: "101.25",
        change24hPct: 1.25,
        takenAt: serverTime,
        state: "live",
        reason: null,
      },
    },
  };
  return { view, checkin, stocks };
}
async function setup(page: Page, count: number) {
  const fixture = fixtures(count);
  let view = fixture.view;
  let picks = 0;
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        initData: "fake-hl-init-data",
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
          token: "fake-hl-token",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          user: {
            id: runId,
            displayName: "Arena player",
            avatarUrl: null,
            identity: { platform: "telegram", platformUserId: "123" },
          },
        },
      },
    }),
  );
  await page.route("**/api/checkin", (route) => route.fulfill({ json: fixture.checkin }));
  await page.route("**/api/hl{,/**}", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer fake-hl-token");
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/start"))
      view = {
        ...view,
        status: "round",
        runsUsed: 1,
        run: { id: runId, number: 1, correctCount: 0, score: 0 },
        round: { id: roundId, position: 0, stocks: fixture.stocks },
      };
    if (path.endsWith("/pick")) {
      picks++;
      expect(route.request().postDataJSON()).toEqual({ runId, roundId, ticker: "STOCK_1" });
      view = {
        ...view,
        status: "feedback",
        run: { id: runId, number: 1, correctCount: 1, score: 5 },
        round: null,
        feedback: {
          correct: true,
          choice: "STOCK_1",
          winner: "STOCK_1",
          stocks: [
            { ...fixture.stocks[0], change24hPct: 1.25 },
            { ...fixture.stocks[1], change24hPct: -3.5 },
          ],
        },
      };
      fixture.checkin.balance = 100;
    }
    await route.fulfill({ json: view });
  });
  return {
    fixture,
    setView: (next: HlView) => {
      view = next;
    },
    picks: () => picks,
  };
}
for (const count of [3, 30])
  for (const width of [360, 1440])
    test(`HL ${count} assets at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const state = await setup(page, count);
      await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
      await page.getByRole("button", { name: en.games.higherLower.name }).click();
      const panel = page.locator(".hl-panel");
      await panel.getByRole("button", { name: en.hl.start }).click();
      await expect(panel.locator(".hl-stock")).toHaveCount(2);
      await expect(panel.getByText(en.hl.hiddenChange)).toHaveCount(2);
      await expect(panel.getByText("3.50%", { exact: false })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.evaluate(() => document.fonts.ready);
      if (width === 360) await panel.scrollIntoViewIfNeeded();
      else await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`hl-${count}-${width}.png`),
        fullPage: width !== 360,
      });
      await panel.getByRole("button", { name: "STOCK_1" }).click();
      await expect(panel.getByRole("status")).toHaveText(en.hl.correct);
      await expect(panel.getByText("▼ 3.50%")).toBeVisible();
      await expect(page.locator(".player-stats .points .number")).toHaveText("100");
      expect(state.picks()).toBe(1);
    });
test("HL pauses safely, then recovers on reload without consuming a run", async ({ page }) => {
  const state = await setup(page, 3);
  state.setView({
    ...state.fixture.view,
    status: "paused",
    paused: [
      { ticker: "STOCK_0", reason: "closed" },
      { ticker: "STOCK_1", reason: "divergence" },
    ],
  });
  await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
  await page.getByRole("button", { name: en.games.higherLower.name }).click();
  const panel = page.locator(".hl-panel");
  await expect(panel.getByText(en.status.marketClosed, { exact: false })).toBeVisible();
  await expect(panel.getByText(en.hl.paused)).toBeVisible();
  expect(state.picks()).toBe(0);
  state.setView(state.fixture.view);
  await panel.getByRole("button", { name: en.hl.retry }).click();
  await expect(panel.getByRole("button", { name: en.hl.start })).toBeVisible();
  expect(state.picks()).toBe(0);
});
