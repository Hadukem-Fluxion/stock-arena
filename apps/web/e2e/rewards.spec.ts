import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import { en } from "../src/copy/en.js";
import { setupPrediction } from "./prediction-fixture.js";
const c = en.admin,
  r = c.rewardOps,
  p = en.rewards,
  at = "2026-10-23T12:00:00.000Z";
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const path = info.outputPath(name);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: "image/png" });
  if (process.env.REWARDS_REVIEW_CAPTURES === "1")
    await page.screenshot({ path: resolve("docs/review/t31", name), fullPage: true });
}
async function mockAdmin(page: Page, role = "owner", frozen = true) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let locked = false,
    status: "pending" | "approved" | "delivered" | "void" = "pending",
    version = 0;
  const season = {
    id: "synthetic-season",
    name: "Synthetic Season",
    startsAt: "2026-10-16T00:00:00.000Z",
    endsAt: "2026-10-22T00:00:00.000Z",
  };
  await page.route("**/api/admin/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() === "POST") {
      expect(req.headers()["x-admin-csrf"]).toBe("synthetic-csrf");
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      if (path.endsWith("/freeze")) {
        frozen = true;
        locked = true;
      }
      if (path.endsWith("/lock")) locked = Boolean(body.locked);
      if (path.endsWith("/status")) {
        status = body.status as typeof status;
        version++;
      }
      if (path.endsWith("/export"))
        return route.fulfill({
          contentType: "text/csv",
          body: '"rank","display_name"\r\n"1","Synthetic recipient"\r\n',
        });
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          user: {
            id: "10000000-0000-4000-8000-000000000001",
            displayName: "Alex · Demo operator",
            role,
          },
          csrf: "synthetic-csrf",
          expiresAt: "2099-01-01T00:00:00.000Z",
          permissions: [
            "overview:read",
            "audit:read",
            "rewards:read",
            ...(role === "support" || role === "moderator"
              ? []
              : ["rewards:write", "rewards:export"]),
          ],
        },
      });
    if (path.endsWith("/rewards")) return route.fulfill({ json: { seasons: [season] } });
    if (path.endsWith("/season"))
      return route.fulfill({
        json: {
          season,
          locked,
          snapshot: frozen
            ? {
                seasonId: season.id,
                seasonName: season.name,
                startsAt: season.startsAt,
                endsAt: season.endsAt,
                topN: 3,
                createdAt: at,
                createdBy: "10000000-0000-4000-8000-000000000001",
              }
            : null,
          prizes: [
            {
              id: "synthetic-prize",
              rankFrom: 1,
              rankTo: 3,
              description: "Synthetic campaign reward",
            },
          ],
          entries: frozen
            ? Array.from({ length: 3 }, (_, i) => ({
                id: `20000000-0000-4000-8000-00000000000${i + 1}`,
                userId: `30000000-0000-4000-8000-00000000000${i + 1}`,
                rank: i + 1,
                points: 300 - i * 50,
                displayName: `Synthetic recipient ${i + 1}`,
                identities: [
                  {
                    platform: i % 2 ? "telegram" : "discord",
                    platformUserId: `10000000000000000${i + 1}`,
                  },
                ],
                eligibility: "review_required",
                prizeDescription: "Synthetic campaign reward",
                event: {
                  id: `event-${i}`,
                  entryId: `20000000-0000-4000-8000-00000000000${i + 1}`,
                  version: i === 0 ? version : 0,
                  status: i === 0 ? status : "pending",
                  note: "Synthetic eligibility review",
                  actorId: "10000000-0000-4000-8000-000000000001",
                  createdAt: at,
                },
              }))
            : [],
        },
      });
    if (path.endsWith("/destinations"))
      return route.fulfill({
        json: {
          page: 1,
          hasMore: false,
          entries: [
            {
              id: "30000000-0000-4000-8000-000000000001",
              displayName: "Synthetic recipient",
              bybitUid: role === "support" || role === "moderator" ? "••••4567" : "01234567",
              mantleAddress: "",
              changedAt: at,
            },
          ],
        },
      });
    if (path.includes("/destinations/"))
      return route.fulfill({
        json: {
          history: [
            {
              id: "history-1",
              actor: "player",
              changedAt: at,
              oldValues: { bybitUid: "", mantleAddress: "" },
              newValues: { bybitUid: "••••4567", mantleAddress: "" },
            },
          ],
        },
      });
    return route.fulfill({ json: {} });
  });
  return writes;
}
const nav = (page: Page) =>
  page.getByRole("navigation").getByRole("button", { name: c.rewards, exact: true }).click();
test("admin freezes, locks, approves/delivers with note and exports via CSRF POST", async ({
  page,
}) => {
  const writes = await mockAdmin(page, "admin", false);
  page.on("dialog", (d) => d.accept());
  await page.goto("/admin");
  await nav(page);
  await page.getByLabel(c.ops.reason, { exact: true }).fill("Synthetic payout review");
  await page.getByLabel(r.topN, { exact: true }).fill("3");
  await page.getByRole("button", { name: r.freeze, exact: true }).click();
  await expect(page.getByText(r.frozen, { exact: true })).toBeVisible();
  await expect(page.getByText(p.locked, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: r.unlock, exact: true })).toBeVisible();
  await page.getByRole("button", { name: r.manage, exact: true }).first().click();
  await page.getByLabel(r.note).fill("Synthetic recipient verified");
  await page.getByRole("button", { name: c.confirm, exact: true }).click();
  await expect(
    page.locator("tbody tr").first().getByText(r.statuses.approved, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: r.manage, exact: true }).first().click();
  await page.getByLabel(r.note).fill("Synthetic delivery reference");
  await page.getByRole("button", { name: c.confirm, exact: true }).click();
  await expect(
    page.locator("tbody tr").first().getByText(r.statuses.delivered, { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: r.export }).click();
  expect((await download).suggestedFilename()).toBe("rewards.csv");
  expect(writes.map((w) => w.path.split("/").pop())).toEqual([
    "freeze",
    "status",
    "status",
    "export",
  ]);
  expect(writes[1]!.body).toMatchObject({ status: "approved", version: 0 });
  expect(writes[2]!.body).toMatchObject({ status: "delivered", version: 1 });
});
test("support sees only masked destinations and cannot approve, export or change locks", async ({
  page,
}) => {
  await mockAdmin(page, "support");
  await page.goto("/admin");
  await nav(page);
  for (const name of [r.manage, r.export, r.lock, r.freeze])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: r.destinations, exact: true }).click();
  await expect(page.getByText("••••4567", { exact: true })).toBeVisible();
  await expect(page.getByText("01234567", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: r.view }).click();
  await expect(page.getByText(p.history, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: p.uid, exact: true })).toHaveCount(0);
});
for (const width of [360, 1440])
  test(`reward admin layouts ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : 1000 });
    await mockAdmin(page);
    await page.goto("/admin");
    await nav(page);
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    await capture(page, info, `snapshot-${width === 360 ? "mobile" : "desktop"}.png`);
    await page.getByRole("button", { name: r.destinations, exact: true }).click();
    await expect(page.getByText("01234567", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: r.view }).click();
    await expect(page.getByRole("checkbox")).toBeVisible();
    await capture(page, info, `destinations-${width === 360 ? "mobile" : "desktop"}.png`);
  });
for (const width of [360, 1440])
  for (const count of [3, 30])
    test(`reward profile review and lock ${width}px with ${count} assets`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 1000 });
      const fixture = await setupPrediction(page, count);
      let locked = false;
      const writes: Record<string, unknown>[] = [];
      let row = { bybitUid: "", mantleAddress: "", changedAt: null as string | null };
      await page.route("**/api/rewards/destination", (route) => {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON() as Record<string, unknown>;
          expect(route.request().headers().authorization).toContain("Bearer ");
          writes.push(body);
          row = {
            bybitUid: String(body.bybitUid),
            mantleAddress: String(body.mantleAddress),
            changedAt: at,
          };
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({
          json: {
            ...row,
            locked,
            lockedSeasons: locked ? ["synthetic-season"] : [],
            history: row.changedAt
              ? [
                  {
                    id: "history-1",
                    actor: "player",
                    changedAt: at,
                    oldValues: { bybitUid: "", mantleAddress: "" },
                    newValues: { bybitUid: "••••4567", mantleAddress: "" },
                  },
                ]
              : [],
          },
        });
      });
      try {
        await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
        await page
          .locator(".tabs-bottom")
          .getByRole("button", { name: en.tabs.profile, exact: true })
          .click();
        const panel = page.getByRole("region", { name: p.title, exact: true });
        await panel.getByLabel(p.uid, { exact: true }).fill("01234567");
        await panel.getByRole("button", { name: p.review, exact: true }).click();
        await expect(panel.getByRole("button", { name: p.save })).toBeDisabled();
        expect(writes).toHaveLength(0);
        await panel.getByRole("checkbox", { name: p.confirm }).check();
        if (count === 3)
          await capture(page, info, `profile-review-${width === 360 ? "mobile" : "desktop"}.png`);
        await panel.getByRole("button", { name: p.save }).click();
        await expect(panel.getByText(p.saved, { exact: true })).toBeVisible();
        expect(writes[0]).toMatchObject({
          bybitUid: "01234567",
          confirmed: true,
          expectedChangedAt: null,
        });
        locked = true;
        await page.reload();
        await page
          .locator(".tabs-bottom")
          .getByRole("button", { name: en.tabs.profile, exact: true })
          .click();
        await expect(panel.getByText(p.locked, { exact: true })).toBeVisible();
        await expect(panel.getByLabel(p.uid, { exact: true })).toBeDisabled();
        await expect(panel.getByText("••••4567", { exact: false })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (count === 3)
          await capture(page, info, `profile-locked-${width === 360 ? "mobile" : "desktop"}.png`);
      } finally {
        await fixture.close();
      }
    });
