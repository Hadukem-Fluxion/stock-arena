import { describe, expect, it, vi } from "vitest";
import { ASSETS } from "@stock-arena/game-core";
import type { PricesView } from "@stock-arena/game-core";
import type { Session } from "../platform/types.js";
import { pricesSchema, readPrices } from "./client.js";

const session: Session = {
  token: "fake-stream-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "61f11783-6200-4dfb-b1a6-a511c558e8a5",
    displayName: "Synthetic",
    avatarUrl: null,
    identity: { platform: "discord", platformUserId: "123" },
  },
};
const view: PricesView = {
  serverTime: "2026-10-19T12:00:00.000Z",
  catalog: { AAPL: ASSETS.AAPL },
  prices: [
    {
      ticker: "AAPL",
      priceUsd: "100",
      takenAt: "2026-10-19T12:00:00.000Z",
      change24hPct: 1.5,
      state: "live",
      reason: null,
    },
  ],
};
describe("price SSE client", () => {
  it("parses split UTF-8 and CRLF frames with bearer headers on a relative path", async () => {
    const seen: PricesView[] = [];
    const content = `: heartbeat\r\n\r\nevent: prices\r\ndata: ${JSON.stringify({ ...view, catalog: { AAPL: { ...ASSETS.AAPL, name: "Synthetic Café" } } })}\r\n\r\nevent: prices\r\ndata: ${JSON.stringify(view)}\r\n\r\n`;
    const bytes = new TextEncoder().encode(content);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(stream, { headers: { "content-type": "text/event-stream" } }),
      );
    await readPrices(session, (next) => seen.push(next), new AbortController().signal, request);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.catalog.AAPL!.name).toBe("Synthetic Café");
    expect(request).toHaveBeenCalledWith(
      "/api/prices/stream",
      expect.objectContaining({
        headers: { Authorization: `Bearer ${session.token}`, Accept: "text/event-stream" },
      }),
    );
  });
  it("rejects auth failures without putting credentials into the URL", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(
      readPrices(session, () => {}, new AbortController().signal, request),
    ).rejects.toMatchObject({ code: "session" });
    expect(String(request.mock.calls[0]![0])).not.toContain(session.token);
  });
  it("rejects invalid catalog mappings and malformed stream events", async () => {
    expect(
      pricesSchema.safeParse({ ...view, prices: [{ ...view.prices[0], ticker: "UNKNOWN" }] })
        .success,
    ).toBe(false);
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("event: prices\ndata: {}\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    await expect(
      readPrices(session, () => {}, new AbortController().signal, request),
    ).rejects.toThrow();
  });
});
