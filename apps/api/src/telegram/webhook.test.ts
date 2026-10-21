import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import { en } from "../../../web/src/copy/en.js";
import { parseTelegramText } from "./webhook.js";
import { telegramWebAppUrl } from "./config.js";

const secret = "synthetic_telegram_webhook_secret_32_chars";
const path = "/api/telegram/webhook";
const headers = { "x-telegram-bot-api-secret-token": secret };
const update = (text: string) => ({
  update_id: 1,
  message: { message_id: 1, date: 1792537200, chat: { id: 1234567890123, type: "private" }, text },
});
const server = (webhookSecret: string | undefined = secret) =>
  buildServer({ telegram: { webhookSecret }, auth: { env: {} }, logger: false });

describe("Telegram webhook", () => {
  it.each([undefined, "", "wrong", "X".repeat(secret.length), secret + "extra"])(
    "rejects an absent or invalid secret",
    async (received) => {
      const app = server();
      try {
        const reply = await app.inject({
          method: "POST",
          url: path,
          payload: update("/start"),
          headers: received === undefined ? {} : { "x-telegram-bot-api-secret-token": received },
        });
        expect(reply.statusCode).toBe(401);
        expect(reply.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
      } finally {
        await app.close();
      }
    },
  );
  it.each([undefined, "", "short", "invalid secret".repeat(4)])(
    "fails closed for missing or invalid configuration",
    async (configured) => {
      const app = buildServer({
        telegram: { webhookSecret: configured },
        auth: { env: {} },
        logger: false,
      });
      try {
        expect(
          (await app.inject({ method: "POST", url: path, headers, payload: update("/start") }))
            .statusCode,
        ).toBe(401);
      } finally {
        await app.close();
      }
    },
  );
  it.each(["/start", "/start SyntheticReferral_123", "/start@synthetic_bot SyntheticReferral_123"])(
    "welcomes %s without a session, database or outbound call",
    async (text) => {
      const app = server();
      const request = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Unexpected outbound call."));
      try {
        const reply = await app.inject({
          method: "POST",
          url: path,
          headers,
          payload: update(text),
        });
        expect(reply.statusCode).toBe(200);
        expect(reply.headers["cache-control"]).toBe("no-store");
        expect(reply.json()).toEqual({
          method: "sendMessage",
          chat_id: 1234567890123,
          text: en.telegramBot.welcome,
          reply_markup: {
            inline_keyboard: [[{ text: "Play", web_app: { url: telegramWebAppUrl } }]],
          },
        });
        expect(reply.json().text).toBe(
          "Welcome to mStocks Arena! Play a few minutes a day with tokenized stocks: daily check-in, quiz and Higher or Lower. Points only, no wallet. Not financial advice.",
        );
        expect(reply.body).not.toContain("SyntheticReferral_123");
        expect(request).not.toHaveBeenCalled();
      } finally {
        request.mockRestore();
        await app.close();
      }
    },
  );
  it.each([
    ["/help", en.telegramBot.help],
    ["hello", en.telegramBot.open],
    ["/unknown", en.telegramBot.open],
    ["/starter", en.telegramBot.open],
  ])("handles %s with a Play button", async (text, expected) => {
    const app = server();
    try {
      const reply = await app.inject({
        method: "POST",
        url: path,
        headers,
        payload: update(text!),
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.json()).toMatchObject({
        method: "sendMessage",
        text: expected,
        reply_markup: {
          inline_keyboard: [[{ text: "Play", web_app: { url: telegramWebAppUrl } }]],
        },
      });
      if (text === "/help")
        expect(reply.json().text).toContain("We will never ask for your wallet, seed phrase");
    } finally {
      await app.close();
    }
  });
  it("keeps start payload available in the parser for T13 without echoing or persisting it", () => {
    expect(parseTelegramText("/start SyntheticReferral_123")).toEqual({
      command: "start",
      startPayload: "SyntheticReferral_123",
    });
    expect(parseTelegramText("/start")).toEqual({ command: "start", startPayload: null });
    expect(parseTelegramText("/help ignored")).toEqual({ command: "help", startPayload: null });
  });
  it.each([
    { update_id: 2, callback_query: { id: "synthetic-callback" } },
    { update_id: 3, edited_message: update("/start").message },
    { update_id: 4, message: { chat: { id: 123, type: "private" }, photo: [] } },
    { update_id: 5, message: { chat: { id: -123, type: "group" }, text: "/start" } },
  ])("acknowledges unsupported updates without a sendMessage", async (payload) => {
    const app = server();
    try {
      const reply = await app.inject({ method: "POST", url: path, headers, payload });
      expect(reply.statusCode).toBe(200);
      expect(reply.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });
  it("verifies the secret before parsing JSON and sanitizes malformed authenticated input", async () => {
    const app = server();
    try {
      const invalid = {
        method: "POST" as const,
        url: path,
        payload: "{",
        headers: { "content-type": "application/json" },
      };
      expect((await app.inject(invalid)).statusCode).toBe(401);
      const parsed = await app.inject({ ...invalid, headers: { ...invalid.headers, ...headers } });
      expect(parsed.statusCode).toBe(400);
      expect(parsed.json()).toEqual({ error: { code: "INVALID_INPUT" } });
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            headers,
            payload: {
              update_id: 1,
              message: { chat: { id: "123", type: "private" }, text: "/start" },
            },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
  it("exempts only the exact POST route from player session auth", async () => {
    const app = server();
    app.get(path, async () => ({ unreachable: true }));
    app.post(path + "-extra", async () => ({ unreachable: true }));
    try {
      for (const request of [
        { method: "GET" as const, url: path },
        { method: "POST" as const, url: path + "-extra" },
        { method: "POST" as const, url: "/api/checkin" },
      ]) {
        expect((await app.inject({ ...request, headers })).statusCode).toBe(401);
      }
    } finally {
      await app.close();
    }
  });
  it("never logs the secret, bot token, update payload or private query values", async () => {
    const logs: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    });
    const token = "123456:synthetic-do-not-log-bot-token";
    const app = buildServer({
      telegram: { webhookSecret: secret },
      auth: { env: { TELEGRAM_BOT_TOKEN: token } },
      logger: { stream },
    });
    const payload = {
      ...update("/start synthetic-private-payload"),
      token,
      private: "synthetic-update-private-value",
    };
    try {
      await app.inject({
        method: "POST",
        url: path + "?token=synthetic-private-query",
        headers,
        payload,
      });
      await app.inject({
        method: "POST",
        url: path,
        headers: { "x-telegram-bot-api-secret-token": "synthetic-wrong-secret" },
        payload,
      });
    } finally {
      await app.close();
    }
    const output = logs.join("");
    expect(output.length).toBeGreaterThan(0);
    for (const value of [
      secret,
      token,
      JSON.stringify(payload),
      "synthetic-private-payload",
      "synthetic-update-private-value",
      "synthetic-private-query",
      "synthetic-wrong-secret",
    ])
      expect(output).not.toContain(value);
  });
});
