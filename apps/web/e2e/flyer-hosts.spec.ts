import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { en } from "../src/copy/en.js";
import { syntheticFlyerCourse } from "../../../packages/game-core/src/testing/flyer-fixture.js";
import { setupPrediction } from "./prediction-fixture.js";

test("Flyer works in the Discord SDK frame with Space and UI back", async ({ page }) => {
  const f = await setupPrediction(page, 3),
    course = syntheticFlyerCourse(3);
  await page.addInitScript(() => {
    if (parent !== window) return;
    addEventListener("message", (event: MessageEvent) => {
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
  await page.route("**/discord-flyer", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><iframe title="Discord Activity" src="/?frame_id=synthetic&instance_id=synthetic&platform=desktop" width="1000" height="900"></iframe></body></html>',
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
  await page.route("**/api/flyer{,/**}", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/start"))
      return route.fulfill({
        json: {
          id: "a1000000-0000-4000-8000-000000000001",
          startedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          maxTicks: 36000,
          course,
        },
      });
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
        day: "2026-10-25",
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
  try {
    await page.goto("/discord-flyer");
    const activity = page.frameLocator("iframe");
    await activity.getByRole("button", { name: en.games.flyer.name }).click();
    await activity.getByRole("button", { name: en.flyer.start, exact: true }).click();
    const canvas = activity.locator("canvas");
    await expect(canvas).toBeVisible();
    await canvas.focus();
    await page.keyboard.down("Space");
    await expect(canvas).toHaveAttribute("data-held", "true");
    await page.keyboard.up("Space");
    await expect(canvas).toHaveAttribute("data-held", "false");
    await activity.getByRole("button", { name: en.navigation.back, exact: true }).click();
    await expect(activity.locator(".shell")).toHaveAttribute("data-screen", "home");
  } finally {
    await f.close();
  }
});
for (const role of ["owner", "support"])
  test(`Flyer admin ${role}: player sessions and void control`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const userId = "10000000-0000-4000-8000-000000000001",
      id = "a1000000-0000-4000-8000-000000000001";
    let state = "finished",
      writes = 0;
    await page.route("**/api/admin/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (path.endsWith("/session"))
        return route.fulfill({
          json: {
            user: { id: userId, displayName: "Synthetic operator", role },
            permissions: [
              "overview:read",
              "players:read",
              ...(role === "owner" ? ["points:write"] : []),
            ],
            expiresAt: "2099-01-01T00:00:00Z",
            csrf: "synthetic-csrf",
          },
        });
      if (req.method() === "POST") {
        expect(role).toBe("owner");
        expect(req.headers()["x-admin-csrf"]).toBe("synthetic-csrf");
        expect(req.postDataJSON()).toEqual({ id, reason: "Synthetic flight review" });
        state = "void";
        writes++;
        return route.fulfill({ json: { ok: true } });
      }
      expect(new URL(req.url()).searchParams.get("userId")).toBe(userId);
      return route.fulfill({
        json: {
          entries: [
            {
              id,
              userId,
              startedAt: "2026-10-25T12:00:00Z",
              finishedAt: "2026-10-25T12:00:10Z",
              state,
              score: 5,
              day: "2026-10-25",
              ticks: 600,
            },
          ],
          page: 1,
          hasMore: false,
        },
      });
    });
    await page.goto("/admin");
    await page.getByRole("button", { name: en.admin.flyer, exact: true }).first().click();
    await page.getByLabel(en.admin.flyerOps.userId, { exact: true }).fill(userId);
    await page.getByRole("button", { name: en.admin.flyerOps.find }).click();
    await expect(page.getByRole("heading", { name: id })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (process.env.T27_REVIEW_CAPTURES === "1")
      await page.screenshot({
        path: resolve("docs/review/t27", `flyer-admin-${role}.png`),
        fullPage: true,
      });
    if (role === "owner") {
      await page.getByLabel(en.admin.ops.reason, { exact: true }).fill("Synthetic flight review");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: en.admin.flyerOps.voidAction }).click();
      await expect(page.getByText(en.admin.flyerOps.states.void, { exact: true })).toBeVisible();
      expect(writes).toBe(1);
    } else
      await expect(page.getByRole("button", { name: en.admin.flyerOps.voidAction })).toHaveCount(0);
  });
