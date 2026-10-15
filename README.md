# Stock Arena

Free-to-play mini games about tokenized US stocks, running as a **Discord Activity** and a **Telegram Mini App** from one codebase. Prices come live from the **xStock pools on Fluxion (Mantle)**. No wallet, no deposits, no real trading.

> Working name. Final branding to be approved by Mantle and Fluxion.

## Season 1 games

| Game | Summary |
| --- | --- |
| Daily Check-in | Once per UTC day. Reveals the Stock of the Day (live price, 24h change, one fact). Streak bonuses on day 7 and day 30. |
| Daily Quiz | 3 multiple-choice questions, 30 s each, one attempt per day. |
| Higher or Lower | Pick which of two stocks moved more in 24h. Run ends at the first miss or 10 correct. 3 runs per day. |
| Invite friends | Referral counts after the friend checks in on 3 different days. |
| Daily Call (later) | Up or Down on 3 stocks, settled 24h later on Fluxion TWAP. |
| Weekly Fantasy Portfolio (later) | Pick 3 stocks plus a captain; scored on weekly % change. |

Launch asset set: AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA (their xStocks on Fluxion).

Full rules and point values: `docs/GAME_RULES.md`, implemented in `packages/game-core/src/config.ts`.

## Documentation

| File | For | What it holds |
| --- | --- | --- |
| `AGENTS.md` | Codex | How to work in this repo, code rules, platform and price rules |
| `docs/TASKS.md` | Codex | One brief per pull request, with acceptance criteria |
| `docs/ROADMAP.md` | Everyone | Phases, dates, gates, who does what, open questions |
| `docs/GAME_RULES.md` | Everyone | Games, points, leaderboards, fair play |
| `docs/PLAYER_GUIDE.md` | Players | How to play on Discord and Telegram, FAQ |
| `docs/ADMIN_GUIDE.md` | Admins and mods | Permissions, routines, abuse signals, incidents, payouts |

## Project status

- Done: scaffold, game rules and scoring in `packages/game-core` (tested), TWAP and price health checks in `packages/fluxion-oracle` (tested).
- Next: T02 (install and verify the scaffold), then T03 and T04. Track progress in `docs/TASKS.md`.

## Architecture

```
apps/
  web/            React + Vite frontend, shared by Discord and Telegram
  api/            Fastify REST API + server-sent events
  worker/         Price polling, daily reset, settlement, leaderboard snapshots
  discord-bot/    discord.js: /arena, /rank, daily top 10, role rewards
  telegram-bot/   grammY: /start, menu button, opt-in reminder
packages/
  game-core/      Pure game rules (scoring, streaks, rotation). No I/O.
  fluxion-oracle/ Reads xStock pool prices on Mantle (viem), TWAP, sanity checks
  ui/             Shared React components
  db/             Schema, migrations, typed queries
docs/
  TASKS.md        Codex task briefs, one per pull request
```

**Flow**

1. The web app boots, detects its host (Discord iframe or Telegram WebView) and runs the matching login.
2. The API verifies the identity (Discord OAuth code exchange, or Telegram init data signature) and returns a session token.
3. The worker snapshots Fluxion prices every 15 s into `price_snapshots`; the API streams spot prices to clients over SSE.
4. Every point award is one row in `points_ledger`; leaderboards are sums over that ledger.

## Tech stack

- Node 22+, TypeScript (strict), pnpm workspaces
- React 18 + Vite, `@discord/embedded-app-sdk`, Telegram WebApp JS
- Fastify, Zod for validation
- Postgres (Supabase), migrations with Drizzle
- viem for Mantle reads
- Vitest for tests, Playwright for a smoke test of the web app

## Getting started

Requirements: Node 22 or newer and pnpm (enable it once with `corepack enable`). Works on Windows, macOS and Linux.

```bash
pnpm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
pnpm dev                    # web on :5173, api on :8787, worker
pnpm test                   # unit tests
```

`pnpm db:migrate` is added in task T03.

### Environment variables

| Name | Used by | What it is |
| --- | --- | --- |
| `DATABASE_URL` | api, worker | Postgres connection string |
| `SESSION_SECRET` | api | Signs session tokens |
| `DISCORD_CLIENT_ID` | web, api, discord-bot | Discord application id |
| `DISCORD_CLIENT_SECRET` | api | Discord OAuth secret, server only |
| `DISCORD_BOT_TOKEN` | discord-bot | Bot token |
| `TELEGRAM_BOT_TOKEN` | api, telegram-bot | Bot token; also used to verify Mini App init data |
| `MANTLE_RPC_URL` | worker | Mantle mainnet RPC (chain id 5000) |
| `FLUXION_POOLS_JSON` | worker | Ticker to pool address map, from the Fluxion team |
| `ADMIN_DISCORD_IDS` / `ADMIN_TELEGRAM_IDS` | api | Comma-separated admin ids |

Never commit `.env`. Secrets live only in the hosting provider's settings.

### Running inside Discord locally

Activities load through Discord's proxy. Expose the dev server with a tunnel, set the tunnel URL as the Activity URL mapping in the Discord Developer Portal, and map `/api` to the API. See Discord's "Building your first Activity" guide.

### Running inside Telegram locally

Point the bot's Mini App URL (BotFather) at the same tunnel. Use a separate test bot for development.

## Working agreement

- One task brief from `docs/TASKS.md` per pull request.
- Every PR: passes lint, typecheck and tests; includes tests for new rules; updates docs if behavior changes.
- All player-facing text is in English and lives in `apps/web/src/copy/en.ts`.
- Game rules live only in `packages/game-core`. The API calls them; the frontend never decides points.

## Disclaimer

For entertainment and education only. Not financial advice. Points have no cash value. xStocks are not available in the United States and other restricted regions.
