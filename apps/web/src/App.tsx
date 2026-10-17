import { useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { ASSETS, assetTickers, gameDay, stockOfTheDay } from "@stock-arena/game-core";
import type { AssetCatalog, CheckinView } from "@stock-arena/game-core";
import { AssetLogo } from "./components/AssetLogo.js";
import { StockCard } from "./checkin/StockCard.js";
import { useCheckin } from "./checkin/useCheckin.js";
import { QuizPanel } from "./quiz/QuizPanel.js";
import { HigherLowerPanel } from "./higher-lower/HigherLowerPanel.js";
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
  const checkin = useCheckin(platform, login.state === "ready");
  const catalog: AssetCatalog = checkin.view?.catalog ?? ASSETS;
  const tickers = assetTickers(catalog);
  const today = checkin.view?.day ?? gameDay(new Date());
  const featured = checkin.view?.stock.ticker ?? stockOfTheDay(today, tickers);
  const asset = catalog[featured];
  if (!asset) throw new Error("Missing featured asset.");
  const stock: CheckinView["stock"] = checkin.view?.stock ?? {
    ticker: featured,
    asset,
    fact: null,
    price: { usd: null, change24hPct: null, takenAt: null, state: "paused", reason: "stale" },
  };
  const providers = [...new Set(tickers.map((ticker) => catalog[ticker]!.provider))];
  const discord = platform.host === "discord";
  const awardTotal =
    checkin.view?.awardsToday.reduce((total, award) => total + award.amount, 0) ?? 0;
  const checkinAction = () => (
    <div className="checkin-action">
      <button
        className="primary-button"
        type="button"
        onClick={() => {
          selectGame("checkin");
          void checkin.award();
        }}
        disabled={!checkin.allowed || !checkin.view || checkin.busy || checkin.view.checkedIn}
      >
        {checkin.busy
          ? en.checkin.saving
          : checkin.view?.checkedIn
            ? en.checkin.done
            : en.checkin.action}
      </button>
      {checkin.view?.checkedIn && (
        <p className="caption accent" role="status">
          {en.checkin.awarded} · {awardTotal > 0 ? "+" : ""}
          {awardTotal} {en.labels.points}
        </p>
      )}
      {!checkin.allowed && <p className="caption muted">{en.checkin.preview}</p>}
      {checkin.allowed && checkin.busy && !checkin.view && (
        <p className="caption muted">{en.checkin.loading}</p>
      )}
      {checkin.error && (
        <div role="alert">
          <p>{en.checkin.errors[checkin.error]}</p>
          <button
            type="button"
            onClick={() => {
              void checkin.reload();
            }}
            disabled={checkin.busy}
          >
            {en.checkin.retry}
          </button>
        </div>
      )}
    </div>
  );

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
          <span className="pill" title={checkin.view ? undefined : en.labels.unavailable}>
            <span className="number">{checkin.view?.streak ?? en.labels.unknown}</span>{" "}
            {en.labels.streak}
          </span>
          <span className="pill points" title={checkin.view ? undefined : en.labels.unavailable}>
            <span className="number">{checkin.view?.balance ?? en.labels.unknown}</span>{" "}
            {en.labels.points}
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
                <StockCard stock={stock} discord={discord} />
                {checkinAction()}
                <External className="text-link" href={stock.asset.tradeUrl}>
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
                      <span className="caption accent">
                        {name === "quiz" || name === "higherLower"
                          ? en.quiz.available
                          : en.status.comingSoon}
                      </span>
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
              {game === "checkin" ? (
                <>
                  <StockCard stock={stock} discord={discord} />
                  {checkinAction()}
                  <External className="text-link" href={stock.asset.tradeUrl}>
                    {en.labels.viewOnFluxion}
                  </External>
                </>
              ) : game === "higherLower" ? (
                <HigherLowerPanel
                  platform={platform}
                  enabled={login.state === "ready"}
                  onAward={() => {
                    void checkin.reload();
                  }}
                />
              ) : game === "quiz" ? (
                <QuizPanel
                  platform={platform}
                  enabled={login.state === "ready"}
                  onCompleted={() => {
                    void checkin.reload();
                  }}
                />
              ) : (
                <>
                  <div className="game-preview" aria-hidden="true">
                    <AssetLogo ticker={featured} asset={stock.asset} size={72} discord={discord} />
                    <span className="display-ticker">{stock.asset.symbol}</span>
                    <span className="number muted">{en.labels.unknown}</span>
                  </div>
                  <div className="pending-panel">
                    <span className="pill">{en.status.comingSoon}</span>
                    <p>{en.games.pending}</p>
                  </div>
                </>
              )}
            </section>

            <aside className="market-column">
              <section className="card prices-card" aria-labelledby="prices-title">
                <div className="section-heading">
                  <h2 id="prices-title">{en.labels.stocks}</h2>
                  <span className="caption muted">{en.labels.priceWindow}</span>
                </div>
                <ul className="price-list">
                  {tickers.map((ticker) => (
                    <li className="price-row" key={ticker}>
                      <AssetLogo
                        ticker={ticker}
                        asset={catalog[ticker]!}
                        size={32}
                        discord={discord}
                      />
                      <div className="stock-name">
                        <strong>{catalog[ticker]!.symbol}</strong>
                        <span className="caption muted">{catalog[ticker]!.name}</span>
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
          <External href={en.priceReference.website}>
            {en.footer.prices}{" "}
            <img src={en.priceReference.badgeSrc} alt="" width="20" height="20" />{" "}
            {en.priceReference.name}
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
        {providers.map((provider) => (
          <External key={provider} className="legal-notice" href={en.providers[provider].legalHref}>
            {en.providers[provider].legalNotice}
          </External>
        ))}
      </footer>
      {navigation("bottom")}
    </div>
  );
}
