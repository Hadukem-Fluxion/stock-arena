import { describe, expect, it, vi } from "vitest";
import { createQuizClient } from "./client.js";
import type { QuizView } from "@stock-arena/game-core";

const id = "98d3639a-59fc-463e-a28b-094346a6edc9";
const session = () => ({
  token: "fake-quiz-token",
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  user: {
    id,
    displayName: "Synthetic player",
    avatarUrl: null,
    identity: { platform: "discord" as const, platformUserId: "123" },
  },
});
const view: QuizView = {
  day: "2026-10-16",
  serverTime: "2026-10-16T12:00:00.000Z",
  status: "question",
  total: 3,
  answered: 0,
  score: 0,
  question: {
    id,
    position: 0,
    topic: "synthetic",
    prompt: "Which synthetic marker?",
    options: ["Test A", "Test B", "Test C", "Test D"],
    servedAt: "2026-10-16T12:00:00.000Z",
    deadline: "2026-10-16T12:00:30.000Z",
  },
  feedback: null,
};
describe("quiz API client", () => {
  it("sends only choice and server-issued identifiers to a relative authenticated API", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(view));
    const answer = { day: view.day, questionId: id, position: 0, choice: 0 };
    await createQuizClient(session, request).call("answer", answer);
    expect(request).toHaveBeenCalledWith(
      "/api/quiz/answer",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(answer),
        headers: expect.objectContaining({ Authorization: "Bearer fake-quiz-token" }),
        cache: "no-store",
      }),
    );
  });
  it("reloads server state after an out-of-order or expired-day response", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: { code: "QUIZ_OUT_OF_ORDER" } }, { status: 409 }),
      )
      .mockResolvedValueOnce(Response.json(view));
    expect(await createQuizClient(session, request).call("next")).toEqual(view);
    expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/quiz/next", "/api/quiz"]);
  });
  it("does not use the network for an absent or expired session", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(createQuizClient(() => null, request).call("start")).rejects.toMatchObject({
      code: "session",
    });
    await expect(
      createQuizClient(() => ({ ...session(), expiresAt: "2000-01-01T00:00:00Z" }), request).call(
        "start",
      ),
    ).rejects.toMatchObject({ code: "session" });
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects an early answer key and invalid response state", async () => {
    for (const body of [
      { ...view, question: { ...view.question, answerIndex: 0 } },
      { ...view, question: null },
    ]) {
      await expect(
        createQuizClient(session, async () => Response.json(body)).call("start"),
      ).rejects.toMatchObject({ code: "network" });
    }
  });
  it.each([
    [503, "unavailable"],
    [401, "session"],
    [403, "session"],
    [500, "network"],
  ] as const)("maps HTTP %s to safe copy", async (status, code) => {
    await expect(
      createQuizClient(session, async () =>
        Response.json({ error: { code: "test" } }, { status }),
      ).call("start"),
    ).rejects.toMatchObject({ code });
  });
});
