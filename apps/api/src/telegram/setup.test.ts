import { describe, expect, it, vi } from "vitest";
import { setupTelegram } from "./setup.js";
import { telegramWebAppUrl, telegramWebhookUrl } from "./config.js";
import { en } from "../../../web/src/copy/en.js";

const env = {
  TELEGRAM_BOT_TOKEN: "123456789:synthetic-setup-token",
  TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_setup_32_chars",
};

describe("Telegram operator setup", () => {
  it("treats an empty optional webhook override like an absent setting", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: true }));
    await setupTelegram({ ...env, TELEGRAM_WEBHOOK_URL: "" }, request);
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body)).url).toBe(telegramWebhookUrl);
  });
  it("switches only the webhook to Ohio, keeping the Mini App on Vercel", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: true }));
    await setupTelegram(
      { ...env, TELEGRAM_WEBHOOK_URL: "https://77-114-44-78.sslip.io/api/telegram/webhook" },
      request,
    );
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body)).url).toBe(
      "https://77-114-44-78.sslip.io/api/telegram/webhook",
    );
    expect(JSON.parse(String(request.mock.calls[2]![1]!.body)).menu_button.web_app.url).toBe(
      telegramWebAppUrl,
    );
  });
  it.each([
    "http://api.example/api/telegram/webhook",
    "https://secret@example.com/api/telegram/webhook",
    "https://api.example/wrong",
    "https://api.example/api/telegram/webhook?token=synthetic",
  ])("rejects unsafe webhook override before contacting Telegram: %s", async (url) => {
    const request = vi.fn<typeof fetch>();
    await expect(setupTelegram({ ...env, TELEGRAM_WEBHOOK_URL: url }, request)).rejects.toThrow(
      "Telegram setup failed.",
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("sets the webhook, commands and default Play menu using mocked Telegram requests", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true, result: true }));
    expect(await setupTelegram(env, request)).toBe(3);
    expect(request).toHaveBeenCalledTimes(3);
    const expected = [
      [
        "setWebhook",
        {
          url: telegramWebhookUrl,
          secret_token: env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ["message"],
        },
      ],
      [
        "setMyCommands",
        {
          commands: [
            { command: "start", description: en.telegramBot.startDescription },
            { command: "help", description: en.telegramBot.helpDescription },
          ],
        },
      ],
      [
        "setChatMenuButton",
        { menu_button: { type: "web_app", text: "Play", web_app: { url: telegramWebAppUrl } } },
      ],
    ] as const;
    for (const [i, [method, body]] of expected.entries()) {
      const call = request.mock.calls[i]!;
      expect(call[0]).toBe(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`);
      expect(call[1]).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
      });
      expect(call[1]!.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(String(call[1]!.body))).toEqual(body);
    }
    // Repeating the operator command updates the same settings; no polling or messages.
    await setupTelegram(env, request);
    expect(request).toHaveBeenCalledTimes(6);
  });
  it.each([
    {},
    { ...env, TELEGRAM_BOT_TOKEN: "invalid" },
    { ...env, TELEGRAM_WEBHOOK_SECRET: "short" },
    { ...env, TELEGRAM_WEBHOOK_SECRET: "invalid secret".repeat(4) },
  ])("rejects invalid configuration before HTTP", async (config) => {
    const request = vi.fn<typeof fetch>();
    await expect(setupTelegram(config, request)).rejects.toThrow("Telegram setup failed.");
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["network", "http", "api", "malformed", "result", "partial"])(
    "sanitizes %s errors and stops further settings",
    async (kind) => {
      const request = vi.fn<typeof fetch>(async () => {
        if (kind === "partial" && request.mock.calls.length === 1)
          return Response.json({ ok: true, result: true });
        if (kind === "network" || kind === "partial")
          throw new Error(
            `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook ${env.TELEGRAM_WEBHOOK_SECRET}`,
          );
        if (kind === "http")
          return Response.json({ description: env.TELEGRAM_BOT_TOKEN }, { status: 401 });
        if (kind === "malformed") return new Response(env.TELEGRAM_WEBHOOK_SECRET);
        if (kind === "result") return Response.json({ ok: true, result: env.TELEGRAM_BOT_TOKEN });
        return Response.json({ ok: false, description: env.TELEGRAM_WEBHOOK_SECRET });
      });
      const failure: unknown = await setupTelegram(env, request).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toMatchObject({ message: "Telegram setup failed." });
      expect(failure).not.toHaveProperty("cause");
      expect(request).toHaveBeenCalledTimes(kind === "partial" ? 2 : 1);
    },
  );
});
