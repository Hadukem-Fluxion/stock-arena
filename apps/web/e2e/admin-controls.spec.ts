import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { resolve } from "node:path";
import { ASSETS } from "@stock-arena/game-core";
import { en } from "../src/copy/en.js";
import { setupPrediction } from "./prediction-fixture.js";
const c = en.admin,
  copy = c.gameControls,
  at = "2026-10-22T12:00:00.000Z";
async function mock(page: Page, count = 3, role = "owner") {
  let paused = true;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const catalog = Object.fromEntries(
    Array.from({ length: count }, (_, n) => [
      `S${n}`,
      {
        ...ASSETS.AAPL,
        name: `Synthetic company ${n + 1}`,
        symbol: `S${n}x`,
        referenceTicker: `S${n}`,
      },
    ]),
  );
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      expect(request.headers()["x-admin-csrf"]).toBe("synthetic-csrf");
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      if (path.endsWith("/games")) paused = Boolean(body.paused);
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          user: {
            id: "d4ee5e5e-d845-4fee-98ca-dba31add46ac",
            displayName: "Alex · Demo operator",
            role,
          },
          permissions: [
            "overview:read",
            "audit:read",
            ...(role === "support"
              ? []
              : [
                  "games:write",
                  "seasons:write",
                  ...(role === "owner" ? ["seasons:past-start"] : []),
                ]),
          ],
          csrf: "synthetic-csrf",
          expiresAt: "2026-10-22T22:00:00.000Z",
        },
      });
    if (path.endsWith("/games"))
      return route.fulfill({
        json: {
          entries: ["checkin", "quiz", "higher_lower"].map((game) => ({
            game,
            paused: game === "quiz" && paused,
            reason: "Synthetic maintenance review",
            updatedAt: at,
          })),
        },
      });
    if (path.endsWith("/tickers"))
      return route.fulfill({
        json: {
          catalog,
          entries: Object.keys(catalog).map((ticker, n) => ({
            ticker,
            manualPaused: n === 0,
            manualReason: n === 0 ? "Synthetic manual review" : "",
            state: n === 0 ? "paused" : "live",
            reason: n === 0 ? "manual" : null,
            oracleState: "live",
            oracleReason: null,
            updatedAt: at,
            priceUsd: "123.45",
          })),
        },
      });
    if (path.endsWith("/seasons"))
      return route.fulfill({
        json: {
          serverTime: at,
          entries: [
            {
              id: "season-1",
              name: "Season 1",
              startsAt: "2026-10-16T00:00:00.000Z",
              endsAt: null,
            },
          ],
        },
      });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  return writes;
}
async function nav(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
}
test("admin resumes a game and manually controls a ticker with reason and confirmation", async ({
  page,
}) => {
  const writes = await mock(page);
  page.on("dialog", (d) => d.accept());
  await page.goto("/admin");
  await nav(page, c.games);
  const quiz = page.getByRole("region", { name: copy.names.quiz, exact: true });
  await quiz.getByRole("textbox").fill("Synthetic verified recovery");
  await quiz.getByRole("button", { name: copy.resume, exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.body).toEqual({
    game: "quiz",
    paused: false,
    reason: "Synthetic verified recovery",
  });
  await nav(page, c.tickers);
  await page
    .getByRole("row")
    .filter({ hasText: "Synthetic company 1" })
    .getByRole("button", { name: copy.manage, exact: true })
    .click();
  const editor = page.getByRole("region", { name: copy.manageTicker });
  await expect(editor.getByText(copy.resumeNotice)).toBeVisible();
  await editor.getByRole("textbox").fill("Synthetic manual override cleared");
  await editor.getByRole("button", { name: copy.resume, exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]!.body).toMatchObject({ ticker: "S0", paused: false });
});
test("admin cannot edit past starts; owner edits windows and can create the next season", async ({
  page,
}) => {
  await mock(page, 3, "admin");
  await page.goto("/admin");
  await nav(page, c.seasons);
  await page.getByRole("button", { name: copy.editSeason, exact: true }).click();
  await expect(
    page.getByRole("region", { name: copy.seasonEditor }).getByLabel(copy.starts, { exact: true }),
  ).toBeDisabled();
  await page.unrouteAll();
  const writes = await mock(page);
  await page.reload();
  await nav(page, c.seasons);
  await page.getByRole("button", { name: copy.editSeason, exact: true }).click();
  const editor = page.getByRole("region", { name: copy.seasonEditor });
  await expect(editor.getByLabel(copy.starts, { exact: true })).toBeEnabled();
  await editor.getByLabel(copy.ends, { exact: true }).fill("2026-11-01T00:00");
  await editor
    .getByRole("textbox", { name: c.ops.reason, exact: true })
    .fill("Synthetic campaign boundary");
  page.on("dialog", (d) => d.accept());
  await editor.getByRole("button", { name: copy.saveSeason }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.body).toMatchObject({ create: false, endsAt: "2026-11-01T00:00:00.000Z" });
  await page.getByRole("button", { name: copy.newSeason, exact: true }).click();
  await editor.getByLabel(copy.seasonId, { exact: true }).fill("season-2");
  await editor.getByLabel(copy.seasonName, { exact: true }).fill("Season 2");
  await editor.getByLabel(copy.starts, { exact: true }).fill("2026-11-01T00:00");
  await editor
    .getByRole("textbox", { name: c.ops.reason, exact: true })
    .fill("Synthetic next season");
  await editor.getByRole("button", { name: copy.saveSeason }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]!.body).toMatchObject({ create: true, id: "season-2", endsAt: null });
});
test("support has no game, ticker or season control navigation", async ({ page }) => {
  await mock(page, 3, "support");
  await page.goto("/admin");
  for (const name of [c.games, c.tickers, c.seasons])
    await expect(
      page.getByRole("navigation").getByRole("button", { name, exact: true }),
    ).toHaveCount(0);
});
test("player maintenance copy disables actions and keeps the pending prediction visible", async ({
  page,
}) => {
  const fixture = await setupPrediction(page, 3);
  try {
    await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
    await page
      .locator(".tabs-bottom")
      .getByRole("button", { name: en.tabs.home, exact: true })
      .click();
    await page.getByRole("button", { name: en.games.higherLower.name }).click();
    const panel = page.locator(".hl-panel");
    await panel.getByRole("button", { name: en.hl.start }).click();
    await panel.getByRole("button", { name: en.hl.up, exact: true }).click();
    fixture.pause();
    await page.reload();
    await page
      .locator(".tabs-bottom")
      .getByRole("button", { name: en.tabs.home, exact: true })
      .click();
    await page.getByRole("button", { name: en.games.higherLower.name }).click();
    await expect(panel.getByText(en.maintenance, { exact: true })).toBeVisible();
    await expect(panel.getByText(en.hl.pending, { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: en.hl.start })).toHaveCount(0);
    expect(fixture.picks()).toBe(1);
    await page.route("**/api/quiz", (route) =>
      route.fulfill({
        json: {
          day: "2026-10-22",
          serverTime: new Date().toISOString(),
          maintenance: true,
          status: "ready",
          total: 3,
          answered: 0,
          score: 0,
          question: null,
          feedback: null,
        },
      }),
    );
    await page
      .locator(".tabs-bottom")
      .getByRole("button", { name: en.tabs.home, exact: true })
      .click();
    await page.getByRole("button", { name: en.games.quiz.name }).click();
    const quiz = page.locator(".quiz-panel");
    await expect(quiz.getByText(en.maintenance, { exact: true })).toBeVisible();
    await expect(quiz.getByRole("button", { name: en.quiz.start })).toBeDisabled();
    await page
      .locator(".tabs-bottom")
      .getByRole("button", { name: en.tabs.home, exact: true })
      .click();
    await expect(
      page.locator(".checkin-action").first().getByRole("button").first(),
    ).toBeDisabled();
  } finally {
    await fixture.close();
  }
});
for (const width of [360, 1440])
  for (const count of [3, 30])
    test(`control layouts ${width}px with ${count} assets`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 1000 });
      await mock(page, count);
      await page.goto("/admin");
      await page.evaluate(() => document.fonts.ready);
      for (const screen of ["games", "tickers", "seasons"] as const) {
        await nav(page, c[screen]);
        if (screen === "games")
          await expect(
            page.getByRole("region", { name: copy.names.quiz, exact: true }),
          ).toBeVisible();
        if (screen === "tickers") await expect(page.locator("tbody tr")).toHaveCount(count);
        if (screen === "seasons")
          await expect(
            page.getByRole("button", { name: copy.editSeason, exact: true }),
          ).toBeVisible();
        if (screen === "seasons")
          await page.getByRole("button", { name: copy.editSeason, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (count === 30 && screen !== "tickers") continue;
        await page.evaluate(() => {
          (document.activeElement as HTMLElement | null)?.blur();
          window.scrollTo(0, 0);
        });
        const name = `${screen}-${width === 360 ? "mobile" : "desktop"}${screen === "tickers" ? `-${count}` : ""}.png`,
          path = info.outputPath(name);
        await page.screenshot({ path, fullPage: screen !== "tickers" });
        await info.attach(name, { path, contentType: "image/png" });
        if (process.env.CONTROLS_REVIEW_CAPTURES === "1")
          await page.screenshot({
            path: resolve("docs/review/t30", name),
            fullPage: screen !== "tickers",
          });
      }
    });
