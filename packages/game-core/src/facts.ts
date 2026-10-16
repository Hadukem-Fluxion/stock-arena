import type { Ticker } from "./config.js";

/**
 * Short facts shown with the Stock of the Day. Keep each under 140 characters,
 * neutral and verifiable. No price targets or advice.
 * TODO(T06): Claude adds more facts per ticker and rotates them.
 */
export const STOCK_FACTS: Partial<Record<Ticker, string[]>> = {
  AAPL: ["Apple designs the iPhone, Mac and iPad, and runs the App Store."],
  MSFT: ["Microsoft makes Windows and Office and runs the Azure cloud platform."],
  GOOGL: ["Alphabet is the parent company of Google, YouTube and Waymo."],
  AMZN: ["Amazon runs one of the largest online stores and the AWS cloud platform."],
  META: ["Meta owns Facebook, Instagram, WhatsApp and Threads."],
  NVDA: ["Nvidia designs GPUs used for gaming, data centers and AI training."],
  TSLA: ["Tesla builds electric cars, home batteries and solar products."],
};

export const XSTOCK_EXPLAINER =
  "An xStock is a token on Mantle that tracks a real stock and is backed 1:1 by the underlying share.";
