import { describe, expect, it, vi } from "vitest";
import { ASSETS } from "@stock-arena/game-core";
import type { CheckinView } from "@stock-arena/game-core";
import { createCheckinClient } from "./client.js";
import { assetLogoUrl } from "../components/AssetLogo.js";

const session = () => ({
  token: "fake-session",
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  user: {
    id: "79703e93-9461-49ad-ae16-4d2a5af06126",
    displayName: "Test",
    avatarUrl: null,
    identity: { platform: "telegram" as const, platformUserId: "123" },
  },
});
const view: CheckinView = {
  serverTime: "2026-10-15T12:00:00.000Z",
  day: "2026-10-15",
  checkedIn: true,
  streak: 1,
  balance: 10,
  awardsToday: [{ amount: 10, reason: "checkin" }],
  catalog: ASSETS,
  stock: {
    ticker: "AAPL",
    asset: ASSETS.AAPL,
    fact: null,
    price: { usd: null, takenAt: null, change24hPct: null, state: "paused", reason: "stale" },
  },
};
describe("authenticated check-in client", () => {
  it("posts only an empty action body with an in-memory bearer token", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(view, { status: 201 }));
    expect(await createCheckinClient(session, request).award()).toEqual(view);
    expect(request).toHaveBeenCalledWith(
      "/api/checkin",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({ Authorization: "Bearer fake-session" }),
        cache: "no-store",
      }),
    );
  });
  it("reloads authoritative state after a duplicate instead of incrementing locally", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: { code: "ALREADY_CHECKED_IN" } }, { status: 409 }),
      )
      .mockResolvedValueOnce(Response.json(view));
    expect(await createCheckinClient(session, request).award()).toEqual(view);
    expect(request.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "GET"]);
  });
  it("rejects missing or expired sessions without a request", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(createCheckinClient(() => null, request).award()).rejects.toMatchObject({
      code: "session",
    });
    await expect(
      createCheckinClient(
        () => ({ ...session(), expiresAt: "2000-01-01T00:00:00.000Z" }),
        request,
      ).read(),
    ).rejects.toMatchObject({ code: "session" });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { ...view, balance: "10" },
    { ...view, catalog: {} },
    {
      ...view,
      stock: { ...view.stock, asset: { ...ASSETS.AAPL, provider: "unconfigured-provider" } },
    },
    {
      ...view,
      stock: { ...view.stock, asset: { ...ASSETS.AAPL, tradeUrl: "javascript:alert(1)" } },
    },
  ])("rejects malformed or unconfigured response data", async (body) => {
    const request = vi.fn<typeof fetch>(async () => Response.json(body));
    await expect(createCheckinClient(session, request).read()).rejects.toMatchObject({
      code: "unavailable",
    });
  });
  it("maps network errors to safe copy keys", async () => {
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error("private connection details");
    });
    await expect(createCheckinClient(session, request).read()).rejects.toMatchObject({
      message: "unavailable",
    });
  });
});
describe("Discord image URL mapping", () => {
  it("maps catalog logos only inside Discord", () => {
    expect(assetLogoUrl(ASSETS.AAPL.logo, true)).toBe("/stock-logos/logos/tokens/AAPLx.png");
    expect(assetLogoUrl(ASSETS.AAPL.logo, false)).toBe(ASSETS.AAPL.logo);
  });
});
