import type { ReactNode } from "react";
import { GAME_CONFIG, assetTickers } from "@stock-arena/game-core";
import type { AssetCatalog } from "@stock-arena/game-core";
import { AssetLogo } from "../components/AssetLogo.js";
import { en } from "../copy/en.js";
import type { usePrices } from "../prices/usePrices.js";
export function Markets({
  catalog,
  prices,
  discord,
  trade,
}: {
  catalog: AssetCatalog;
  prices: ReturnType<typeof usePrices>;
  discord: boolean;
  trade: ReactNode;
}) {
  const tickers = assetTickers(catalog);
  const marketClosed = Boolean(
    prices.view?.prices.length && prices.view.prices.every((p) => p.reason === "closed"),
  );
  return (
    <section className="card prices-card" aria-labelledby="prices-title">
      <div className="section-heading">
        <h1 id="prices-title">{en.tabs.markets}</h1>
        <span className="caption muted">
          {marketClosed
            ? en.status.marketClosed
            : prices.state === "live" && prices.view?.prices.some((p) => p.state === "live")
              ? en.navigation.liveWindow
              : en.status.pricesPending}
        </span>
      </div>
      <ul className="price-list">
        {tickers.map((ticker) => {
          const quote = prices.view?.prices.find((price) => price.ticker === ticker);
          const stale =
            !quote?.takenAt ||
            Date.parse(prices.view!.serverTime) - Date.parse(quote.takenAt) >
              GAME_CONFIG.prices.staleAfterSeconds * 1000;
          const paused = quote?.state === "paused" || stale || prices.state !== "live";
          return (
            <li className="price-row" key={ticker}>
              <AssetLogo ticker={ticker} asset={catalog[ticker]!} size={32} discord={discord} />
              <div className="stock-name">
                <strong>{catalog[ticker]!.symbol}</strong>
                <span className="caption muted">{catalog[ticker]!.name}</span>
              </div>
              <div className="live-price-value">
                {quote?.reason === "closed" && quote.priceUsd !== null && (
                  <span className="caption muted">{en.checkin.lastPrice}</span>
                )}
                <span className="number">
                  {quote?.priceUsd
                    ? Number(quote.priceUsd).toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                      })
                    : en.labels.unknown}
                </span>
                {quote?.change24hPct !== null && quote?.change24hPct !== undefined && (
                  <span className={`number caption ${quote.change24hPct < 0 ? "down" : "accent"}`}>
                    {quote.change24hPct < 0 ? "▼" : "▲"} {Math.abs(quote.change24hPct).toFixed(2)}%
                  </span>
                )}
                {paused && (
                  <span className="caption muted">
                    {quote?.reason === "closed" ? en.status.marketClosed : en.checkin.paused}
                  </span>
                )}
                {quote?.reason === "closed" && quote.pool && (
                  <div className="pool-quote">
                    <span className="caption muted">{en.prices.pool}</span>
                    <span className="number caption">
                      {Number(quote.pool.priceUsd).toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                      })}
                    </span>
                    <time className="caption muted" dateTime={quote.pool.takenAt}>
                      {new Date(quote.pool.takenAt).toISOString().slice(0, 16).replace("T", " ")}{" "}
                      {en.labels.utc}
                    </time>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="caption muted" role="status">
        {prices.state === "session"
          ? en.prices.session
          : prices.state === "reconnecting"
            ? en.prices.reconnecting
            : prices.view
              ? marketClosed
                ? en.prices.closed
                : en.prices.live
              : en.status.pricesPending}
      </p>

      {trade}
      <p className="caption muted market-note">{en.navigation.priceNote(en.priceReference.name)}</p>
    </section>
  );
}
