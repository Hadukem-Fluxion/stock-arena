import { RewardProfile } from "./rewards/RewardProfile.js";
import { InvitePanel } from "./referrals/InvitePanel.js";
import { FlyerPanel } from "./flyer/FlyerPanel.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { ASSETS, GAME_CONFIG, assetTickers, gameDay, stockOfTheDay } from "@stock-arena/game-core";
import type { AssetCatalog, CheckinView } from "@stock-arena/game-core";
import { StockCard } from "./checkin/StockCard.js";
import { useCheckin } from "./checkin/useCheckin.js";
import { QuizPanel } from "./quiz/QuizPanel.js";
import { HigherLowerPanel } from "./higher-lower/HigherLowerPanel.js";
import { en } from "./copy/en.js";
import { LeaderboardPanel, TodayTopThree } from "./leaderboard/LeaderboardPanel.js";
import { usePrices } from "./prices/usePrices.js";
import { getPlatform } from "./platform/index.js";
import { PlatformError } from "./platform/types.js";
import type { PlatformAdapter, PlatformErrorCode, PlatformUser } from "./platform/types.js";
import { createHlClient } from "./higher-lower/client.js";
import { Markets } from "./screens/Markets.js";
import { readScreen, screenHash } from "./screens/navigation.js";
import type { Screen } from "./screens/navigation.js";

type Login =
  | { state: "connecting" }
  | { state: "ready"; user: PlatformUser }
  | { state: "error"; code: PlatformErrorCode };
const tabs = ["home", "markets", "leaderboard", "profile"] as const;
export function App({ platform = getPlatform() }: { platform?: PlatformAdapter }) {
  const [screen, setScreen] = useState<Screen>(() => readScreen(window.location.hash));
  const [login, setLogin] = useState<Login>({ state: "connecting" }),
    [attempt, setAttempt] = useState(0),
    [linkError, setLinkError] = useState(false),
    [legal, setLegal] = useState(false),
    [runsLeft, setRunsLeft] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [, setFlyerBest] = useState<number | null>(null);
  const checkin = useCheckin(platform, login.state === "ready"),
    prices = usePrices(platform, login.state === "ready");
  const catalog: AssetCatalog = checkin.view?.catalog ?? prices.view?.catalog ?? ASSETS;
  const reloadCheckin = checkin.reload;
  const flyerAward = useCallback(() => {
    void reloadCheckin();
  }, [reloadCheckin]);
  const tickers = assetTickers(catalog),
    today = checkin.view?.day ?? gameDay(new Date()),
    featured = checkin.view?.stock.ticker ?? stockOfTheDay(today, tickers),
    asset = catalog[featured];
  if (!asset) throw new Error("Missing featured asset.");
  const stock: CheckinView["stock"] = checkin.view?.stock ?? {
    ticker: featured,
    asset,
    fact: null,
    price: { usd: null, change24hPct: null, takenAt: null, state: "paused", reason: "stale" },
  };
  const providers = [...new Set(tickers.map((t) => catalog[t]!.provider))];
  const game =
    screen === "quiz" || screen === "higherLower" || screen === "flyer" || screen === "invite"
      ? screen
      : null;
  const isGame = game !== null;
  const navigate = useCallback((next: Screen) => {
    if (readScreen(window.location.hash) !== next)
      history.pushState(
        null,
        "",
        `${location.pathname}${location.search}${screenHash(location.hash, next)}`,
      );
    setScreen(next);
  }, []);
  useEffect(() => {
    const sync = () => setScreen(readScreen(location.hash));
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [screen]);
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
  useEffect(() => {
    if (platform.host !== "telegram" || login.state !== "ready") return;
    return platform.setBackButton?.(isGame ? () => navigate("home") : null);
  }, [isGame, platform, navigate, login.state]);
  useEffect(() => {
    if (screen !== "home" || login.state !== "ready" || !platform.session) return;
    let active = true;
    const client = createHlClient(() => platform.session);
    const load = () => {
      void client
        .call("read")
        .then((view) => {
          if (active) setRunsLeft(Math.max(0, view.runsLimit - view.runsUsed));
        })
        .catch(() => {
          if (active) setRunsLeft(null);
        });
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [screen, login.state, platform]);
  useEffect(() => {
    if (legal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [legal]);
  function external(event: MouseEvent<HTMLAnchorElement>, url: string) {
    if (platform.host === "browser") return;
    event.preventDefault();
    setLinkError(false);
    void platform.openExternal(url).catch(() => setLinkError(true));
  }
  function externalLink(href: string, children: ReactNode, className?: string) {
    return (
      <a
        href={href}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => external(event, href)}
      >
        {children}
      </a>
    );
  }
  const earned = checkin.view?.awardsToday.reduce((sum, a) => sum + a.amount, 0) ?? 0;
  return (
    <div className="shell" data-host={platform.host} data-screen={screen}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        {en.labels.skipToContent}
      </a>
      <header className="app-header">
        <div className="header-content">
          <div className="app-brand">
            <img src="/brand/mantle-mark-dark.svg" alt="" width="28" height="28" />
            <span>{en.appName}</span>
          </div>
          <div className="player-stats">
            <span className="pill">
              <span className="number">{checkin.view?.streak ?? en.labels.unknown}</span>
              {en.navigation.days}
            </span>
            <span className="pill points">
              <span className="number">{checkin.view?.balance ?? en.labels.unknown}</span>
              {en.labels.points}
            </span>
          </div>
        </div>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {login.state !== "ready" && (
          <div
            className={`connection ${login.state === "error" ? "connection-error" : ""}`}
            role="status"
          >
            {login.state === "connecting" ? en.auth.connecting : en.auth.errors[login.code]}
            {login.state === "error" && login.code !== "BROWSER_DISABLED" && (
              <button onClick={() => setAttempt((n) => n + 1)}>{en.auth.retry}</button>
            )}
          </div>
        )}
        {linkError && (
          <p role="alert" className="connection connection-error">
            {en.auth.errors.LINK_FAILED}
          </p>
        )}
        {isGame && screen !== "flyer" && (
          <div className="game-heading">
            <button
              className="back-button"
              aria-label={en.navigation.back}
              onClick={() => navigate("home")}
            >
              ←
            </button>
            <h1>{game && en.games[game].name}</h1>
          </div>
        )}
        {screen === "home" && (
          <div className="home-screen">
            <h1 className="visually-hidden">{en.tabs.home}</h1>
            <section className="card featured-card" aria-label={en.labels.stockOfTheDay}>
              <p className="eyebrow">{en.labels.stockOfTheDay}</p>
              <StockCard stock={stock} discord={platform.host === "discord"} />
              <div className="checkin-action">
                <button
                  className="primary-button"
                  onClick={() => void checkin.award()}
                  disabled={
                    !checkin.allowed ||
                    !checkin.view ||
                    checkin.busy ||
                    checkin.view.checkedIn ||
                    checkin.view.maintenance
                  }
                >
                  {checkin.busy
                    ? en.checkin.saving
                    : checkin.view?.checkedIn
                      ? en.navigation.checkedIn(earned)
                      : en.navigation.checkin(GAME_CONFIG.checkin.pointsPerDay)}
                </button>
                {!checkin.allowed && <p className="caption muted">{en.checkin.preview}</p>}
                {checkin.view?.maintenance && <p role="status">{en.maintenance}</p>}
                {checkin.error && (
                  <div role="alert">
                    <p>{en.checkin.errors[checkin.error]}</p>
                    <button onClick={() => void checkin.reload()} disabled={checkin.busy}>
                      {en.checkin.retry}
                    </button>
                  </div>
                )}
              </div>
            </section>
            <section className="home-games" aria-labelledby="games-title">
              <h2 id="games-title">{en.labels.games}</h2>
              <div className="game-list">
                {(["quiz", "higherLower", "flyer"] as const).map((game, index) => (
                  <button className="game-tile" key={game} onClick={() => navigate(game)}>
                    <span className="game-icon" aria-hidden="true">
                      {["?", "↗", "◇"][index]}
                    </span>
                    <span className="game-description">
                      <span className="game-name">{en.games[game].name}</span>
                      <span className="caption muted">{en.games[game].rule}</span>
                    </span>
                    <span className="game-badge">
                      {game === "higherLower" && runsLeft !== null
                        ? en.navigation.runsLeft(runsLeft)
                        : en.navigation.play}
                    </span>
                  </button>
                ))}
              </div>
              <button className="game-tile invite-tile" onClick={() => navigate("invite")}>
                <span className="game-icon" aria-hidden="true">
                  ♧
                </span>
                <span className="game-description">
                  <span className="game-name">{en.games.invite.name}</span>
                  <span className="caption muted">{en.games.invite.rule}</span>
                </span>
                <span className="game-badge">{en.navigation.play}</span>
              </button>
            </section>
            <section className="card ranking-card">
              <TodayTopThree
                platform={platform}
                enabled={login.state === "ready"}
                onSeeAll={() => navigate("leaderboard")}
              />
            </section>
          </div>
        )}
        {screen === "quiz" && (
          <section className="card game-screen">
            <QuizPanel
              platform={platform}
              enabled={login.state === "ready"}
              onCompleted={() => void checkin.reload()}
            />
          </section>
        )}
        {screen === "higherLower" && (
          <section className="card game-screen">
            <HigherLowerPanel
              platform={platform}
              enabled={login.state === "ready"}
              onAward={() => void checkin.reload()}
            />
          </section>
        )}
        {screen === "invite" && (
          <section className="card game-screen">
            <InvitePanel platform={platform} enabled={login.state === "ready"} />
          </section>
        )}
        {screen === "flyer" && (
          <section className="flight-root">
            <FlyerPanel
              platform={platform}
              enabled={login.state === "ready"}
              onAward={flyerAward}
              onBest={setFlyerBest}
              onHome={() => navigate("home")}
            />
          </section>
        )}
        {screen === "markets" && (
          <Markets
            catalog={catalog}
            prices={prices}
            discord={platform.host === "discord"}
            trade={externalLink(
              "https://app.fluxion.network/trade",
              en.navigation.trade,
              "primary-button trade-button",
            )}
          />
        )}
        {screen === "leaderboard" && (
          <section className="card tab-panel">
            <h1>{en.tabs.leaderboard}</h1>
            <LeaderboardPanel platform={platform} enabled={login.state === "ready"} />
          </section>
        )}
        {screen === "profile" && (
          <section className="card tab-panel profile-panel">
            <h1>{en.tabs.profile}</h1>
            {login.state === "ready" ? (
              <>
                <div className="profile-avatar" aria-hidden="true">
                  {login.user.displayName.slice(0, 1).toUpperCase()}
                </div>
                <h2>{login.user.displayName}</h2>
                <dl>
                  <dt>{en.labels.platform}</dt>
                  <dd>
                    {
                      en.leaderboard.platforms[
                        platform.host === "discord"
                          ? "discord"
                          : platform.host === "telegram"
                            ? "telegram"
                            : "all"
                      ]
                    }
                  </dd>
                  <dt>{en.labels.playerId}</dt>
                  <dd className="number">{login.user.id}</dd>
                </dl>
              </>
            ) : (
              <p className="muted">
                {login.state === "error" ? en.auth.errors[login.code] : en.auth.connecting}
              </p>
            )}
            {login.state === "ready" && <RewardProfile platform={platform} />}
          </section>
        )}
      </main>
      {!isGame && (
        <footer className="app-footer">
          <div className="compact-partners">
            {externalLink(
              en.priceReference.website,
              en.navigation.pricesBy(en.priceReference.name),
            )}
            <span aria-hidden="true">·</span>
            {externalLink("https://app.fluxion.network/trade", en.navigation.trade)}
            <span aria-hidden="true">·</span>
            {externalLink("https://www.mantle.xyz", en.navigation.builtOn)}
          </div>
          <button className="legal-link" aria-haspopup="dialog" onClick={() => setLegal(true)}>
            {en.navigation.legal}
          </button>
        </footer>
      )}
      <nav className="tabs tabs-bottom" aria-label={en.labels.navigation}>
        {tabs.map((tab, index) => (
          <button
            key={tab}
            aria-current={screen === tab || (tab === "home" && isGame) ? "page" : undefined}
            onClick={() => navigate(tab)}
          >
            <span aria-hidden="true" className="tab-symbol">
              {["⌂", "↗", "≡", "○"][index]}
            </span>
            {en.tabs[tab]}
          </button>
        ))}
      </nav>
      <dialog
        ref={dialog}
        className="legal-dialog"
        aria-labelledby="legal-title"
        onClose={() => setLegal(false)}
      >
        <div className="section-heading">
          <h2 id="legal-title">{en.navigation.legalTitle}</h2>
          <button aria-label={en.navigation.closeLegal} onClick={() => setLegal(false)}>
            ×
          </button>
        </div>
        <p>{en.tagline}</p>
        <p>{en.disclaimer}</p>
        {providers.map((provider) => (
          <p key={provider}>
            {externalLink(en.providers[provider].legalHref, en.providers[provider].legalNotice)}
          </p>
        ))}
      </dialog>
    </div>
  );
}
