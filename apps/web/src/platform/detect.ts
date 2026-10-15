export type Host = "discord" | "telegram" | "browser";

/**
 * Detects where the app is running.
 * - Discord Activities load with a `frame_id` query param inside an iframe.
 * - Telegram Mini Apps pass `tgWebAppData` in the URL hash on launch.
 * Detection selects a bridge only; the server still verifies all identities.
 */
export function detectHost(location: Pick<Location, "search" | "hash"> = window.location): Host {
  const params = new URLSearchParams(location.search);
  if (params.has("frame_id")) return "discord";
  if (new URLSearchParams(location.hash.replace(/^#/, "")).has("tgWebAppData")) return "telegram";
  return "browser";
}
