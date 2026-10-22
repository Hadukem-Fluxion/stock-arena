import { describe, expect, it, vi } from "vitest";
import { createOperationsClient } from "./operations-client.js";
describe("admin operations transport", () => {
  it("uses relative cookie-authenticated paths and CSRF for writes, without bearer tokens", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    const client = createOperationsClient(fetcher);
    await client.adjust(
      "synthetic-csrf",
      "synthetic-id",
      -3,
      "Invented correction",
      "synthetic-request",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/players/synthetic-id/adjust",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Admin-CSRF": "synthetic-csrf" },
        body: JSON.stringify({
          amount: -3,
          reason: "Invented correction",
          requestId: "synthetic-request",
        }),
      }),
    );
  });
  it("rejects malformed private bank responses and preserves typed server errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ entries: [{ answerIndex: 9 }], page: 1, hasMore: false }),
      )
      .mockResolvedValueOnce(Response.json({ error: { code: "QUIZ_FROZEN" } }, { status: 409 }));
    const client = createOperationsClient(fetcher);
    await expect(client.quiz()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(client.deactivate("synthetic", "synthetic-id")).rejects.toMatchObject({
      code: "QUIZ_FROZEN",
    });
  });
  it("encodes search filters and sanitizes transport errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("synthetic sensitive transport failure"));
    await expect(createOperationsClient(fetcher).players("demo&other", 2)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/admin/players?search=demo%26other&page=2");
  });
});
