import { describe, expect, it, vi } from "vitest";
import { createLeaderboardClient } from "./client.js";
import type { LeaderboardView } from "@stock-arena/game-core";
import type { Session } from "../platform/types.js";

const session: Session = {
  token: "fake-ranking-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "61f11783-6200-4dfb-b1a6-a511c558e8a5",
    displayName: "Synthetic",
    avatarUrl: null,
    identity: { platform: "discord", platformUserId: "123" },
  },
};
const view: LeaderboardView = {
  period: "day",
  platform: "all",
  generatedAt: "2026-10-19T12:00:00.000Z",
  startsAt: "2026-10-19T00:00:00.000Z",
  endsAt: "2026-10-20T00:00:00.000Z",
  season: { id: "season-1", startsAt: "2026-10-16T00:00:00.000Z", endsAt: null, ended: false },
  top: [],
  caller: null,
};
describe("leaderboard client", () => {
  it("requests validated filters with a bearer header", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(view));
    expect(await createLeaderboardClient(() => session, request)("day", "all")).toEqual(view);
    expect(request).toHaveBeenCalledWith(
      "/api/leaderboard?period=day&platform=all",
      expect.objectContaining({ headers: { Authorization: `Bearer ${session.token}` } }),
    );
  });
  it("rejects mismatched filters and requires a live session", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(view));
    await expect(
      createLeaderboardClient(() => session, request)("week", "all"),
    ).rejects.toMatchObject({ code: "network" });
    await expect(createLeaderboardClient(() => null, request)("day", "all")).rejects.toMatchObject({
      code: "session",
    });
  });
});
