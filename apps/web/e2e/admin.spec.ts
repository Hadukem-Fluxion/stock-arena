import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { resolve } from "node:path";
import { en } from "../src/copy/en.js";

const copy = en.admin;
const ownerId = "d4ee5e5e-d845-4fee-98ca-dba31add46ac";
const targetId = "244091b4-3408-4c01-95da-3ff14d8937f5";
const session = {
  user: { id: ownerId, displayName: "Alex · Demo owner", role: "owner" },
  permissions: ["overview:read", "team:read", "team:write", "ownership:transfer", "audit:read"],
  expiresAt: "2026-10-22T00:00:00Z",
  csrf: "synthetic-csrf-token",
};
const team = [
  {
    userId: ownerId,
    displayName: "Alex · Demo owner",
    discordId: "200000000000000001",
    role: "owner",
    grantedBy: ownerId,
    grantedAt: "2026-10-21T09:00:00Z",
    revokedAt: null,
  },
  {
    userId: targetId,
    displayName: "Sam · Demo moderator",
    discordId: "200000000000000002",
    role: "moderator",
    grantedBy: ownerId,
    grantedAt: "2026-10-21T10:00:00Z",
    revokedAt: null,
  },
  {
    userId: "322d44a2-a292-49b3-92f7-4779b64d7916",
    displayName: "Taylor · Demo support",
    discordId: "200000000000000003",
    role: "support",
    grantedBy: ownerId,
    grantedAt: "2026-10-21T10:30:00Z",
    revokedAt: null,
  },
];
async function mockAdmin(
  page: Page,
  options: { role?: "owner" | "support"; signedIn?: boolean } = {},
) {
  let signedIn = options.signedIn ?? true;
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      expect(request.headers()["x-admin-csrf"]).toBe(session.csrf);
      writes.push({ path: url.pathname, body: request.postDataJSON() as unknown });
      if (url.pathname.endsWith("/logout") || url.pathname.endsWith("/transfer")) signedIn = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (!signedIn) return route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED" } } });
    if (url.pathname.endsWith("/session"))
      return route.fulfill({
        json: {
          ...session,
          ...(options.role === "support"
            ? {
                user: { ...session.user, role: "support" },
                permissions: ["overview:read", "audit:read", "players:read"],
              }
            : {}),
        },
      });
    if (url.pathname.endsWith("/team")) return route.fulfill({ json: { members: team } });
    if (url.pathname.endsWith("/audit"))
      return route.fulfill({
        json: {
          entries: [
            {
              id: "95677b90-f93c-43a4-968d-7ad635496fa5",
              actorId: ownerId,
              actorName: "Alex · Demo owner",
              action: "team.granted",
              targetUserId: targetId,
              targetType: "staff",
              targetId,
              details: { before: null, after: "moderator" },
              ipHash: "synthetic-ip-hash",
              createdAt: "2026-10-21T10:00:00Z",
            },
            {
              id: "1b6f0358-dddf-434b-ab0d-d91adc24e2f8",
              actorId: ownerId,
              actorName: "Alex · Demo owner",
              action: "auth.login",
              targetUserId: ownerId,
              targetType: "staff",
              targetId: ownerId,
              details: {},
              ipHash: "synthetic-ip-hash",
              createdAt: "2026-10-21T09:45:00Z",
            },
          ],
          page: Number(url.searchParams.get("page") ?? "1"),
          hasMore: false,
        },
      });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  return writes;
}
test("standalone login does not initialize the Activity or use player tokens", async ({ page }) => {
  await mockAdmin(page, { signedIn: false });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: copy.loginTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: copy.login })).toHaveAttribute(
    "href",
    "/api/admin/auth/discord",
  );
  await expect(page.getByText(en.host.browserDevelopment)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
test("owner manages team with confirmation and can sign out", async ({ page }) => {
  const writes = await mockAdmin(page);
  await page.goto("/admin");
  await page.getByRole("navigation").getByRole("button", { name: copy.team }).click();
  await page.getByLabel(copy.discordId, { exact: true }).fill("200000000000000099");
  await page.getByRole("button", { name: copy.addMember, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(copy.saved);
  expect(writes[0]).toEqual({
    path: "/api/admin/team",
    body: { discordId: "200000000000000099", role: "support" },
  });
  const row = page.getByRole("row").filter({ hasText: "Sam · Demo moderator" });
  await row.getByRole("button", { name: copy.transfer }).click();
  const transfer = page.getByRole("region", { name: copy.transferTitle });
  await expect(transfer.getByRole("button", { name: copy.transfer })).toBeDisabled();
  await transfer.getByLabel(copy.confirmation).fill("Sam · Demo moderator");
  await transfer.getByRole("button", { name: copy.transfer }).click();
  await expect(page.getByRole("heading", { name: copy.loginTitle })).toBeVisible();
  expect(writes.at(-1)).toEqual({
    path: "/api/admin/team/transfer",
    body: { userId: targetId, confirmation: "Sam · Demo moderator" },
  });
});
test("support sees audit but cannot see team management", async ({ page }) => {
  await mockAdmin(page, { role: "support" });
  await page.goto("/admin");
  await expect(page.getByRole("navigation").getByRole("button", { name: copy.team })).toHaveCount(
    0,
  );
  await page.getByRole("navigation").getByRole("button", { name: copy.audit }).click();
  await expect(page.getByRole("cell", { name: "Access granted" })).toBeVisible();
  await page.getByLabel(copy.actor, { exact: true }).fill(ownerId);
  await page.getByLabel(copy.from, { exact: true }).fill("2026-10-21");
  const request = page.waitForRequest((value) =>
    value.url().includes(`/api/admin/audit?actor=${ownerId}`),
  );
  await page.getByRole("button", { name: copy.apply }).click();
  await request;
  await page.getByRole("button", { name: copy.logout, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.loginTitle })).toBeVisible();
});
test("blocks the admin hub inside a Mini App", async ({ page }) => {
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: { initData: "synthetic-mini-app-init-data" },
    } as typeof window.Telegram;
  });
  await page.goto("/admin");
  await expect(page.getByText(copy.browserOnly)).toBeVisible();
  await expect(page.getByRole("link", { name: copy.login })).toHaveCount(0);
});
for (const width of [360, 1440])
  test(`admin layout and review screenshots at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : 1000 });
    await mockAdmin(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: copy.subtitle })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const size = width === 360 ? "mobile" : "desktop";
    for (const screen of ["overview", "team", "audit"] as const) {
      if (screen !== "overview")
        await page.getByRole("navigation").getByRole("button", { name: copy[screen] }).click();
      if (screen === "team")
        await expect(
          page.getByRole("cell").filter({ hasText: "Sam · Demo moderator" }).first(),
        ).toBeVisible();
      if (screen === "audit")
        await expect(page.getByRole("cell", { name: "Access granted" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const path = testInfo.outputPath(`admin-${screen}-${size}.png`);
      await page.screenshot({ path, fullPage: true });
      await testInfo.attach(`admin-${screen}-${size}`, { path, contentType: "image/png" });
      if (process.env.ADMIN_REVIEW_CAPTURES === "1")
        await page.screenshot({
          path: resolve("docs/review/t28", `admin-${screen}-${size}.png`),
          fullPage: true,
        });
    }
  });
