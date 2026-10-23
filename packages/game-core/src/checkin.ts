import type { Asset, AssetCatalog } from "./assets.js";
import type { PointsAward } from "./scoring.js";

/** Public data only: points and dates in this view are computed by the server. */
export type CheckinView = {
  maintenance?: boolean;
  serverTime: string;
  day: string;
  checkedIn: boolean;
  streak: number;
  balance: number;
  awardsToday: PointsAward[];
  catalog: AssetCatalog;
  stock: {
    ticker: string;
    asset: Asset;
    fact: string | null;
    price: {
      usd: string | null;
      change24hPct: number | null;
      takenAt: string | null;
      state: "live" | "paused";
      reason: string | null;
    };
  };
};
