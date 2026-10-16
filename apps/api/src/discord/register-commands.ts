import { z } from "zod";
import { discordCopy } from "./copy.js";

const api = "https://discord.com/api/v10";
const tokenSchema = z.object({ access_token: z.string().min(1), token_type: z.literal("Bearer") });

/** Explicit operator action only; never imported by API startup or called by CI. */
export async function registerDiscordCommands(
  env: Record<string, string | undefined>,
  request: typeof fetch = fetch,
): Promise<number> {
  try {
    const clientId = z
      .string()
      .regex(/^\d{1,20}$/)
      .parse(env.DISCORD_CLIENT_ID);
    async function json(path: string, options: RequestInit): Promise<unknown> {
      const response = await request(`${api}${path}`, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Registration request failed.");
      return (await response.json()) as unknown;
    }
    let authorization: string;
    if (env.DISCORD_CLIENT_SECRET) {
      const credentials = Buffer.from(`${clientId}:${env.DISCORD_CLIENT_SECRET}`, "utf8").toString(
        "base64",
      );
      const token = tokenSchema.parse(
        await json("/oauth2/token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            scope: "applications.commands.update",
          }),
        }),
      );
      authorization = `Bearer ${token.access_token}`;
    } else {
      authorization = `Bot ${z.string().min(1).parse(env.DISCORD_BOT_TOKEN)}`;
    }
    for (const name of ["arena", "start"] as const) {
      // POST upserts only this name/type. Bulk PUT would erase unrelated commands,
      // including the Activity's default entry point and future T15 commands.
      const response = await json(`/applications/${clientId}/commands`, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: 1, description: discordCopy.openArena, options: [] }),
      });
      z.object({ id: z.string().regex(/^\d+$/), name: z.literal(name), type: z.literal(1) }).parse(
        response,
      );
    }
    return 2;
  } catch {
    // Provider errors and validation issues may contain credentials or responses.
    throw new Error("Discord command registration failed.");
  }
}
