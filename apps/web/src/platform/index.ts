import { createBrowserAdapter } from "./browser.js";
import { detectHost } from "./detect.js";
import { createDiscordAdapter } from "./discord.js";
import { createTelegramAdapter } from "./telegram.js";
import type { PlatformAdapter } from "./types.js";

let platform: PlatformAdapter | null = null;

/** One adapter per page, including React StrictMode's development remount. */
export function getPlatform(): PlatformAdapter {
  if (platform) return platform;
  const host = detectHost();
  platform =
    host === "discord"
      ? createDiscordAdapter(import.meta.env.VITE_DISCORD_CLIENT_ID ?? "")
      : host === "telegram"
        ? createTelegramAdapter()
        : createBrowserAdapter();
  return platform;
}
