import { describe, expect, it, vi } from "vitest";
import { createHlClient, hlViewSchema } from "./client.js";
import type { PredictionView } from "@stock-arena/game-core";
import type { Session } from "../platform/types.js";

const session: Session = {
  token: "fake-hl-unit-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "61f11783-6200-4dfb-b1a6-a511c558e8a5",
    displayName: "Synthetic",
    avatarUrl: null,
    identity: { platform: "discord", platformUserId: "123" },
  },
};
const view: PredictionView = {
  day: "2026-10-17",
  serverTime: "2026-10-17T12:00:00.000Z",
  runsUsed: 0,
  runsLimit: 3,
  maxCorrect: 10,
  pointsPerCorrect: 5,
  canStart: true,
  runs: [],
};
describe("HL API client", () => {
  it("uses authenticated relative paths and sends only the player's selection", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(view));
    const pick = { runId: session.user.id, roundId: session.user.id, direction: "up" as const };
    expect(await createHlClient(() => session, request).call("pick", pick)).toEqual(view);
    expect(request).toHaveBeenCalledWith(
      "/api/hl/pick",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(pick),
        headers: expect.objectContaining({ Authorization: `Bearer ${session.token}` }),
      }),
    );
  });
  it("recovers a conflicting retry by reading server state without replaying a write", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json(view));
    await createHlClient(() => session, request).call("start");
    expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/hl/start", "/api/hl"]);
  });
  it("rejects missing sessions before making a request", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(createHlClient(() => null, request).call("read")).rejects.toMatchObject({
      code: "session",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("validates server responses and exposes generic failure codes", async () => {
    expect(hlViewSchema.safeParse({ ...view, winner: "SPOILER" }).success).toBe(false);
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ score: 999 }));
    await expect(createHlClient(() => session, request).call("read")).rejects.toMatchObject({
      code: "network",
    });
  });
});
