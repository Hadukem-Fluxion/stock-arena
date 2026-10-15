/**
 * Every player-facing string lives here. English only.
 * Keep the tone short, friendly and plain. No price predictions or advice.
 */
export const en = {
  appName: "mStocks Arena",
  tagline: "Live xStock prices, as quoted on Fluxion RFQ.",
  disclaimer:
    "For entertainment and education only. Not financial advice. Points have no cash value.",
  regionNotice: "xStocks are not available in the U.S. or to U.S. persons. Geo restrictions apply.",
  footer: {
    prices: "Prices ·",
    tradeOn: "Trade on",
    builtOn: "Built on",
    xstocks: "xStocks",
    fluxion: "Fluxion",
    mantle: "Mantle",
  },
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
    marketClosed: "Market closed",
  },
} as const;
