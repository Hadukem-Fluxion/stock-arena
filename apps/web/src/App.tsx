import { useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { ASSETS, COMPANY_NAMES, TICKERS, gameDay, stockOfTheDay } from "@stock-arena/game-core";
import { StockLogo } from "@stock-arena/ui";
import { en } from "./copy/en.js";
import { getPlatform } from "./platform/index.js";
import { PlatformError } from "./platform/types.js";
import type { PlatformAdapter, PlatformErrorCode, PlatformUser } from "./platform/types.js";

type Tab = keyof typeof en.tabs;
type Game = "checkin" | "quiz" | "higherLower" | "invite";
type Login =
  | { state: "connecting" }
  | { state: "ready"; user: PlatformUser }
  | { state: "error"; code: PlatformErrorCode };
const games: Game[] = ["checkin", "quiz", "higherLower", "invite"];
const tabs: Tab[] = ["play", "leaderboard", "profile"];

export function App({ platform = getPlatform() }: { platform?: PlatformAdapter }) {
  const hostLabel =
    platform.host === "browser" && import.meta.env.DEV
      ? en.host.browserDevelopment
      : en.host[platform.host];
  const [tab, setTab] = useState<Tab>("play");
  const [game, setGame] = useState<Game>("checkin");
  const [login, setLogin] = useState<Login>({ state: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const [linkError, setLinkError] = useState(false);
  const today = gameDay(new Date());
  const featured = stockOfTheDay(today);

  useEffect(() => {
    let active = true;
    setLogin({ state: "connecting" });
    void platform
      .init()
      .then(() => platform.login())
      .then(
        (user) => {
          if (active) setLogin({ state: "ready", user });
        },
        (error: unknown) => {
          if (active)
            setLogin({
              state: "error",
              code: error instanceof PlatformError ? error.code : "LOGIN_FAILED",
            });
        },
      );
    return () => {
      active = false;
    };
  }, [platform, attempt]);

  function external(event: MouseEvent<HTMLAnchorElement>, url: string) {
    if (platform.host === "browser") return;
    event.preventDefault();
    setLinkError(false);
    void platform.openExternal(url).catch(() => setLinkError(true));
  }
  function External({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) {
    return (
      <a
        className={className}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => external(event, href)}
      >
        {children}
      </a>
    );
  }
  function selectGame(next: Game) {
    setGame(next);
    document.getElementById("active-panel")?.scrollIntoView({ block: "start" });
  }

  const navigation = (position: "header" | "bottom") => (
    <nav className={`tabs tabs-${position}`} aria-label={en.labels.navigation}>
      {tabs.map((name, index) => (
        <button
          key={name}
          type="button"
          aria-current={tab === name ? "page" : undefined}
          onClick={() => setTab(name)}
        >
          <span className="tab-symbol" aria-hidden="true">
            {["◇", "≡", "○"][index]}
          </span>
          {en.tabs[name]}
        </button>
      ))}
    </nav>
  );

  const ranking = (
    <>
      <p className="eyebrow">{en.labels.season}</p>
      <h2>{en.labels.topFive}</h2>
      <p className="muted empty-state">{en.leaderboard.empty}</p>
    </>
  );
  return (
    <div className="shell" data-host={platform.host}>
      <a className="skip-link" href="#main-content">
        {en.labels.skipToContent}
      </a>
      <header className="app-header">
        <div className="app-brand">
          <img src="/brand/mantle-mark-dark.svg" alt="" width="32" height="32" />
          <span>{en.appName}</span>
        </div>
        {navigation("header")}
        <div className="player-stats">
          <span className="pill" title={en.labels.unavailable}>
            <span className="number">{en.labels.unknown}</span> {en.labels.streak}
          </span>
          <span className="pill points" title={en.labels.unavailable}>
            <span className="number">{en.labels.unknown}</span> {en.labels.points}
          </span>
        </div>
      </header>

      <main id="main-content" className="main-content" tabIndex={-1}>
        <div className="page-intro">
          <div>
            <p className="eyebrow">
              {en.labels.season} · {en.labels.daily}
            </p>
            <h1>{tab === "play" ? en.labels.playTitle : en.tabs[tab]}</h1>
            <p className="muted">
              {tab === "play"
                ? en.labels.playIntro
                : tab === "profile"
                  ? en.profile.intro
                  : en.leaderboard.intro}
            </p>
          </div>
          <span className="host-label">{hostLabel}</span>
        </div>

        <div
          className={`connection ${login.state === "error" ? "connection-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {login.state === "connecting"
            ? en.auth.connecting
            : login.state === "ready"
              ? platform.host === "browser"
                ? en.auth.preview
                : `${en.labels.signedIn} · ${login.user.displayName}`
              : en.auth.errors[login.code]}
          {login.state === "error" && login.code !== "BROWSER_DISABLED" && (
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {en.auth.retry}
            </button>
          )}
        </div>
        {linkError && (
          <p role="alert" className="connection connection-error">
            {en.auth.errors.LINK_FAILED}
          </p>
        )}

        {tab === "play" ? (
          <div className="arena-grid">
            <section className="games-column" aria-label={en.labels.games}>
              <div className="card featured-card">
                <div className="section-heading">
                  <p className="eyebrow">{en.labels.stockOfTheDay}</p>
                  <span className="caption muted">
                    {today} · {en.labels.utc}
                  </span>
                </div>
                <div className="featured-stock">
                  <StockLogo ticker={featured} size={48} />
                  <div>
                    <h2>{ASSETS[featured].symbol}</h2>
                    <p className="muted caption">{COMPANY_NAMES[featured]}</p>
                  </div>
                  <span className="price-placeholder number" title={en.labels.unavailable}>
                    {en.labels.unknown}
                  </span>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => selectGame("checkin")}
                  disabled={login.state !== "ready"}
                >
                  {en.games.checkin.name}
                </button>
                <External className="text-link" href="https://app.fluxion.network/trade">
                  {en.labels.viewOnFluxion}
                </External>
              </div>
              <div className="game-list">
                {games
                  .filter((name) => name !== "checkin")
                  .map((name) => (
                    <button
                      className={`game-tile ${game === name ? "selected" : ""}`}
                      key={name}
                      type="button"
                      aria-pressed={game === name}
                      onClick={() => selectGame(name)}
                      disabled={login.state !== "ready"}
                    >
                      <span className="game-name">{en.games[name].name}</span>
                      <span className="caption muted">{en.games[name].rule}</span>
                      <span className="caption accent">{en.status.comingSoon}</span>
                    </button>
                  ))}
                <div className="game-tile upcoming">
                  <span className="game-name">{en.games.dailyCall.name}</span>
                  <span className="caption muted">{en.games.dailyCall.rule}</span>
                  <span className="caption muted">{en.status.comingSoon}</span>
                </div>
              </div>
            </section>

            <section className="card active-panel" id="active-panel" aria-labelledby="active-title">
              <p className="eyebrow">{en.labels.games}</p>
              <h2 id="active-title">{en.games[game].name}</h2>
              <p className="body-copy">{en.games[game].detail}</p>
              <div className="game-preview" aria-hidden="true">
                <StockLogo ticker={featured} size={72} />
                <span className="display-ticker">{ASSETS[featured].symbol}</span>
                <span className="number muted">{en.labels.unknown}</span>
              </div>
              <div className="pending-panel">
                <span className="pill">{en.status.comingSoon}</span>
                <p>{en.games.pending}</p>
              </div>
            </section>

            <aside className="market-column">
              <section className="card prices-card" aria-labelledby="prices-title">
                <div className="section-heading">
                  <h2 id="prices-title">{en.labels.magnificent}</h2>
                  <span className="caption muted">{en.labels.priceWindow}</span>
                </div>
                <ul className="price-list">
                  {TICKERS.map((ticker) => (
                    <li className="price-row" key={ticker}>
                      <StockLogo ticker={ticker} size={32} />
                      <div className="stock-name">
                        <strong>{ASSETS[ticker].symbol}</strong>
                        <span className="caption muted">{COMPANY_NAMES[ticker]}</span>
                      </div>
                      <span className="number muted" title={en.labels.unavailable}>
                        {en.labels.unknown}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="caption muted">{en.status.pricesPending}</p>
              </section>
              <section className="card ranking-card">{ranking}</section>
            </aside>
          </div>
        ) : tab === "leaderboard" ? (
          <section className="card tab-panel">
            <p className="eyebrow">{en.labels.season}</p>
            <h2>{en.leaderboard.title}</h2>
            <div className="period-labels">
              {Object.values(en.leaderboard.periods).map((period) => (
                <span className="pill" key={period}>
                  {period}
                </span>
              ))}
            </div>
            <p className="empty-state muted">{en.leaderboard.empty}</p>
          </section>
        ) : (
          <section className="card tab-panel profile-panel">
            <p className="eyebrow">{en.labels.connected}</p>
            <h2>{en.labels.profile}</h2>
            {login.state === "ready" ? (
              <>
                <div className="profile-avatar" aria-hidden="true">
                  {login.user.displayName.slice(0, 1).toUpperCase()}
                </div>
                <h3>{login.user.displayName}</h3>
                <dl>
                  <dt>{en.labels.platform}</dt>
                  <dd>{hostLabel}</dd>
                  <dt>{en.labels.playerId}</dt>
                  <dd className="number">{login.user.id}</dd>
                </dl>
              </>
            ) : (
              <p className="muted">
                {login.state === "error" ? en.auth.errors[login.code] : en.auth.connecting}
              </p>
            )}
            <p className="muted">{en.profile.pending}</p>
          </section>
        )}
      </main>

      <footer className="app-footer caption muted">
        <nav className="brand-footer" aria-label={en.footer.partners}>
          <External href="https://xstocks.com">
            {en.footer.prices} <img src="/brand/xstocks-mark.svg" alt="" width="20" height="20" />{" "}
            {en.footer.xstocks}
          </External>
          <External href="https://app.fluxion.network/trade">
            {en.footer.tradeOn}{" "}
            <img src="/brand/fluxion-dark.svg" alt={en.footer.fluxion} height="20" />
          </External>
          <External href="https://www.mantle.xyz">
            {en.footer.builtOn}{" "}
            <img src="/brand/mantle-dark.svg" alt={en.footer.mantle} height="20" />
          </External>
        </nav>
        <p>{en.tagline}</p>
        <p>{en.disclaimer}</p>
        <External className="legal-notice" href="https://assets.backed.fi/legal-documentation">
          {en.regionNotice}
        </External>
      </footer>
      {navigation("bottom")}
    </div>
  );
}
