import { describe, expect, it, vi } from "vitest";
import { registerDiscordCommands } from "./register-commands.js";

const clientId = "123456789012345678";
const secret = "fake-command-registration-secret";
function provider() {
  return vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith("/oauth2/token"))
      return Response.json({ access_token: "fake-command-bearer", token_type: "Bearer" });
    const body: unknown = JSON.parse(String(options?.body));
    return Response.json(
      { ...(body as Record<string, unknown>), id: "234567890123456789" },
      { status: 201 },
    );
  });
}
describe("Discord command registration", () => {
  it("uses client credentials with the command-update scope and individually upserts two global CHAT_INPUT commands", async () => {
    const request = provider();
    expect(
      await registerDiscordCommands(
        { DISCORD_CLIENT_ID: clientId, DISCORD_CLIENT_SECRET: secret },
        request,
      ),
    ).toBe(2);
    const calls = request.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0]?.[0]).toBe("https://discord.com/api/v10/oauth2/token");
    expect(calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      },
    });
    expect(String(calls[0]?.[1]?.body)).toBe(
      "grant_type=client_credentials&scope=applications.commands.update",
    );
    for (const [index, name] of ["arena", "start"].entries()) {
      const call = calls[index + 1];
      expect(call?.[0]).toBe(`https://discord.com/api/v10/applications/${clientId}/commands`);
      expect(call?.[1]).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: { Authorization: "Bearer fake-command-bearer" },
      });
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        name,
        type: 1,
        description: "Open mStocks Arena",
        options: [],
      });
    }
  });
  it("supports a bot token without requesting an OAuth token", async () => {
    const request = provider();
    await registerDiscordCommands(
      { DISCORD_CLIENT_ID: clientId, DISCORD_BOT_TOKEN: "fake-register-bot-token" },
      request,
    );
    expect(request).toHaveBeenCalledTimes(2);
    for (const [, options] of request.mock.calls)
      expect(options?.headers).toMatchObject({ Authorization: "Bot fake-register-bot-token" });
  });
  it("can repeat POST upserts without bulk-overwriting other commands", async () => {
    const request = provider();
    const env = { DISCORD_CLIENT_ID: clientId, DISCORD_BOT_TOKEN: "fake-register-bot-token" };
    await registerDiscordCommands(env, request);
    await registerDiscordCommands(env, request);
    expect(request.mock.calls.every(([, options]) => options?.method === "POST")).toBe(true);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it.each([
    {},
    { DISCORD_CLIENT_ID: "invalid", DISCORD_CLIENT_SECRET: secret },
    { DISCORD_CLIENT_ID: clientId },
  ])("rejects missing configuration without HTTP", async (env) => {
    const request = provider();
    await expect(registerDiscordCommands(env, request)).rejects.toThrow(
      "Discord command registration failed.",
    );
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["network", "http", "token", "command"])("sanitizes %s failures", async (kind) => {
    const request = vi.fn<typeof fetch>(async (url) => {
      if (kind === "network") throw new Error(secret);
      if (kind === "http") return Response.json({ private: secret }, { status: 401 });
      if (kind === "token") return Response.json({ access_token: secret, token_type: "invalid" });
      if (String(url).endsWith("/oauth2/token"))
        return Response.json({ access_token: "fake-command-bearer", token_type: "Bearer" });
      return Response.json({ unexpected: secret });
    });
    await expect(
      registerDiscordCommands(
        { DISCORD_CLIENT_ID: clientId, DISCORD_CLIENT_SECRET: secret },
        request,
      ),
    ).rejects.toMatchObject({ message: "Discord command registration failed." });
  });
});
