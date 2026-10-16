import { generateKeyPairSync, sign } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { discordCopy } from "./copy.js";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");
const timestamp = "1792176000";
const path = "/api/discord/interactions";
function headers(body: string, time = timestamp) {
  return {
    "content-type": "application/json; charset=utf-8",
    "x-signature-timestamp": time,
    "x-signature-ed25519": sign(null, Buffer.from(time + body, "utf8"), keys.privateKey).toString(
      "hex",
    ),
  };
}
const server = () => buildServer({ discord: { publicKey }, auth: { env: {} }, logger: false });

describe("Discord Interactions endpoint", () => {
  it("answers signed PING with PONG without a session, database or provider secrets", async () => {
    const app = server();
    const body = '{ "type": 1 }\r\n';
    try {
      const response = await app.inject({
        method: "POST",
        url: path,
        payload: body,
        headers: headers(body),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ type: 1 });
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });
  it.each(["arena", "start"])("launches the Activity for /%s", async (name) => {
    const app = server();
    const body = JSON.stringify({
      type: 2,
      data: { name, type: 1 },
      token: "fake-discord-interaction-token",
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: path,
        payload: body,
        headers: headers(body),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ type: 12 });
    } finally {
      await app.close();
    }
  });
  it("uses the raw UTF-8 bytes including spacing, line endings and Unicode", async () => {
    const app = server();
    const raw =
      '{\r\n  "type" : 2, "data" : { "type": 1, "name": "arena" }, "note": "café 🚀"\r\n}\r\n';
    const serialized = JSON.stringify(JSON.parse(raw));
    try {
      expect(
        (
          await app.inject({ method: "POST", url: path, payload: raw, headers: headers(raw) })
        ).json(),
      ).toEqual({ type: 12 });
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            payload: serialized,
            headers: headers(raw),
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            payload: raw,
            headers: headers(serialized),
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
  it.each([
    "both",
    "signature",
    "timestamp",
    "malformedSignature",
    "malformedTimestamp",
    "wrongSigner",
    "changedTimestamp",
    "changedBody",
  ])("rejects %s signature input with 401", async (kind) => {
    const app = server();
    const body = '{"type":1}';
    const signed: Record<string, string> = headers(body);
    if (kind === "both" || kind === "signature") delete signed["x-signature-ed25519"];
    if (kind === "both" || kind === "timestamp") delete signed["x-signature-timestamp"];
    if (kind === "malformedSignature") signed["x-signature-ed25519"] = "not-hex";
    if (kind === "malformedTimestamp") signed["x-signature-timestamp"] = "not-a-time";
    if (kind === "changedTimestamp") signed["x-signature-timestamp"] = "1792176001";
    if (kind === "wrongSigner")
      signed["x-signature-ed25519"] = sign(
        null,
        Buffer.from(timestamp + body),
        generateKeyPairSync("ed25519").privateKey,
      ).toString("hex");
    try {
      const response = await app.inject({
        method: "POST",
        url: path,
        payload: kind === "changedBody" ? '{"type":2}' : body,
        headers: signed,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    } finally {
      await app.close();
    }
  });
  it.each([
    { type: 2, data: { name: "rank", type: 1 } },
    { type: 2, data: { name: "arena", type: 2 } },
  ])("returns static ephemeral copy for unsupported commands", async (input) => {
    const app = server();
    const body = JSON.stringify(input);
    try {
      const response = await app.inject({
        method: "POST",
        url: path,
        payload: body,
        headers: headers(body),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        type: 4,
        data: { content: discordCopy.unknownCommand, flags: 64, allowed_mentions: { parse: [] } },
      });
    } finally {
      await app.close();
    }
  });
  it.each(["{broken", '{"type":2}', '{"type":2,"data":{"name":123}}', '{"type":3}'])(
    "rejects signed malformed payloads without parser details",
    async (body) => {
      const app = server();
      try {
        const response = await app.inject({
          method: "POST",
          url: path,
          payload: body,
          headers: headers(body),
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: { code: "INVALID_INPUT" } });
      } finally {
        await app.close();
      }
    },
  );
  it.each([undefined, "invalid-key"])(
    "fails closed when DISCORD_PUBLIC_KEY is not configured correctly",
    async (key) => {
      const app = buildServer({ discord: { publicKey: key }, auth: { env: {} }, logger: false });
      const body = '{"type":1}';
      try {
        expect(
          (await app.inject({ method: "POST", url: path, payload: body, headers: headers(body) }))
            .statusCode,
        ).toBe(503);
        expect(
          (
            await app.inject({
              method: "POST",
              url: path,
              payload: body,
              headers: { "content-type": "application/json" },
            })
          ).statusCode,
        ).toBe(401);
      } finally {
        await app.close();
      }
    },
  );
  it("keeps other API routes session-protected and preserves normal JSON parsing", async () => {
    const app = server();
    app.post("/api/discord/interactions-extra", async () => ({ unreachable: true }));
    try {
      expect(
        (await app.inject({ method: "POST", url: "/api/checkin", payload: {} })).statusCode,
      ).toBe(401);
      expect(
        (await app.inject({ method: "POST", url: "/api/discord/interactions-extra", payload: {} }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/discord",
            payload: { code: "fake-auth-code" },
          })
        ).json(),
      ).toEqual({ error: { code: "AUTH_UNAVAILABLE" } });
    } finally {
      await app.close();
    }
  });
  it("does not log interaction tokens, raw bodies or query values", async () => {
    const logs: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    });
    const app = buildServer({ discord: { publicKey }, auth: { env: {} }, logger: { stream } });
    const body = JSON.stringify({ type: 1, token: "fake-interaction-token-not-for-logs" });
    try {
      await app.inject({
        method: "POST",
        url: path + "?code=fake-private-query",
        payload: body,
        headers: headers(body),
      });
      await app.inject({
        method: "POST",
        url: path,
        payload: body,
        headers: { "content-type": "application/json" },
      });
    } finally {
      await app.close();
    }
    const output = logs.join("");
    expect(output.length).toBeGreaterThan(0);
    for (const value of [body, "fake-interaction-token-not-for-logs", "fake-private-query"])
      expect(output).not.toContain(value);
  });
});
