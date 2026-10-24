import type { CheckinView } from "@stock-arena/game-core";
import { en } from "../copy/en.js";
import { AssetLogo } from "../components/AssetLogo.js";

export function StockCard({
  stock,
  discord = false,
}: {
  stock: CheckinView["stock"];
  discord?: boolean;
}) {
  const { price } = stock;
  const change = price.change24hPct;
  const formatted =
    price.usd === null
      ? en.labels.unknown
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(Number(price.usd));
  return (
    <div className="stock-card-content">
      <div className="featured-stock">
        <AssetLogo ticker={stock.ticker} asset={stock.asset} size={48} discord={discord} />
        <div>
          <h2>{stock.asset.symbol}</h2>
          <p className="muted caption">{stock.asset.name}</p>
          <span className="caption muted stock-provider">
            {en.providers[stock.asset.provider].name}
          </span>
        </div>
        <div className="stock-price">
          {price.reason === "closed" && price.usd !== null && (
            <span className="caption muted">{en.checkin.lastPrice}</span>
          )}
          <strong className="number">{formatted}</strong>
          <span
            className={`number caption ${change === null ? "muted" : change < 0 ? "down" : "accent"}`}
            aria-label={change === null ? en.checkin.noChange : undefined}
          >
            {change === null
              ? en.labels.unknown
              : `${change < 0 ? "▼" : "▲"} ${Math.abs(change).toFixed(2)}%`}
          </span>
        </div>
      </div>
      <p className="body-copy" title={stock.fact ?? undefined}>
        {stock.fact ?? en.checkin.factPending}
      </p>
      {price.state === "paused" && (
        <p className="caption muted">
          {price.reason === "closed"
            ? price.usd === null
              ? en.prices.awaitingOpen
              : en.status.marketClosed
            : price.usd === null
              ? en.checkin.priceUnavailable
              : en.checkin.paused}
        </p>
      )}
    </div>
  );
}
