import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import { en } from "../src/copy/en.js";
import { setupPrediction } from "./prediction-fixture.js";

async function nativeBack(page: Page) {
  await page.addInitScript(() => {
    const app = window.Telegram?.WebApp;
    if (!app) return;
    let handler: (() => void) | null = null;
    Object.assign(window, { nativeBack: () => handler?.(), backVisible: false });
    app.BackButton = {
      show() {
        Reflect.set(window, "backVisible", true);
      },
      hide() {
        Reflect.set(window, "backVisible", false);
      },
      onClick(callback) {
        handler = callback;
      },
      offClick(callback) {
        if (handler === callback) handler = null;
      },
    };
  });
}
async function quiz(page: Page) {
  await page.route("**/api/quiz{,/**}", (route) => {
    const now = new Date();
    return route.fulfill({
      json: {
        day: now.toISOString().slice(0, 10),
        serverTime: now.toISOString(),
        status: "question",
        total: 3,
        answered: 0,
        score: 0,
        feedback: null,
        question: {
          id: "90000000-0000-4000-8000-000000000001",
          position: 0,
          topic: "synthetic",
          prompt: "Which label belongs to this fictional interface test?",
          options: ["Synthetic A", "Synthetic B", "Synthetic C", "Synthetic D"],
          servedAt: now.toISOString(),
          deadline: new Date(now.getTime() + 30000).toISOString(),
        },
      },
    });
  });
}
async function capture(page: Page, info: TestInfo, name: string, atEnd = false) {
  await page.evaluate((end) => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, end ? document.documentElement.scrollHeight : 0);
  }, atEnd);
  const path = info.outputPath(name);
  await page.screenshot({ path, fullPage: !atEnd });
  await info.attach(name, { path, contentType: "image/png" });
  if (process.env.T33_REVIEW_CAPTURES === "1")
    await page.screenshot({ path: resolve("docs/review/t33", name), fullPage: !atEnd });
}
async function accessibleTargets(page: Page) {
  for (const target of await page.locator("button:visible, a:visible, summary:visible").all()) {
    if (!(await target.isEnabled())) continue;
    const bounds = await target.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
  }
}
for (const width of [390, 1440])
  for (const count of [3, 30]) {
    test(`dedicated screens ${width}px catalog ${count}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const fixture = await setupPrediction(page, count);
      await nativeBack(page);
      await quiz(page);
      await page.route("**/api/flyer", (route) =>
        route.fulfill({
          json: {
            day: "2026-10-25",
            best: 0,
            pointsToday: 0,
            dailyCap: 50,
            maintenance: false,
            available: false,
            canStart: false,
            active: null,
          },
        }),
      );
      await page.route("**/api/flyer/leaderboard?*", (route) =>
        route.fulfill({
          json: {
            period: new URL(route.request().url()).searchParams.get("period"),
            entries: [],
            caller: null,
            season: {
              id: "season-1",
              name: "Season 1",
              startsAt: "2026-10-16T00:00:00Z",
              endsAt: null,
            },
          },
        }),
      );
      await page.route("**/api/referral", (route) =>
        route.fulfill({
          json: {
            code: "ref_synthetic_home_invite01",
            joined: 0,
            points: 0,
            claim: null,
            maintenance: false,
            telegramUrl: "https://t.me/SyntheticArenaBot?startapp=ref_synthetic_home_invite01",
            discordUrl:
              "https://discord.com/activities/111111111111111111?custom_id=ref_synthetic_home_invite01",
          },
        }),
      );
      await page.route("**/api/leaderboard?*", (route) => {
        const row = (rank: number, displayName: string, score: number) => ({
          userId: `90000000-0000-4000-8000-${String(rank).padStart(12, "0")}`,
          displayName,
          rank,
          score,
          reachedAt: "2026-10-20T12:00:00.000Z",
        });
        const query = new URL(route.request().url()).searchParams;
        return route.fulfill({
          json: {
            period: query.get("period"),
            platform: query.get("platform"),
            generatedAt: "2026-10-20T12:00:00.000Z",
            startsAt: "2026-10-20T00:00:00.000Z",
            endsAt: "2026-10-21T00:00:00.000Z",
            season: {
              id: "season-1",
              startsAt: "2026-10-16T00:00:00.000Z",
              endsAt: null,
              ended: false,
            },
            top: [
              row(1, "Sample leader", 150),
              row(2, "Sample runner-up", 120),
              row(3, "Sample third", 100),
              row(4, "Arena player", 95),
            ],
            caller: row(4, "Arena player", 95),
          },
        });
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto("/#tgWebAppData=mock");
        await expect(page.locator(".player-stats")).toContainText("95");
        await expect(page.locator(".connection")).toHaveCount(0);
        await expect(page.locator(".game-list .game-tile")).toHaveCount(3);
        await expect(page.getByRole("button", { name: en.games.flyer.name })).toBeEnabled();
        await expect(page.getByRole("button", { name: en.games.invite.name })).toBeEnabled();
        await expect(page.locator(".price-list")).toHaveCount(0);
        await expect(page.locator(".ranking-card h2")).toHaveText(en.labels.topThree);
        await expect(page.locator(".ranking-card > .leaderboard-list > li")).toHaveCount(3);
        await expect(page.locator(".home-caller")).toContainText("Arena player");
        await page.evaluate(() => document.fonts.ready);
        await accessibleTargets(page);
        const contrasts = await page.evaluate(() => {
          const style = getComputedStyle(document.documentElement);
          const luminance = (token: string) => {
            const hex = style.getPropertyValue(token).trim().slice(1);
            const channels = [0, 2, 4]
              .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
              .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
            return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
          };
          return [
            ["--text", "--surface"],
            ["--muted", "--surface"],
            ["--muted", "--surface-2"],
            ["--muted", "--bg"],
            ["--muted", "--nav-bg"],
            ["--accent-ink", "--accent"],
            ["--accent-text", "--accent-tint"],
            ["--down", "--down-tint"],
          ].map(([a, b]) => {
            const values = [luminance(a!), luminance(b!)];
            return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
          });
        });
        for (const contrast of contrasts) expect(contrast).toBeGreaterThanOrEqual(4.5);
        for (const safeArea of [0, 24]) {
          const clearance = await page.evaluate((inset) => {
            const shell = document.querySelector<HTMLElement>(".shell")!;
            shell.style.setProperty("--bottom-nav-safe-area", `${inset}px`);
            window.scrollTo(0, document.documentElement.scrollHeight);
            const nav = document.querySelector(".tabs-bottom")!.getBoundingClientRect();
            return {
              padding: parseFloat(getComputedStyle(shell).paddingBottom),
              navHeight: nav.height,
              navTop: nav.top,
              legalBottom: document.querySelector(".legal-link")!.getBoundingClientRect().bottom,
              callerBottom: document.querySelector(".home-caller")!.getBoundingClientRect().bottom,
            };
          }, safeArea);
          expect(clearance.padding).toBe(clearance.navHeight);
          expect(clearance.legalBottom).toBeLessThanOrEqual(clearance.navTop);
          expect(clearance.callerBottom).toBeLessThanOrEqual(clearance.navTop);
        }
        await page.evaluate(() =>
          document
            .querySelector<HTMLElement>(".shell")!
            .style.removeProperty("--bottom-nav-safe-area"),
        );
        const suffix = `${width === 390 ? "mobile" : "desktop"}-${count}.png`;
        await capture(page, info, `home-${suffix}`);
        if (count === 3) await capture(page, info, `home-end-${suffix}`, true);
        await page.getByRole("button", { name: en.games.quiz.name }).click();
        await expect(page.locator(".quiz-panel h3")).toContainText("fictional interface test");
        await accessibleTargets(page);
        expect(await page.evaluate(() => Reflect.get(window, "backVisible"))).toBe(true);
        await capture(page, info, `quiz-${suffix}`);
        await page.evaluate(() => {
          const back: () => void = Reflect.get(window, "nativeBack");
          back();
        });
        await expect(page.locator(".shell")).toHaveAttribute("data-screen", "home");
        expect(await page.evaluate(() => Reflect.get(window, "backVisible"))).toBe(false);
        await page.getByRole("button", { name: en.games.higherLower.name }).click();
        await expect(page.getByRole("tab")).toHaveCount(3);
        await page.getByRole("button", { name: en.hl.start, exact: true }).click();
        const up = page.getByRole("button", { name: en.hl.up, exact: true });
        await expect(up).toBeEnabled();
        await expect(page.getByRole("button", { name: en.hl.start, exact: true })).toHaveCount(0);
        await expect(page.locator(".hl-panel")).not.toContainText("Runs used today");
        await expect(page.locator(".hl-panel")).not.toContainText("3 run slots");
        await expect(page.locator(".hl-panel")).not.toContainText("Correct picks:");
        expect((await up.boundingBox())!.height).toBeGreaterThanOrEqual(64);
        await accessibleTargets(page);
        await capture(page, info, `higher-lower-${suffix}`);
        await up.click();
        await expect(page.getByText(en.navigation.closedApp)).toBeVisible();
        await expect(page.getByLabel(en.hl.countdown)).toBeVisible();
        if (count === 3) await capture(page, info, `prediction-pending-${suffix}`);
        await page.getByRole("tab").first().focus();
        await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
        await expect(
          page.getByRole("tabpanel").getByText(en.hl.emptySlot, { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: en.hl.start, exact: true })).toBeVisible();
        if (count === 3) await capture(page, info, `empty-run-${suffix}`);
        await page.getByRole("tab").nth(1).focus();
        await page.keyboard.press("Home");
        await expect(page.getByText(en.hl.pending, { exact: true })).toBeVisible();
        await page.locator("summary").click();
        await expect(page.getByText(en.hl.predictionRules)).toBeVisible();
        await page.getByRole("button", { name: en.navigation.back, exact: true }).click();
        await page.getByRole("button", { name: en.navigation.seeAll, exact: true }).click();
        await expect(page.locator(".shell")).toHaveAttribute("data-screen", "leaderboard");
        await page
          .locator(".tabs-bottom")
          .getByRole("button", { name: en.tabs.markets, exact: true })
          .click();
        await expect(page.locator(".price-row")).toHaveCount(count);
        await expect(page.getByText(en.navigation.liveWindow, { exact: true })).toBeVisible();
        await accessibleTargets(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await capture(page, info, `markets-${suffix}`);
        await page.reload();
        await expect(page.locator(".shell")).toHaveAttribute("data-screen", "markets");
        expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("tgWebAppData")).toBe(
          "mock",
        );
        for (const screen of ["flyer", "invite"] as const) {
          await page.goto(`/#tgWebAppData=mock&screen=${screen}`);
          await expect(
            page.getByRole("heading", {
              name:
                screen === "flyer"
                  ? `${en.flyer.brand} ${en.flyer.wordmark}`
                  : en.games[screen].name,
              exact: true,
            }),
          ).toBeVisible();
          if (screen === "flyer")
            await expect(page.getByText(en.flyer.configuration, { exact: true })).toBeVisible();
          else await expect(page.getByLabel(en.referrals.link, { exact: true })).toBeVisible();
          if (count === 3) await capture(page, info, `${screen}-${suffix}`);
          await page.getByRole("button", { name: en.navigation.back, exact: true }).click();
          await expect(page.locator(".shell")).toHaveAttribute("data-screen", "home");
        }
        await page.getByRole("button", { name: en.navigation.legal, exact: true }).click();
        await expect(page.getByRole("dialog")).toContainText(en.disclaimer);
        if (count === 3) await capture(page, info, `legal-${suffix}`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).not.toBeVisible();
        expect(errors).toEqual([]);
      } finally {
        await fixture.close();
      }
    });
  }

test("a background refresh preserves keyboard focus in the legal dialog", async ({ page }) => {
  await page.clock.install();
  const fixture = await setupPrediction(page, 3);
  try {
    const initial = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/checkin",
    );
    await page.goto("/#tgWebAppData=mock");
    const view: unknown = await (await initial).json();
    if (!view || typeof view !== "object") throw new Error("Invalid synthetic check-in");
    await expect(page.locator(".player-stats")).toContainText("95");
    await page.route("**/api/checkin", (route) =>
      route.fulfill({ json: { ...view, balance: 96 } }),
    );
    await page.getByRole("button", { name: en.navigation.legal, exact: true }).click();
    const link = page.getByRole("dialog").getByRole("link");
    await link.focus();
    await page.clock.fastForward(15000);
    await expect(page.locator(".player-stats")).toContainText("96");
    await expect(link).toBeFocused();
  } finally {
    await fixture.close();
  }
});

test("Discord SDK login and UI back use the same dedicated screens", async ({ page }) => {
  const fixture = await setupPrediction(page, 3);
  await quiz(page);
  await page.addInitScript(() => {
    if (window.parent !== window) return;
    const calls: string[] = [];
    Reflect.set(window, "discordCalls", calls);
    window.addEventListener("message", (event: MessageEvent) => {
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
      const message = frame[1] as { cmd?: string; evt?: string; nonce?: string };
      if (frame[0] !== 1 || !message?.nonce || message.evt !== undefined) return;
      calls.push(message.cmd ?? "unknown");
      const data =
        message.cmd === "AUTHORIZE"
          ? { code: "synthetic-code" }
          : message.cmd === "AUTHENTICATE"
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
            : message.cmd === "OPEN_EXTERNAL_LINK"
              ? { opened: true }
              : {};
      (event.source as Window).postMessage(
        [1, { cmd: message.cmd, evt: null, nonce: message.nonce, data }],
        location.origin,
      );
    });
  });
  await page.route("**/discord-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><iframe title="Discord Activity" src="/?frame_id=synthetic-frame&instance_id=synthetic-instance&platform=desktop" width="1000" height="900"></iframe></body></html>',
    }),
  );
  await page.route("**/api/auth/discord", (route) => {
    expect(route.request().postDataJSON()).toEqual({ code: "synthetic-code" });
    return route.fulfill({
      json: {
        access_token: "synthetic-access",
        session: {
          token: "synthetic-session",
          expiresAt: "2099-01-01T00:00:00Z",
          user: {
            id: "61f11783-6200-4dfb-b1a6-a511c558e8a5",
            displayName: "Discord test player",
            avatarUrl: null,
            identity: { platform: "discord", platformUserId: "111111111111111111" },
          },
        },
      },
    });
  });
  try {
    await page.goto("/discord-test");
    const activity = page.frameLocator("iframe");
    await expect(activity.locator(".shell")).toHaveAttribute("data-host", "discord");
    await expect(activity.locator(".player-stats")).toContainText("95");
    await expect(activity.locator(".connection")).toHaveCount(0);
    await activity.getByRole("button", { name: en.games.quiz.name }).click();
    await expect(activity.locator(".quiz-panel h3")).toContainText("fictional");
    await activity.getByRole("button", { name: en.navigation.back, exact: true }).click();
    await expect(activity.locator(".shell")).toHaveAttribute("data-screen", "home");
    expect(new URL(page.frames()[1]!.url()).searchParams.get("frame_id")).toBe("synthetic-frame");
    expect(await page.evaluate(() => Reflect.get(window, "discordCalls"))).toEqual(
      expect.arrayContaining(["AUTHORIZE", "AUTHENTICATE"]),
    );
  } finally {
    await fixture.close();
  }
});
