import { COMPANY_NAMES, TICKERS, gameDay, stockOfTheDay } from "@stock-arena/game-core";
import { StockLogo } from "@stock-arena/ui";
import { en } from "./copy/en.js";
import { detectHost } from "./platform/detect.js";

export function App() {
  const host = detectHost();
  const today = gameDay(new Date());
  const featured = stockOfTheDay(today);

  return (
    <main className="shell">
      <header>
        <div className="app-brand">
          <img src="/brand/mantle-mark-dark.svg" alt="" width="32" height="32" />
          <h1>{en.appName}</h1>
        </div>
        <p className="muted">{en.tagline}</p>
        <span className="pill">{en.host[host]}</span>
      </header>

      <section className="card">
        <p className="muted">
          {en.labels.stockOfTheDay} · {today}
        </p>
        <div className="featured-stock">
          <StockLogo ticker={featured} size={64} showBadge />
          <h2>
            {COMPANY_NAMES[featured]} <span className="muted">{featured}</span>
          </h2>
        </div>
        <p className="muted">{en.status.comingSoon}</p>
      </section>

      <section>
        <p className="muted">{en.labels.launchSet}</p>
        <ul className="tickers">
          {TICKERS.map((t) => (
            <li key={t}>
              <StockLogo ticker={t} size={28} showBadge={false} /> {t}
            </li>
          ))}
        </ul>
      </section>

      <footer className="muted small">
        <nav className="brand-footer">
          <a href="https://xstocks.com" target="_blank" rel="noopener noreferrer">
            {en.footer.prices} <img src="/brand/xstocks-mark.svg" alt="" width="20" height="20" />{" "}
            {en.footer.xstocks}
          </a>
          <a href="https://app.fluxion.network/trade" target="_blank" rel="noopener noreferrer">
            {en.footer.tradeOn}{" "}
            <img src="/brand/fluxion-dark.svg" alt={en.footer.fluxion} height="20" />
          </a>
          <a href="https://www.mantle.xyz" target="_blank" rel="noopener noreferrer">
            {en.footer.builtOn}{" "}
            <img src="/brand/mantle-dark.svg" alt={en.footer.mantle} height="20" />
          </a>
        </nav>
        <p>{en.disclaimer}</p>
        <a
          className="legal-notice"
          href="https://assets.backed.fi/legal-documentation"
          target="_blank"
          rel="noopener noreferrer"
        >
          {en.regionNotice}
        </a>
      </footer>
    </main>
  );
}
