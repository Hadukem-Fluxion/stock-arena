/**
 * Every player-facing string lives here. English only.
 * Keep the tone short, friendly and plain. No price predictions or advice.
 */
export const en = {
  appName: "Stock Arena",
  tagline: "Play daily with tokenized stocks. Live prices from Fluxion on Mantle.",
  disclaimer:
    "For entertainment and education only. Not financial advice. Points have no cash value.",
  regionNotice: "xStocks are not available in the United States and other restricted regions.",
  host: {
    discord: "Running in Discord",
    telegram: "Running in Telegram",
    browser: "Running in a browser (development mode)",
  },
  tabs: {
    play: "Play",
    leaderboard: "Leaderboard",
    profile: "Profile",
  },
  labels: {
    stockOfTheDay: "Stock of the Day",
    launchSet: "Launch set",
  },
  status: {
    pricesPaused: "Price games are paused while we check price data. Check-in and quiz still work.",
    comingSoon: "Coming soon",
  },
} as const;
