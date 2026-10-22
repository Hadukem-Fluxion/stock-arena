import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { resolve } from "node:path";
import { en } from "../src/copy/en.js";

const c = en.admin,
  o = c.ops;
const ownerId = "d4ee5e5e-d845-4fee-98ca-dba31add46ac",
  playerId = "244091b4-3408-4c01-95da-3ff14d8937f5";
const questionId = "322d44a2-a292-49b3-92f7-4779b64d7916",
  flagId = "95677b90-f93c-43a4-968d-7ad635496fa5";
const at = "2026-10-22T10:00:00Z";
const paged = <T>(entries: T[]) => ({ entries, page: 1, hasMore: false });
const player = {
  id: playerId,
  displayName: "Jamie · Demo player",
  avatarUrl: null,
  createdAt: at,
  status: "active",
};
// Invented content only: never load the private campaign bank in tests/captures.
const question = {
  id: questionId,
  slug: "demo-question",
  prompt: "Which synthetic marker is labeled B?",
  topic: "Demo markers",
  options: ["Marker A", "Marker B", "Marker C", "Marker D"],
  answerIndex: 1,
  explanation: "This is invented review content.",
  active: true,
  scheduledDay: null,
  frozenToday: false,
};
const flag = {
  id: flagId,
  userId: playerId,
  displayName: player.displayName,
  raisedBy: ownerId,
  note: "Synthetic review report. Check the activity before acting.",
  state: "open",
  createdAt: at,
};
async function mock(page: Page, role = "owner") {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let status = "active";
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (request.method() === "POST") {
      expect(request.headers()["x-admin-csrf"]).toBe("synthetic-csrf");
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      if (path.endsWith("/status")) status = String(body.status);
      return route.fulfill({
        json: { ok: true, ...(path.endsWith("/import") ? { count: 1 } : {}) },
      });
    }
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          user: { id: ownerId, displayName: "Alex · Demo operator", role },
          permissions: [
            "overview:read",
            "audit:read",
            "players:read",
            "flags:read",
            ...(role === "support"
              ? []
              : role === "moderator"
                ? ["flags:write"]
                : [
                    "quiz:read",
                    "quiz:write",
                    "players:write",
                    "points:write",
                    "flags:write",
                    "flags:resolve",
                  ]),
          ],
          csrf: "synthetic-csrf",
          expiresAt: "2026-10-22T22:00:00Z",
        },
      });
    if (path.endsWith("/quiz"))
      return route.fulfill({
        json: paged([
          question,
          {
            ...question,
            id: flagId,
            slug: "demo-frozen",
            prompt: "Invented frozen question for review.",
            frozenToday: true,
          },
        ]),
      });
    if (path.endsWith("/players")) return route.fulfill({ json: paged([{ ...player, status }]) });
    if (path.endsWith(`/players/${playerId}`))
      return route.fulfill({
        json: {
          user: { ...player, status },
          balance: "125",
          accountAgeDays: 3,
          eligibility: { accountActive: status === "active", verification: "pending" },
          identities: [
            {
              userId: playerId,
              platform: "discord",
              platformUserId: "200000000000000002",
              platformCreatedAt: "2020-01-01T00:00:00Z",
            },
          ],
          ledger: paged([
            {
              id: questionId,
              userId: playerId,
              amount: 10,
              reason: "checkin",
              refId: "checkin:2026-10-22",
              createdAt: at,
            },
          ]),
          runs: paged([
            { id: flagId, model: "prediction", day: "2026-10-22", correctCount: 1, endedAt: null },
          ]),
          predictions: [
            {
              id: questionId,
              runId: flagId,
              ticker: "DEMO",
              state: "pending",
              direction: "up",
              lockedAt: at,
              settledAt: null,
            },
          ],
          classic: [],
          attempts: paged([{ day: "2026-10-22", score: 40, answers: [1, 0, 2], startedAt: [at] }]),
          checkins: paged([{ day: "2026-10-22", streak: 3 }]),
        },
      });
    if (path.endsWith("/flags")) return route.fulfill({ json: paged([flag]) });
    if (path.endsWith(`/flags/${flagId}`))
      return route.fulfill({
        json: {
          flag,
          notes: paged([
            {
              id: questionId,
              flagId,
              actorId: ownerId,
              note: "Synthetic note: pending manual review.",
              createdAt: at,
            },
          ]),
        },
      });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  return writes;
}
async function navigate(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
}
test("quiz editor, frozen restrictions, scheduling and private JSON import", async ({ page }) => {
  const writes = await mock(page);
  await page.goto("/admin");
  await navigate(page, c.quiz);
  await page
    .getByRole("row")
    .filter({ hasText: "demo-frozen" })
    .getByRole("button", { name: o.openRecord, exact: true })
    .click();
  const editor = page.getByRole("region", { name: o.editQuestion });
  await expect(editor.getByLabel(o.answer, { exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: c.cancel }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "demo-question" })
    .getByRole("button", { name: o.editQuestion, exact: true })
    .click();
  await editor
    .getByRole("textbox", { name: o.prompt, exact: true })
    .fill("Edited invented marker for test");
  await editor.getByRole("button", { name: o.saveQuestion }).click();
  await expect(page.getByText(c.saved, { exact: true })).toBeVisible();
  expect(writes[0]?.body.prompt).toBe("Edited invented marker for test");
  await page.getByLabel(`${o.scheduledDay}: demo-question`, { exact: true }).fill("2026-10-23");
  await page
    .getByRole("row")
    .filter({ hasText: "demo-question" })
    .getByRole("button", { name: o.schedule, exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(2);
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByLabel(o.importJson).setInputFiles({
    name: "synthetic.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          id: "synthetic-import",
          topic: "Invented",
          prompt: "Synthetic?",
          options: ["A", "B", "C", "D"],
          answer_index: 0,
          explanation: "Invented",
        },
      ]),
    ),
  });
  await page.getByRole("button", { name: o.importButton }).click();
  await expect(page.getByText(o.imported(1))).toBeVisible();
});
test("player search, suspension, point adjustment and moderator flagging", async ({ page }) => {
  const writes = await mock(page);
  await page.goto("/admin");
  await navigate(page, c.players);
  await page.getByLabel(o.searchPlayers).fill("200000000000000002");
  await page.getByRole("button", { name: o.search, exact: true }).click();
  await page.getByRole("button", { name: o.openRecord, exact: true }).click();
  await expect(page.getByText(o.verificationPending)).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  const statusForm = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: o.changeStatus, exact: true }) });
  await statusForm.getByLabel(o.reason, { exact: true }).fill("Synthetic review");
  await statusForm.getByRole("button", { name: o.changeStatus, exact: true }).click();
  await expect(page.getByText(o.states.suspended, { exact: true }).first()).toBeVisible();
  const adjustForm = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: o.adjust, exact: true }) });
  await adjustForm.getByLabel(o.amount, { exact: true }).fill("-5");
  await adjustForm.getByLabel(o.reason, { exact: true }).fill("Synthetic correction");
  await adjustForm.getByRole("button", { name: o.adjust, exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]?.body).toMatchObject({
    amount: -5,
    reason: "Synthetic correction",
    requestId: expect.any(String),
  });
  const raiseForm = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: o.raise, exact: true }) });
  await raiseForm.getByLabel(o.note, { exact: true }).fill("Invented report");
  await raiseForm.getByRole("button", { name: o.raise, exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
});
test("support cannot edit or view answer keys; moderator notes do not grant resolution", async ({
  page,
}) => {
  await mock(page, "support");
  await page.goto("/admin");
  await expect(page.getByRole("navigation").getByRole("button", { name: c.quiz })).toHaveCount(0);
  await navigate(page, c.players);
  await page.getByRole("button", { name: o.openRecord, exact: true }).click();
  await expect(page.getByRole("heading", { name: o.adjust, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: o.changeStatus, exact: true })).toHaveCount(0);
  await navigate(page, c.flags);
  await page.getByRole("button", { name: o.openRecord, exact: true }).click();
  await expect(page.getByRole("button", { name: o.addNote })).toHaveCount(0);
  await page.unrouteAll();
  const writes = await mock(page, "moderator");
  await page.reload();
  await navigate(page, c.flags);
  await page.getByRole("button", { name: o.openRecord, exact: true }).click();
  await page.getByLabel(o.note, { exact: true }).fill("Synthetic follow-up");
  await page.getByRole("button", { name: o.addNote }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.getByRole("button", { name: o.resolve, exact: true })).toHaveCount(0);
});
for (const width of [360, 1440])
  test(`operations layouts and synthetic screenshots at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : 1000 });
    await mock(page);
    await page.goto("/admin");
    await page.evaluate(() => document.fonts.ready);
    for (const screen of ["quiz", "players", "flags"] as const) {
      await navigate(page, c[screen]);
      if (screen === "quiz")
        await expect(page.getByText(question.prompt, { exact: true })).toBeVisible();
      else await page.getByRole("button", { name: o.openRecord, exact: true }).click();
      if (screen === "players") await expect(page.getByText(o.verificationPending)).toBeVisible();
      if (screen === "flags")
        await expect(page.getByText("Synthetic note: pending manual review.")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const name = `admin-${screen}-${width === 360 ? "mobile" : "desktop"}.png`,
        path = info.outputPath(name);
      await page.screenshot({ path, fullPage: true });
      await info.attach(name, { path, contentType: "image/png" });
      if (process.env.ADMIN_REVIEW_CAPTURES === "1")
        await page.screenshot({ path: resolve("docs/review/t29", name), fullPage: true });
    }
  });
