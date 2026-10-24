import type { Page } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ASSETS } from "@stock-arena/game-core";
import type { AssetCatalog, CheckinView, PredictionView, PricesView } from "@stock-arena/game-core";
const id = "61f11783-6200-4dfb-b1a6-a511c558e8a5",
  roundId = "b21cb4bd-d22c-4879-9444-d9429cd80d4e";
export async function setupPrediction(page: Page, count: number, closed = false) {
  const serverTime = "2026-10-20T12:00:00.000Z",
    day = "2026-10-20";
  const catalog: AssetCatalog = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `STOCK_${i}`,
      {
        ...Object.values(ASSETS)[i % Object.keys(ASSETS).length]!,
        name: `Company ${i + 1}`,
        symbol: `STOCK_${i}`,
        referenceTicker: `REF_${i}`,
      },
    ]),
  );
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
      fact: "Synthetic company fact for interface testing.",
      price: {
        usd: "100",
        change24hPct: closed ? null : 1.25,
        takenAt: serverTime,
        state: closed ? "paused" : "live",
        reason: closed ? "closed" : null,
      },
    },
  };
  const prices: PricesView = {
    serverTime,
    catalog,
    prices: Object.keys(catalog).map((ticker, i) => ({
      ticker,
      priceUsd: "100",
      takenAt: serverTime,
      change24hPct: closed ? null : 1.25,
      state: closed ? "paused" : "live",
      reason: closed ? "closed" : null,
      pool: closed && i === 0 ? { priceUsd: "100.25", takenAt: serverTime } : null,
    })),
  };
  let view: PredictionView = {
    day,
    serverTime,
    runsUsed: 0,
    runsLimit: 3,
    maxCorrect: 10,
    pointsPerCorrect: 5,
    canStart: true,
    runs: [],
  };
  let picks = 0;
  const stream = createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Accept",
      });
      response.end();
      return;
    }
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    });
    response.write(`event: prices\ndata: ${JSON.stringify(prices)}\n\n`);
  });
  await new Promise<void>((resolve) => stream.listen(0, "127.0.0.1", resolve));
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        initData: "fake-prediction-init-data",
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
          token: "fake-prediction-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
          user: {
            id,
            displayName: "Arena player",
            avatarUrl: null,
            identity: { platform: "telegram", platformUserId: "123" },
          },
        },
      },
    }),
  );
  await page.route("**/api/checkin", (route) => route.fulfill({ json: checkin }));
  await page.route("**/api/prices/stream", (route) =>
    route.continue({ url: `http://127.0.0.1:${(stream.address() as AddressInfo).port}/stream` }),
  );
  await page.route("**/api/leaderboard?*", (route) =>
    route.fulfill({
      json: {
        period: "day",
        platform: "all",
        generatedAt: serverTime,
        startsAt: `${day}T00:00:00.000Z`,
        endsAt: "2026-10-21T00:00:00.000Z",
        season: {
          id: "season-1",
          startsAt: "2026-10-16T00:00:00.000Z",
          endsAt: null,
          ended: false,
        },
        top: [],
        caller: null,
      },
    }),
  );
  await page.route("**/api/hl{,/**}", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/start")) {
      const number = view.runsUsed + 1;
      view = {
        ...view,
        runsUsed: number,
        canStart: number < view.runsLimit,
        runs: [
          {
            id: number === 1 ? id : `80000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
            day,
            number,
            correctCount: 0,
            score: 0,
            canPick: true,
            endedAt: null,
            expiresAt: "2026-10-21T12:00:00.000Z",
            round: {
              id:
                number === 1
                  ? roundId
                  : `81000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
              ticker: "STOCK_0",
              asset: catalog.STOCK_0!,
              state: "offered",
              direction: null,
              lockedAt: null,
              scheduledOpenAt: null,
              startPrice: null,
              startTakenAt: null,
              targetAt: null,
              endPrice: null,
              endTakenAt: null,
              settledAt: null,
              changePct: null,
            },
          },
          ...view.runs,
        ],
      };
    }
    if (path.endsWith("/pick")) {
      picks++;
      const input = route.request().postDataJSON() as { runId: string; direction: "up" | "down" };
      const entry = view.runs.find((run) => run.id === input.runId)!;
      entry.canPick = false;
      const round = entry.round!;
      Object.assign(round, {
        state: closed ? "waiting_open" : "pending",
        direction: input.direction,
        lockedAt: serverTime,
        scheduledOpenAt: closed ? "2026-10-21T00:00:00.000Z" : null,
        startPrice: closed ? null : "100",
        startTakenAt: closed ? null : "2026-10-20T12:00:15.000Z",
        targetAt: closed ? null : "2026-10-20T12:15:15.000Z",
      });
      if (!closed) view.serverTime = "2026-10-20T12:00:15.000Z";
    }
    return route.fulfill({ json: view });
  });
  return {
    catalog,
    picks: () => picks,
    withoutPrimaryHistory(reason: "closed" | "stale" = "closed") {
      Object.assign(checkin.stock.price, {
        usd: null,
        takenAt: null,
        change24hPct: null,
        state: "paused",
        reason,
      });
      for (const quote of prices.prices)
        Object.assign(quote, {
          priceUsd: null,
          takenAt: null,
          change24hPct: null,
          state: "paused",
          reason,
        });
    },
    pause() {
      view.maintenance = true;
      view.canStart = false;
      for (const run of view.runs) run.canPick = false;
      checkin.maintenance = true;
    },
    includeUnavailableOffer() {
      const pending = view.runs[0]!;
      view.canStart = false;
      view.runsUsed = 2;
      view.runs.unshift({
        ...pending,
        id: "90000000-0000-4000-8000-000000000002",
        number: 2,
        canPick: false,
        round: {
          ...pending.round!,
          id: "90000000-0000-4000-8000-000000000003",
          ticker: "STOCK_1",
          asset: catalog.STOCK_1!,
          state: "offered",
          direction: null,
          lockedAt: null,
          scheduledOpenAt: null,
          startPrice: null,
          startTakenAt: null,
          targetAt: null,
          endPrice: null,
          endTakenAt: null,
          settledAt: null,
          changePct: null,
        },
      });
    },
    includeExpiringHistory(number = 3) {
      view.runs.push({
        id: `90000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
        day: "2026-10-19",
        number,
        correctCount: 10,
        score: 50,
        canPick: false,
        endedAt: "2026-10-19T12:10:00.000Z",
        expiresAt: "2026-10-20T12:10:00.000Z",
        round: null,
      });
    },
    resolve(changePct = "1") {
      view.serverTime = "2026-10-20T12:15:15.000Z";
      view.runs = view.runs.filter((run) => !run.endedAt);
      const entry = view.runs[0]!;
      const movement = Number(changePct);
      Object.assign(entry, {
        correctCount: movement > 0 ? 1 : 0,
        score: movement > 0 ? 5 : 0,
        endedAt: movement < 0 ? view.serverTime : null,
      });
      Object.assign(entry.round!, {
        state: movement > 0 ? "won" : movement < 0 ? "lost" : "equal",
        startPrice: "100",
        startTakenAt: "2026-10-20T12:00:15.000Z",
        endPrice: String(100 + movement),
        endTakenAt: "2026-10-20T12:15:15.000Z",
        settledAt: "2026-10-20T12:15:15.000Z",
        changePct,
      });
      checkin.balance = movement > 0 ? 100 : 95;
    },
    close: async () => {
      stream.closeAllConnections();
      await new Promise<void>((resolve) => stream.close(() => resolve()));
    },
  };
}
