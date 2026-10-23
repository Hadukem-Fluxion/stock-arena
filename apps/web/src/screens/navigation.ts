export const SCREENS = [
  "home",
  "quiz",
  "higherLower",
  "flyer",
  "invite",
  "markets",
  "leaderboard",
  "profile",
] as const;
export type Screen = (typeof SCREENS)[number];
export function readScreen(hash: string): Screen {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("screen");
  return SCREENS.find((screen) => screen === value) ?? "home";
}
/** Preserve Telegram launch parameters across navigation and refresh. */
export function screenHash(hash: string, screen: Screen) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  params.set("screen", screen);
  return `#${params}`;
}
