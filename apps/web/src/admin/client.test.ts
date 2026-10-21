import { describe, expect, it, vi } from "vitest";
import { createAdminClient } from "./client.js";

describe("admin client", () => {
  it("keeps authentication in same-origin cookies and puts CSRF in a header", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await createAdminClient(fetcher).grant("fake-csrf", { discordId: "123", role: "support" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/team",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Admin-CSRF": "fake-csrf" },
      }),
    );
    expect(fetcher.mock.calls[0]![1]!.headers).not.toHaveProperty("Authorization");
  });
  it("rejects malformed responses and never surfaces raw server error messages", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ user: "bad" }))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "FORBIDDEN" }, message: "private details" },
          { status: 403 },
        ),
      );
    await expect(createAdminClient(fetcher).session()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(createAdminClient(fetcher).team()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FORBIDDEN",
    });
  });
});
