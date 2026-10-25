import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import { en } from "../src/copy/en.js";
import { setupPrediction } from "./prediction-fixture.js";
const c = en.referrals,
  value = "ref_synthetic_invite_code_01";
const telegramUrl = `https://t.me/SyntheticArenaBot?startapp=${value}`;
const discordUrl = `https://discord.com/activities/111111111111111111?custom_id=${value}`;
async function mockInvites(page: Page, maintenance = false) {
  let claimed = false;
  await page.route("**/api/referral{,/**}", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().headers().authorization).toBeTruthy();
      expect(route.request().postDataJSON()).toEqual({ code: "ref_manual_synthetic_code01" });
      claimed = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        code: value,
        joined: 3,
        points: 50,
        claim: claimed ? "pending" : null,
        maintenance,
        telegramUrl,
        discordUrl,
      },
    });
  });
}
async function capture(page: Page, info: TestInfo, file: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    (document.activeElement as HTMLElement | null)?.blur();
    scrollTo(0, 0);
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(file), fullPage: true });
  if (process.env.T34_REVIEW_CAPTURES === "1")
    await page.screenshot({ path: resolve("docs/review/t34", file), fullPage: true });
}
for (const width of [390, 1440])
  for (const count of [3, 30]) {
    test(`Telegram invite screen ${width}px catalog ${count}: copy, share, manual code and native back`, async ({
      page,
      context,
    }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const fixture = await setupPrediction(page, count);
      await mockInvites(page);
      await page.addInitScript(() => {
        const app = window.Telegram?.WebApp;
        if (!app) return;
        let back: (() => void) | null = null;
        app.openTelegramLink = (url) => {
          Reflect.set(window, "sharedInvite", url);
        };
        app.BackButton = {
          show() {},
          hide() {},
          onClick(fn) {
            back = fn;
          },
          offClick(fn) {
            if (fn === back) back = null;
          },
        };
        Reflect.set(window, "inviteBack", () => back?.());
      });
      try {
        await page.goto("/#tgWebAppData=synthetic");
        await page.getByRole("button", { name: en.games.invite.name }).click();
        await expect(page.getByLabel(c.link, { exact: true })).toHaveValue(telegramUrl);
        await expect(page.getByText(c.milestone, { exact: true })).toBeVisible();
        await expect(page.getByText(c.welcome, { exact: true })).toBeVisible();
        for (const target of await page
          .locator(".invite-screen button, .invite-screen summary, .back-button")
          .all()) {
          const box = await target.boundingBox();
          if (box) {
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.width).toBeGreaterThanOrEqual(44);
          }
        }
        await capture(page, info, `invite-${width}-${count}.png`);
        if (width === 390 && count === 3) {
          await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
          const last = await page.locator(".invite-screen summary").last().boundingBox();
          const nav = await page.locator(".tabs-bottom").boundingBox();
          expect(last!.y + last!.height).toBeLessThanOrEqual(nav!.y);
          if (process.env.T34_REVIEW_CAPTURES === "1")
            await page.screenshot({ path: resolve("docs/review/t34/invite-390-bottom.png") });
          await page.evaluate(() => scrollTo(0, 0));
        }
        await page.getByRole("button", { name: c.copy, exact: true }).click();
        await expect(page.getByRole("status")).toContainText(c.copied);
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(telegramUrl);
        await page.getByRole("button", { name: c.share }).click();
        const shared = new URL(
          (await page.evaluate(() => Reflect.get(window, "sharedInvite"))) as string,
        );
        expect(shared.origin + shared.pathname).toBe("https://t.me/share/url");
        expect(shared.searchParams.get("url")).toBe(telegramUrl);
        await page.getByText(c.details, { exact: true }).click();
        await page.getByLabel(c.code, { exact: true }).fill("ref_manual_synthetic_code01");
        await page.getByRole("button", { name: c.claim }).click();
        await expect(page.getByText(c.claimed, { exact: true })).toBeVisible();
        await page.evaluate(() => Reflect.get(window, "inviteBack")());
        await expect(page.locator(".shell")).toHaveAttribute("data-screen", "home");
      } finally {
        await fixture.close();
      }
    });
  }
test("browser preview never requests invite state or permits claiming", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/referral")) calls.push(req.url());
  });
  await page.goto("/#screen=invite");
  await expect(page.getByText(c.preview)).toBeVisible();
  await expect(page.getByRole("button", { name: c.claim })).toHaveCount(0);
  expect(calls).toEqual([]);
});
test("maintenance leaves invite counters visible and blocks claims/sharing", async ({ page }) => {
  const fixture = await setupPrediction(page, 3);
  await mockInvites(page, true);
  try {
    await page.goto("/#tgWebAppData=synthetic&screen=invite");
    await expect(page.getByText(en.maintenance)).toBeVisible();
    await expect(page.getByRole("button", { name: c.share })).toBeDisabled();
    await page.getByText(c.details, { exact: true }).click();
    await expect(page.getByRole("button", { name: c.claim })).toBeDisabled();
    await expect(page.getByText(c.joined, { exact: true })).toBeVisible();
  } finally {
    await fixture.close();
  }
});
test("Discord SDK carries launch customId and uses SHARE_LINK with the player's code", async ({
  page,
}) => {
  const fixture = await setupPrediction(page, 3);
  await mockInvites(page);
  await page.addInitScript(() => {
    if (parent !== window) return;
    const calls: unknown[] = [];
    Reflect.set(window, "inviteDiscordCalls", calls);
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
      const msg = frame[1] as { cmd: string; nonce?: string; evt?: string; args?: object };
      if (frame[0] !== 1 || !msg.nonce || msg.evt !== undefined) return;
      calls.push({ cmd: msg.cmd, args: msg.args });
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
            : msg.cmd === "SHARE_LINK"
              ? { success: true, didCopyLink: false, didSendMessage: true }
              : {};
      (event.source as Window).postMessage(
        [1, { cmd: msg.cmd, evt: null, nonce: msg.nonce, data }],
        location.origin,
      );
    });
  });
  await page.route("**/discord-invite-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><iframe title="Discord Activity" src="/?frame_id=synthetic&instance_id=synthetic&platform=desktop&custom_id=${value}" width="1000" height="900"></iframe></body></html>`,
    }),
  );
  await page.route("**/api/auth/discord", (route) => {
    expect(route.request().postDataJSON()).toEqual({ code: "synthetic-code", customId: value });
    return route.fulfill({
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
    });
  });
  try {
    await page.goto("/discord-invite-test");
    const activity = page.frameLocator("iframe");
    await activity.getByRole("button", { name: en.games.invite.name }).click();
    await expect(activity.getByLabel(c.link, { exact: true })).toHaveValue(discordUrl);
    await activity.getByRole("button", { name: c.share }).click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "inviteDiscordCalls")))
      .toContainEqual({ cmd: "SHARE_LINK", args: { message: c.shareMessage, custom_id: value } });
  } finally {
    await fixture.close();
  }
});
for (const role of ["owner", "support"])
  test(`admin invites ${role} permissions and audited void UI`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    let status = "rewarded",
      writes = 0;
    await page.route("**/api/admin/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (req.method() === "POST") {
        expect(role).toBe("owner");
        expect(req.headers()["x-admin-csrf"]).toBe("synthetic-csrf");
        expect(req.postDataJSON().reason).toBe("Synthetic review note");
        status = "void";
        writes++;
        return route.fulfill({ json: { ok: true } });
      }
      if (path.endsWith("/session"))
        return route.fulfill({
          json: {
            user: {
              id: "10000000-0000-4000-8000-000000000001",
              displayName: "Synthetic operator",
              role,
            },
            permissions: [
              "overview:read",
              "referrals:read",
              ...(role === "owner" ? ["referrals:write"] : []),
            ],
            expiresAt: "2099-01-01T00:00:00Z",
            csrf: "synthetic-csrf",
          },
        });
      return route.fulfill({
        json: {
          entries: [
            {
              inviterId: "10000000-0000-4000-8000-000000000002",
              inviteeId: "10000000-0000-4000-8000-000000000003",
              inviterName: "Synthetic inviter",
              inviteeName: "Synthetic friend",
              code: value,
              platform: "discord",
              status,
              createdAt: "2026-10-25T12:00:00Z",
              qualifiedAt: "2026-10-25T14:00:00Z",
            },
          ],
          page: 1,
          hasMore: false,
        },
      });
    });
    await page.goto("/admin");
    await page.getByRole("button", { name: en.admin.referrals, exact: true }).first().click();
    await expect(
      page.getByRole("heading", { name: "Synthetic inviter → Synthetic friend" }),
    ).toBeVisible();
    await capture(page, info, `admin-invites-${role}.png`);
    if (role === "owner") {
      await page
        .getByLabel(`${en.admin.ops.reason}: Synthetic friend`)
        .fill("Synthetic review note");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: en.admin.referralOps.voidAction }).click();
      await expect(
        page.locator(".admin-pill").filter({ hasText: en.admin.referralOps.void }),
      ).toBeVisible();
      expect(writes).toBe(1);
    } else
      await expect(page.getByRole("button", { name: en.admin.referralOps.voidAction })).toHaveCount(
        0,
      );
  });
