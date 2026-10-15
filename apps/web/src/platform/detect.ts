export type Host = "discord" | "telegram" | "browser";

/**
 * Detects where the app is running.
 * - Discord Activities load with a `frame_id` query param inside an iframe.
 * - Telegram Mini Apps pass `tgWebAppData` in the URL hash on launch.
 * Full adapters (login, openExternal) arrive in task T08.
 */
export function detectHost(location: Pick<Location, "search" | "hash"> = window.location): Host {
  const params = new URLSearchParams(location.search);
  if (params.has("frame_id")) return "discord";
  if (location.hash.includes("tgWebAppData")) return "telegram";
  return "browser";
}
