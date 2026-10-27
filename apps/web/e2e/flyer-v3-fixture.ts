import { expect } from "@playwright/test";
import type { Page, FrameLocator } from "@playwright/test";
import { replayFlyer } from "@stock-arena/game-core";
import type { FlyerInput } from "@stock-arena/game-core";
import { syntheticV3Course } from "../../../packages/game-core/src/testing/flyer-v3-fixture.js";
import { setupPrediction } from "./prediction-fixture.js";
export async function setupV3(
  page: Page,
  count: number,
  host: "discord" | "telegram",
  charts = true,
) {
  const parent = await setupPrediction(page, 3),
    course = syntheticV3Course(count);
  if (!charts) for (const s of course.segments) delete s.chart;
  let finishes = 0;
  await page.addInitScript(() => {
    Reflect.set(window, "daylightHaptics", []);
    Reflect.set(window, "flightHostCalls", []);
    if (window.Telegram?.WebApp) {
      const a = window.Telegram.WebApp;
      a.requestFullscreen = () => Reflect.get(window, "flightHostCalls").push("fullscreen");
      a.exitFullscreen = () => Reflect.get(window, "flightHostCalls").push("exit");
      a.disableVerticalSwipes = () => Reflect.get(window, "flightHostCalls").push("disable");
      a.enableVerticalSwipes = () => Reflect.get(window, "flightHostCalls").push("enable");
    }
    if (window.Telegram?.WebApp)
      window.Telegram.WebApp.HapticFeedback = {
        impactOccurred: () => Reflect.get(window, "daylightHaptics").push("score"),
        notificationOccurred: () => Reflect.get(window, "daylightHaptics").push("collision"),
      };
  });
  await page.route("**/api/flyer{,/**}", (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.endsWith("/start"))
      return route.fulfill({
        json: {
          id: "a1000000-0000-4000-8000-000000000001",
          course,
          startedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          maxTicks: 36000,
        },
      });
    if (path.endsWith("/cancel")) return route.fulfill({ json: { ok: true } });
    if (path.endsWith("/finish")) {
      const input = request.postDataJSON() as {
        inputs: FlyerInput[];
        ticks: number;
        score: number;
        stop?: boolean;
      };
      const result = replayFlyer(course, input.inputs, input.ticks, 36000, input.stop);
      expect(result.score).toBe(input.score);
      finishes++;
      return route.fulfill({
        json: {
          id: "a1000000-0000-4000-8000-000000000001",
          course,
          day: course.day,
          score: result.score,
          pipes: result.pipes,
          coins: result.coins,
          endReason: result.ended ? "collision" : "retired",
          best: result.score,
          pointsAwarded: Math.min(50, result.score),
          pointsToday: Math.min(50, result.score),
          newBest: true,
        },
      });
    }
    if (path.endsWith("/leaderboard"))
      return route.fulfill({
        json: {
          period: "day",
          entries: [],
          caller: null,
          season: {
            id: "season-1",
            name: "Season 1",
            startsAt: "2026-10-16T00:00:00Z",
            endsAt: null,
          },
        },
      });
    return route.fulfill({
      json: {
        day: course.day,
        best: 0,
        pointsToday: 0,
        dailyCap: 50,
        maintenance: false,
        available: true,
        canStart: true,
        active: null,
      },
    });
  });
  if (host === "discord") {
    await page.addInitScript(() => {
      if (window.parent !== window) return;
      addEventListener("message", (event) => {
        const frame: unknown = event.data;
        if (!Array.isArray(frame)) return;
        if (frame[0] === 0) {
          (event.source as Window).postMessage(
            [
              1,
              {
                cmd: "DISPATCH",
                evt: "READY",
                nonce: null,
                data: { v: 1, config: { api_endpoint: "//discord.test", environment: "test" } },
              },
            ],
            location.origin,
          );
          return;
        }
        const msg = frame[1] as { cmd: string; nonce?: string; evt?: string };
        if (frame[0] !== 1 || !msg.nonce || msg.evt !== undefined) return;
        const data =
          msg.cmd === "AUTHORIZE"
            ? { code: "synthetic-code" }
            : msg.cmd === "AUTHENTICATE"
              ? {
                  access_token: "synthetic-access",
                  user: {
                    id: "111111111111111111",
                    username: "Synthetic",
                    discriminator: "0001",
                    public_flags: 0,
                    avatar: null,
                  },
                  scopes: ["identify"],
                  expires: "2099-01-01T00:00:00Z",
                  application: { id: "111111111111111111", name: "Synthetic", description: "" },
                }
              : {};
        (event.source as Window).postMessage(
          [1, { cmd: msg.cmd, evt: null, nonce: msg.nonce, data }],
          location.origin,
        );
      });
    });
    await page.route("**/daylight-discord", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><body style="margin:0"><iframe title="Discord Activity" src="/?frame_id=synthetic&instance_id=synthetic&platform=desktop#screen=flyer" style="border:0;width:100vw;height:100vh"></iframe></body></html>',
      }),
    );
    await page.route("**/api/auth/discord", (route) =>
      route.fulfill({
        json: {
          access_token: "synthetic-access",
          session: {
            token: "synthetic-session",
            expiresAt: "2099-01-01T00:00:00Z",
            user: {
              id: "61f11783-6200-4dfb-b1a6-a511c558e8a5",
              displayName: "Synthetic Discord",
              avatarUrl: null,
              identity: { platform: "discord", platformUserId: "111111111111111111" },
            },
          },
        },
      }),
    );
  }
  await page.goto(
    host === "discord" ? "/daylight-discord" : "/#tgWebAppData=synthetic&screen=flyer",
  );
  const root: Page | FrameLocator = host === "discord" ? page.frameLocator("iframe") : page;
  return { root, course, finishes: () => finishes, close: parent.close };
}
