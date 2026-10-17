import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ASSETS } from "@stock-arena/game-core";
import type { AssetCatalog, CheckinView, HlView, PricesView } from "@stock-arena/game-core";
import { en } from "../src/copy/en.js";

test.use({ timezoneId: "America/Los_Angeles" });
let currentPrices: PricesView;
let streamUrl = "";
const streams = new Set<ServerResponse>();
const streamServer = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Accept",
    });
    response.end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.write(`event: prices\ndata: ${JSON.stringify(currentPrices)}\n\n`);
  streams.add(response);
  response.once("close", () => streams.delete(response));
});
test.beforeAll(async () => {
  await new Promise<void>((resolve) => streamServer.listen(0, "127.0.0.1", resolve));
  streamUrl = `http://127.0.0.1:${(streamServer.address() as AddressInfo).port}/stream`;
});
test.afterEach(() => {
  for (const stream of streams) stream.end();
  streams.clear();
});
test.afterAll(async () => {
  for (const stream of streams) stream.end();
  streamServer.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    streamServer.close((error) => (error ? reject(error) : resolve())),
  );
});
for (const count of [3, 30])
  for (const width of [360, 1440])
    test(`closed market preserves prices and explains reopening with ${count} assets at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const entries = Object.entries(ASSETS);
      const catalog: AssetCatalog = Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          i < entries.length ? entries[i]![0] : `TEST_${i}`,
          {
            ...entries[i % entries.length]![1],
            ...(i < entries.length ? {} : { name: `Synthetic ${i}`, symbol: `TEST_${i}` }),
          },
        ]),
      );
      const tickers = Object.keys(catalog),
        ticker = tickers[0]!;
      const serverTime = "2026-10-17T12:00:00.000Z",
        lastTime = "2026-10-16T20:00:00.000Z",
        opening = "2026-10-19T00:00:00.000Z";
      const checkin: CheckinView = {
        serverTime,
        day: "2026-10-17",
        checkedIn: false,
        streak: 3,
        balance: 100,
        awardsToday: [],
        catalog,
        stock: {
          ticker,
          asset: catalog[ticker]!,
          fact: "A synthetic company fact for interface testing.",
          price: {
            usd: "344.50",
            change24hPct: null,
            takenAt: lastTime,
            state: "paused",
            reason: "closed",
          },
        },
      };
      const hl: HlView = {
        serverTime,
        day: "2026-10-17",
        status: "paused",
        runsUsed: 0,
        runsLimit: 3,
        maxCorrect: 10,
        pointsPerCorrect: 5,
        run: null,
        round: null,
        feedback: null,
        paused: tickers.map((ticker) => ({ ticker, reason: "closed", nextChangeAt: opening })),
      };
      const prices: PricesView = {
        serverTime,
        catalog,
        prices: tickers.map((ticker) => ({
          ticker,
          priceUsd: "344.50",
          takenAt: lastTime,
          change24hPct: null,
          state: "paused",
          reason: "closed",
        })),
      };
      await page.addInitScript(() => {
        window.Telegram = {
          WebApp: {
            initData: "fake-closed-market-init-data",
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
              token: "fake-closed-market-session",
              expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
              user: {
                id: "61f11783-6200-4dfb-b1a6-a511c558e8a5",
                displayName: "Arena player",
                avatarUrl: null,
                identity: { platform: "telegram", platformUserId: "123" },
              },
            },
          },
        }),
      );
      await page.route("**/api/checkin", (route) => route.fulfill({ json: checkin }));
      await page.route("**/api/hl{,/**}", (route) => {
        expect(route.request().method()).toBe("GET");
        return route.fulfill({ json: hl });
      });
      await page.route("**/api/leaderboard?*", (route) =>
        route.fulfill({
          json: {
            period: "day",
            platform: "all",
            generatedAt: serverTime,
            startsAt: "2026-10-17T00:00:00.000Z",
            endsAt: "2026-10-18T00:00:00.000Z",
            season: {
              id: "season-1",
              startsAt: "2026-10-16T00:00:00.000Z",
              endsAt: null,
              ended: false,
            },
            top: [
              {
                userId: "61f11783-6200-4dfb-b1a6-a511c558e8a5",
                displayName: "Arena player",
                rank: 1,
                score: 100,
                reachedAt: serverTime,
              },
            ],
            caller: {
              userId: "61f11783-6200-4dfb-b1a6-a511c558e8a5",
              displayName: "Arena player",
              rank: 1,
              score: 100,
              reachedAt: serverTime,
            },
          },
        }),
      );
      currentPrices = prices;
      await page.route("**/api/prices/stream", (route) => route.continue({ url: streamUrl }));
      await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
      const card = page.locator(".featured-card");
      await expect(card.getByText("$344.50")).toBeVisible();
      await expect(card.getByText(en.checkin.lastPrice)).toBeVisible();
      await expect(card.getByText(en.status.marketClosed, { exact: true })).toBeVisible();
      await expect(page.locator(".price-row")).toHaveCount(count);
      await expect(
        page.locator(".prices-card").getByText(en.prices.closed, { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".price-row").first().getByText("$344.50")).toBeVisible();
      await expect(
        page.locator(".price-row").first().getByText(en.status.marketClosed, { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(".price-row").first().getByText(en.checkin.lastPrice),
      ).toBeVisible();
      await page.getByRole("button", { name: en.games.higherLower.name }).click();
      const panel = page.locator(".hl-panel");
      await expect(panel.getByRole("heading", { name: en.status.marketClosed })).toBeVisible();
      await expect(
        panel.getByText(en.hl.closedWithTime("2026-10-19 00:00 UTC"), { exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole("button", { name: en.hl.start })).toHaveCount(0);
      await expect(page.locator(".player-stats .points .number")).toHaveText("100");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.evaluate(() => document.fonts.ready);
      if (width === 360)
        await page.locator("#active-panel").evaluate((element) => {
          window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 20);
        });
      else await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`closed-${count}-${width}.png`),
        fullPage: width !== 360,
      });
    });
