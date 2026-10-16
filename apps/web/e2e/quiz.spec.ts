import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { QuizFeedback, QuizView } from "@stock-arena/game-core";
import { en } from "../src/copy/en.js";

// Every question here is invented; the private bank is never a browser fixture.
const ids = [
  "98d3639a-59fc-463e-a28b-094346a6edc9",
  "c98827f9-6559-49bc-965f-d4b4f976970c",
  "3b0d4614-049d-439b-b258-cd2de0696b98",
];
const options: [string, string, string, string] = [
  "Synthetic A",
  "Synthetic B",
  "Synthetic C",
  "Synthetic D",
];
const prompt = "Pick the synthetic test marker. This text exists only for interface verification.";
function state(
  status: QuizView["status"],
  position = 0,
  feedback: QuizFeedback | null = null,
): QuizView {
  const now = new Date();
  return {
    day: now.toISOString().slice(0, 10),
    serverTime: now.toISOString(),
    status,
    total: 3,
    answered: status === "completed" ? 3 : status === "feedback" ? position + 1 : position,
    score: status === "completed" ? 75 : position * 20,
    question:
      status === "question"
        ? {
            id: ids[position]!,
            position,
            topic: "synthetic",
            prompt,
            options,
            servedAt: now.toISOString(),
            deadline: new Date(now.getTime() + 30_000).toISOString(),
          }
        : null,
    feedback,
  };
}
async function setup(page: Page) {
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        initData: "fake-quiz-init-data",
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
          token: "fake-quiz-token",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          user: {
            id: ids[0],
            displayName: "Synthetic quiz player",
            avatarUrl: null,
            identity: { platform: "telegram", platformUserId: "123" },
          },
        },
      },
    }),
  );
  await page.route("**/api/checkin", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "INTERNAL_ERROR" } } }),
  );
}
async function openQuiz(page: Page) {
  await page.goto("http://127.0.0.1:5174/#tgWebAppData=mock");
  await page.getByRole("button", { name: en.games.quiz.name }).click();
}
for (const width of [360, 1440])
  test(`quiz completes with server feedback at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    let view = state("ready");
    let position = 0;
    let answers = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/quiz{,/**}", async (route) => {
      const path = new URL(route.request().url()).pathname;
      expect(route.request().headers().authorization).toBe("Bearer fake-quiz-token");
      if (path.endsWith("/start")) view = state("question");
      if (path.endsWith("/next")) {
        position++;
        view = state("question", position);
      }
      if (path.endsWith("/answer")) {
        answers++;
        expect(route.request().postDataJSON()).toEqual({
          day: view.day,
          questionId: ids[position],
          position,
          choice: 0,
        });
        if (position === 0) await gate;
        const feedback: QuizFeedback = {
          questionId: ids[position]!,
          position,
          choice: 0,
          correct: true,
          timedOut: false,
          correctOption: 0,
          prompt,
          options,
          explanation: "Synthetic explanation returned only after the answer.",
        };
        view = state(position === 2 ? "completed" : "feedback", position, feedback);
      }
      await route.fulfill({ json: view });
    });
    await openQuiz(page);
    const panel = page.locator(".quiz-panel");
    await panel.getByRole("button", { name: en.quiz.start }).click();
    await expect(panel.locator(".quiz-prompt")).toHaveText(prompt);
    await expect(panel).not.toContainText("Synthetic explanation");
    await panel.getByRole("button", { name: "A Synthetic A", exact: true }).click();
    await expect.poll(() => answers).toBe(1);
    await expect(panel.getByRole("button", { name: "A Synthetic A", exact: true })).toBeDisabled();
    await expect(panel.locator(".quiz-result")).toHaveCount(0);
    release();
    await expect(panel.getByRole("status")).toContainText("Synthetic explanation");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`quiz-feedback-${width}.png`),
      fullPage: true,
    });
    for (let index = 0; index < 2; index++) {
      await panel.getByRole("button", { name: en.quiz.next }).click();
      await panel.getByRole("button", { name: "A Synthetic A", exact: true }).click();
    }
    await expect(panel.locator(".quiz-result")).toContainText("75 pts");
    await expect(panel).toContainText(en.quiz.tomorrow);
    expect(answers).toBe(3);
    await page.getByRole("button", { name: en.games.invite.name }).click();
    await page.getByRole("button", { name: en.games.quiz.name }).click();
    await expect(page.locator(".quiz-result")).toContainText("75 pts");
    await expect(page.getByRole("button", { name: en.quiz.start })).toHaveCount(0);
  });
test("quiz preserves the server deadline after remount and records expiry without a local score", async ({
  page,
}) => {
  await setup(page);
  let view = state("question");
  view.question!.servedAt = new Date(Date.now() - 29_000).toISOString();
  view.question!.deadline = new Date(Date.now() + 1_000).toISOString();
  let posted = 0;
  await page.route("**/api/quiz{,/**}", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/answer")) {
      posted++;
      expect(route.request().postDataJSON().choice).toBeNull();
      view = {
        ...state("feedback"),
        score: 0,
        feedback: {
          prompt,
          options,
          questionId: ids[0]!,
          position: 0,
          choice: null,
          correct: false,
          timedOut: true,
          correctOption: 0,
          explanation: "Synthetic timeout explanation.",
        },
      };
    }
    await route.fulfill({ json: view });
  });
  await openQuiz(page);
  await expect(page.locator(".quiz-panel")).toContainText("1 s left");
  await page.getByRole("button", { name: en.games.invite.name }).click();
  await page.getByRole("button", { name: en.games.quiz.name }).click();
  await expect(page.locator(".quiz-panel").getByRole("status")).toContainText(en.quiz.expired);
  expect(posted).toBe(1);
  await expect(page.locator(".quiz-result")).toHaveCount(0);
});
test("quiz reload recovers a lost answer response without granting points locally", async ({
  page,
}) => {
  await setup(page);
  let saved = false;
  const feedback: QuizFeedback = {
    prompt,
    options,
    questionId: ids[0]!,
    position: 0,
    choice: 0,
    correct: true,
    timedOut: false,
    correctOption: 0,
    explanation: "Synthetic saved reply.",
  };
  await page.route("**/api/quiz{,/**}", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/answer")) {
      saved = true;
      await route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR" } } });
    } else
      await route.fulfill({ json: saved ? state("feedback", 0, feedback) : state("question") });
  });
  await openQuiz(page);
  const panel = page.locator(".quiz-panel");
  await panel.getByRole("button", { name: "A Synthetic A", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(en.quiz.error);
  await panel.getByRole("button", { name: en.quiz.retry }).click();
  await expect(panel.getByRole("status")).toContainText("Synthetic saved reply.");
  await expect(panel.locator(".quiz-result")).toHaveCount(0);
});
