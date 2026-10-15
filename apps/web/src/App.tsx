import { COMPANY_NAMES, TICKERS, gameDay, stockOfTheDay } from "@stock-arena/game-core";
import { en } from "./copy/en.js";
import { detectHost } from "./platform/detect.js";

export function App() {
  const host = detectHost();
  const today = gameDay(new Date());
  const featured = stockOfTheDay(today);

  return (
    <main className="shell">
      <header>
        <h1>{en.appName}</h1>
        <p className="muted">{en.tagline}</p>
        <span className="pill">{en.host[host]}</span>
      </header>

      <section className="card">
        <p className="muted">
          {en.labels.stockOfTheDay} · {today}
        </p>
        <h2>
          {COMPANY_NAMES[featured]} <span className="muted">{featured}</span>
        </h2>
        <p className="muted">{en.status.comingSoon}</p>
      </section>

      <section>
        <p className="muted">{en.labels.launchSet}</p>
        <ul className="tickers">
          {TICKERS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <footer className="muted small">
        {en.disclaimer} {en.regionNotice}
      </footer>
    </main>
  );
}
