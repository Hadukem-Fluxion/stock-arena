import type { FlyerSegment } from "@stock-arena/game-core";
import { en } from "../copy/en.js";
import { AssetLogo } from "../components/AssetLogo.js";
export function FlyerChart({ segment: s, discord }: { segment: FlyerSegment; discord: boolean }) {
  const values = s.chart ?? (s.prices.length >= 10 ? s.prices : []),
    numbers = values.map(Number);
  const valid = numbers.length >= 10 && numbers.every((n) => Number.isFinite(n) && n > 0);
  const low = Math.min(...numbers),
    high = Math.max(...numbers),
    change = Number(s.changePct);
  const move = `${change > 0 ? "▲ +" : change < 0 ? "▼ " : "• "}${change.toFixed(2)}%`;
  return (
    <div className={`flight-chart ${change < 0 ? "fall" : "rise"}`}>
      <AssetLogo ticker={s.ticker} asset={s.asset} discord={discord} size={24} />
      <strong>{s.asset.symbol}</strong>
      <span className="number">{move}</span>
      {valid ? (
        <svg viewBox="0 0 160 30" role="img" aria-label={en.flyer.chartLabel(s.asset.symbol, move)}>
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            points={numbers
              .map(
                (n, i) =>
                  `${(i * 156) / (numbers.length - 1) + 2},${high === low ? 15 : 27 - ((n - low) / (high - low)) * 24}`,
              )
              .join(" ")}
          />
        </svg>
      ) : (
        <span className="flight-chart-missing">{en.flyer.noChart}</span>
      )}
      {s.lastSession && <small>{en.flyer.lastSession}</small>}
    </div>
  );
}
