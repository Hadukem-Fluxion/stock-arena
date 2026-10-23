import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ASSETS } from "@stock-arena/game-core";
import type {
  AssetCatalog,
  CheckinView,
  LeaderboardPeriod,
  LeaderboardPlatform,
  LeaderboardView,
  PricesView,
} from "@stock-arena/game-core";
import { en } from "../src/copy/en.js";

const playerId = "61f11783-6200-4dfb-b1a6-a511c558e8a5";
const streams = new Set<ServerResponse>();
let frame: PricesView;
let connections = 0;
let address = "";
const fixtureServer = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Accept",
    });
    response.end();
    return;
  }
  connections++;
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  response.write(`event: prices\ndata: ${JSON.stringify(frame)}\n\n`);
  streams.add(response);
  response.once("close", () => streams.delete(response));
});
test.beforeAll(async () => {
  await new Promise<void>((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${(fixtureServer.address() as AddressInfo).port}`;
});
test.afterEach(() => {
  for (const stream of streams) stream.end();
  streams.clear();
});
test.afterAll(async () => {
  for (const stream of streams) stream.end();
  fixtureServer.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    fixtureServer.close((error) => (error ? reject(error) : resolve())),
  );
});
async function setup(page: Page, count: number) {
  const entries = Object.entries(ASSETS);
  const catalog: AssetCatalog = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      i < entries.length ? entries[i]![0] : `TEST_${i}`,
      {
        ...entries[i % entries.length]![1],
        ...(i < entries.length ? {} : { name: `Synthetic company ${i}`, symbol: `TEST_${i}` }),
      },
    ]),
  );
  const now = new Date().toISOString();
  const keys = Object.keys(catalog);
  const first = keys[0]!;
  frame = {
    serverTime: now,
    catalog,
    prices: keys.map((ticker, i) => ({
      ticker,
      priceUsd: String(100 + i),
      takenAt: now,
      change24hPct: i % 2 === 0 ? 1.25 : -2.5,
      state: i === 1 ? "paused" : "live",
      reason: i === 1 ? "closed" : null,
    })),
  };
  connections = 0;
  const checkin: CheckinView = {
    day: now.slice(0, 10),
    serverTime: now,
    checkedIn: true,
    streak: 4,
    balance: 120,
    awardsToday: [{ amount: 10, reason: "checkin" }],
    catalog,
    stock: {
      ticker: first,
      asset: catalog[first]!,
      fact: "A synthetic company fact for layout testing.",
      price: { usd: "100", takenAt: now, change24hPct: 1.25, state: "live", reason: null },
    },
  };
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        initData: "fake-ranking-init-data",
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
          token: "fake-ranking-e2e-token",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          user: {
            id: playerId,
            displayName: "Arena player",
            avatarUrl: null,
            identity: { platform: "telegram", platformUserId: "123" },
          },
        },
      },
    }),
  );
  await page.route("**/api/checkin", (route) => route.fulfill({ json: checkin }));
  await page.route("**/api/prices/stream", (route) => route.continue({ url: `${address}/stream` }));
  await page.route("**/api/leaderboard?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const period = params.get("period") as LeaderboardPeriod,
      platform = params.get("platform") as LeaderboardPlatform;
    const top = Array.from({ length: count }, (_, i) => ({
      userId:
        i === count - 1 ? playerId : `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      displayName: i === count - 1 ? "Arena player" : `Player ${i + 1}`,
      rank: i + 1,
      score: 120 + (count - 1 - i) * 25,
      reachedAt: now,
    }));
    const view: LeaderboardView = {
      period,
      platform,
      generatedAt: now,
      startsAt: "2026-10-16T00:00:00.000Z",
      endsAt: period === "season" ? null : "2026-10-20T00:00:00.000Z",
      season: {
        id: "season-1",
        startsAt: "2026-10-16T00:00:00.000Z",
        endsAt: period === "season" ? "2026-10-17T00:00:00.000Z" : null,
        ended: period === "season",
      },
      top,
      caller: top.at(-1)!,
    };
    return route.fulfill({ json: view });
  });
}
for (const count of [3, 30])
  for (const width of [360, 1440])
    test(`rankings and streamed ${count} assets at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page, count);
      await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
      await page
        .locator(".tabs-bottom")
        .getByRole("button", { name: en.tabs.markets, exact: true })
        .click();
      await expect(page.locator(".price-row")).toHaveCount(count);
      await expect(
        page.locator(".prices-card").getByText(en.prices.live, { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".price-row").first().getByText("$100.00")).toBeVisible();
      await expect(
        page.locator(".price-row").nth(1).getByText(en.status.marketClosed),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const nav = page.locator(".tabs-bottom");
      if (count === 3 && width === 1440) {
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: testInfo.outputPath("prices-desktop.png"), fullPage: true });
      }
      await nav.getByRole("button", { name: en.tabs.leaderboard, exact: true }).click();
      const panel = page.locator(".leaderboard-panel");
      await expect(panel.locator(".leaderboard-list").first().locator("li")).toHaveCount(count);
      await expect(
        panel.getByLabel(en.leaderboard.yourRank).getByText("Arena player", { exact: false }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      if (width === 360)
        await page.locator(".tab-panel").evaluate((element) => {
          window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 20);
        });
      else await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`leaderboard-${count}-${width}.png`),
        fullPage: width !== 360,
      });
      await panel.getByRole("button", { name: en.leaderboard.periods.week, exact: true }).click();
      await expect(
        panel.getByRole("button", { name: en.leaderboard.periods.week, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await panel
        .getByRole("button", { name: en.leaderboard.platforms.discord, exact: true })
        .click();
      await panel.getByRole("button", { name: en.leaderboard.periods.season, exact: true }).click();
      await expect(panel.getByText(en.leaderboard.seasonEnded)).toBeVisible();
    });
test("the SSE client reconnects after a dropped stream and receives a new price", async ({
  page,
}) => {
  await setup(page, 3);
  await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
  await page
    .locator(".tabs-bottom")
    .getByRole("button", { name: en.tabs.markets, exact: true })
    .click();
  await expect(page.locator(".price-row").first().getByText("$100.00")).toBeVisible();
  frame = {
    ...frame,
    serverTime: new Date().toISOString(),
    prices: frame.prices.map((price, i) => ({
      ...price,
      priceUsd: i === 0 ? "110" : price.priceUsd,
    })),
  };
  for (const stream of streams) stream.end();
  await expect.poll(() => connections).toBeGreaterThan(1);
  await expect(page.locator(".price-row").first().getByText("$110.00")).toBeVisible();
});
