# mStocks Arena

Free-to-play mini games about tokenized US stocks, running as a **Discord Activity** and a **Telegram Mini App** from one codebase. The **xStocks public API** provides primary prices for all seven stocks; **Fluxion pools on Mantle** cross-check five of them. No wallet, no deposits, no real trading.

> Campaign app name: mStocks Arena. The repository and package identifiers remain stock-arena.

## Season 1 games

| Game                             | Summary                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Daily Check-in                   | Once per UTC day. Reveals the Stock of the Day (live price, 24h change, one fact). Streak bonuses on day 7 and day 30. |
| Daily Quiz                       | 3 multiple-choice questions, 30 s each, one attempt per day.                                                           |
| Higher or Lower                  | Pick which of two stocks moved more in 24h. Run ends at the first miss or 10 correct. 3 runs per day.                  |
| Invite friends                   | Referral counts after the friend checks in on 3 different days.                                                        |
| Daily Call (later)               | Up or Down on 3 stocks, settled 24h later on Fluxion TWAP.                                                             |
| Weekly Fantasy Portfolio (later) | Pick 3 stocks plus a captain; scored on weekly % change.                                                               |

Launch asset set: AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA (their xStocks on Fluxion).

Full rules and point values: `docs/GAME_RULES.md`, implemented in `packages/game-core/src/config.ts`.

## Documentation

| File                    | For                       | What it holds                                                  |
| ----------------------- | ------------------------- | -------------------------------------------------------------- |
| `AGENTS.md`             | Codex                     | How to work in this repo, code rules, platform and price rules |
| `docs/TASKS.md`         | Codex                     | One brief per pull request, with acceptance criteria           |
| `docs/ROADMAP.md`       | Everyone                  | Phases, dates, gates, who does what, open questions            |
| `docs/GAME_RULES.md`    | Everyone                  | Games, points, leaderboards, fair play                         |
| `docs/PLAYER_GUIDE.md`  | Players                   | How to play on Discord and Telegram, FAQ                       |
| `docs/ADMIN_GUIDE.md`   | Admins and mods           | Permissions, routines, abuse signals, incidents, payouts       |
| `docs/INFRA.md`         | Everyone                  | Infrastructure services, account ownership and secret storage  |
| `docs/design/DESIGN.md` | Implementation and review | Visual guide and mobile/desktop prototype references for T08   |

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
  fluxion-oracle/ xStocks API prices, Fluxion pool cross-checks (viem), TWAP, health
  ui/             Shared React components
  db/             Schema, migrations, typed queries
docs/
  TASKS.md        Codex task briefs, one per pull request
```

**Flow**

1. The web app boots, detects its host (Discord iframe or Telegram WebView) and runs the matching login.
2. The API verifies the identity (Discord OAuth code exchange, or Telegram init data signature) and returns a session token.
3. The worker polls xStocks every 15 s, stores primary snapshots with `source = xstocks`, and cross-checks five Fluxion pools with `source = fluxion_pool`. The API price stream arrives in T12; game prices and settlement use primary snapshots only.
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
pnpm db:migrate             # prepare Postgres or the local PGlite fallback
pnpm dev                    # web on :5173, api on :8787, worker
pnpm test                   # unit tests
```

### Database development (T03)

```bash
pnpm db:generate            # generate SQL migrations from packages/db/src/schema.ts
pnpm db:migrate             # apply committed migrations; loads the optional root .env
```

With `DATABASE_URL` set, migrations use Postgres through `pg`. Without it, they
use a persistent PGlite database in `packages/db/.local/pglite` (ignored by Git).
PGlite runs locally without Supabase, Docker or database credentials. Both drivers
apply the same SQL migrations in `packages/db/drizzle`; rerunning the migration
command only applies pending migrations. The worker writes snapshots and ticker
status through this package; the API is not wired to the database yet. Migrations
run explicitly before startup, never from the worker.

`@stock-arena/db` exports the tables and `createDatabase()` (selected by
`DATABASE_URL`), plus `createLocalDatabase()` for an isolated in-memory database.
Connections expose a typed `db`, `migrate()` and `close()`. Call `migrate()` before
queries and close the connection when finished. Tests use isolated in-memory or
temporary PGlite databases and never read `DATABASE_URL`.

Postgres connections always verify TLS with a CA. The default public Supabase CA
is committed in `packages/db/certs/supabase-ca.crt`; `DATABASE_SSL_CA` overrides its
path (absolute, or relative to the repository root regardless of the working
directory). Other Postgres providers need their own CA. URL SSL parameters cannot
override this verification. PGlite does not read certificates. Include the certs
directory in deployed artifacts and replace the CA before its expiry; see its README.

The schema includes all 12 Season 1 tables, their foreign keys and action
uniqueness constraints. Days are SQL `date`; instants are `timestamptz` (quiz
start times are an ordered `timestamptz[]` aligned with question IDs). Prices stay
decimal strings and block numbers stay `bigint`, avoiding JavaScript number
precision loss.

The ledger rejects UPDATE, DELETE and TRUNCATE through a statement trigger,
including raw SQL. Corrections must be new negative `admin_adjustment` rows with
their own reference IDs. Awards are unique by `(user_id, reason, ref_id)`; use
stable action references to prevent retrying an action from awarding twice.
Keep each action and its award in one database transaction.

Commit generated SQL and Drizzle metadata together. Custom SQL such as the ledger
trigger lives in a separate committed migration; use migrations rather than
`drizzle-kit push` so this protection is installed too.

### Authentication development (T07)

`POST /api/auth/telegram` accepts `{initData}` (the original raw Telegram string).
`POST /api/auth/discord` accepts `{code}` from the embedded SDK authorization
command. The server validates these inputs and resolves a unique platform identity
inside one database transaction. Discord account creation time comes from its
snowflake; Telegram account creation time stays unknown.

Both routes return `{session: {token, expiresAt, user}}`; Discord also returns
`access_token` for `sdk.commands.authenticate`. Keep the session token in memory
and send `Authorization: Bearer <token>` on game requests. Tokens use HS256 with a
24-hour expiration and fixed issuer/audience. The API checks identity ownership
and the current user status on every authenticated request. Suspended or banned
accounts cannot log in or use an existing session.

Configure `SESSION_SECRET` with at least 32 random bytes. Configure only the
provider being used: Discord needs `DISCORD_CLIENT_ID` and
`DISCORD_CLIENT_SECRET`; Telegram needs `TELEGRAM_BOT_TOKEN`. Missing configuration
disables login with a typed `AUTH_UNAVAILABLE` response; health remains public.
No default signing secret or fake login endpoint exists. Run `pnpm db:migrate`
before API logins; the API does not apply migrations itself.

All registered `/api/*` routes require a session by default, except `/api/health`
and the two login routes. Routes under `/api/admin` additionally require a matching
platform ID in `ADMIN_DISCORD_IDS` or `ADMIN_TELEGRAM_IDS`. Errors contain only
`{error: {code}}`; the client maps these codes to copy. Authentication responses
are not cacheable. Logs omit request bodies, authorization headers and query
strings, and never include raw database/provider errors.

Tests need no platform app, bot or real credentials. They sign Telegram init data
with a fake bot token, mock both Discord HTTP calls, and use an isolated migrated
PGlite database for identities and permissions. Real platform smoke tests remain
pending account setup; the client adapters arrive in T08.

### Environment variables

| Name                                       | Used by               | What it is                                                 |
| ------------------------------------------ | --------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`                             | api, worker           | Postgres connection string                                 |
| `DATABASE_SSL_CA`                          | api, worker, migrate  | PEM CA path; defaults to the bundled Supabase CA           |
| `SESSION_SECRET`                           | api                   | Signs session tokens                                       |
| `DISCORD_CLIENT_ID`                        | web, api, discord-bot | Discord application id                                     |
| `DISCORD_CLIENT_SECRET`                    | api                   | Discord OAuth secret, server only                          |
| `DISCORD_BOT_TOKEN`                        | discord-bot           | Bot token                                                  |
| `TELEGRAM_BOT_TOKEN`                       | api, telegram-bot     | Bot token; also used to verify Mini App init data          |
| `MANTLE_RPC_URL`                           | worker                | Mantle mainnet RPC (chain id 5000)                         |
| `FLUXION_POOLS_JSON`                       | worker                | Ticker to pool address map, from the Fluxion team          |
| `XSTOCKS_API_BASE`                         | worker, oracle:print  | Public price API, defaults to https://api.backed.fi/api/v2 |
| `PRICE_DIVERGENCE_PCT`                     | worker, oracle:print  | Maximum pool vs primary quote difference, defaults to 3    |
| `ADMIN_DISCORD_IDS` / `ADMIN_TELEGRAM_IDS` | api                   | Comma-separated admin ids                                  |

Never commit `.env`. Secrets live only in the hosting provider's settings.

### Price oracle (T04)

`pnpm oracle:print` prints all seven primary prices, trading periods, pool prices
and percentage divergence. This command is read-only and does not need a database.
The API requires no key. The seven quotes are polled at a 15-second cadence (28
requests per minute before retries); trading metadata refreshes every five minutes
or at its next period boundary. Pagination stops once all seven symbols are found.

Public token addresses, official stock logo URLs and five default Fluxion pool
addresses live in `packages/game-core/src/assets.ts`. Leaving `FLUXION_POOLS_JSON`
empty selects these defaults; an explicit `{}` disables pool cross-checks. An
override uses `{ticker: {pool, base, quote}}`, with the known wrapped xStock as
base and Mantle USDC as quote. The adapter reads `slot0` at a common block using
viem multicall and the configured 6/18 decimal token ordering.

The worker stores both sources in one transaction with ticker status updates.
Primary rows have a null block number. The new migration labels pre-T04 rows as
`fluxion_pool` to preserve their original meaning. Stale and jump checks use only
primary history; cross-check rows never enter game price history. Divergence above
the configured limit pauses a ticker; closed or halted markets pause with reason
`closed` and keep the last price for display as "Market closed". A manual pause is
preserved by polling.

API and RPC failures use bounded retries with exponential backoff and timeouts.
Cycles do not overlap, including when a slow retry exceeds 15 seconds. A failed
quote keeps the stored last price, which becomes paused after two minutes without
a fresh snapshot. Expired/unavailable trading metadata pauses tickers as stale.
An unavailable pool cross-check logs a warning and does not replace the primary
price; it also cannot clear an existing divergence pause. A successful matching
cross-check can resume it. Logs omit raw errors, responses and configuration.

Run `pnpm db:migrate` before `pnpm dev` or the worker start command. A missing table
or unavailable database is logged and retried on the next cycle. Local PGlite
supports a single worker process per data directory; stop the worker before
running migrations against that local directory. Hosted Postgres uses the same
migrations and supports separate services.

### Running inside Discord locally

Activities load through Discord's proxy. Expose the dev server with a tunnel, set the tunnel URL as the Activity URL mapping in the Discord Developer Portal, and map `/api` to the API. See Discord's "Building your first Activity" guide.

### Running inside Telegram locally

Point the bot's Mini App URL (BotFather) at the same tunnel. Use a separate test bot for development.

## Working agreement

- One task brief from `docs/TASKS.md` per pull request.
- Every PR: passes lint, typecheck and tests; includes tests for new rules; updates docs if behavior changes.
- All player-facing text is in English and lives in `apps/web/src/copy/en.ts`.
- Game rules live only in `packages/game-core`. The API calls them; the frontend never decides points.

## Brand assets

Mantle, Fluxion and xStocks names and logos belong to their owners and are used with permission for this campaign.

Hadukem supplied official SVG logos for dark backgrounds in `apps/web/public/brand/`; the
README in that directory lists the expected filenames. Stock logo URLs come from
the xStocks public assets API and are stored in `assets.ts`. No license has been
selected for publishing this repository as open source.

The shared `StockLogo` component in `packages/ui` takes `ticker`, `size` and
`showBadge`. It uses the xStocks asset logo URL, crops it to a circle, and overlays
the supplied xStocks mark in a dark circular badge. The header uses the Mantle
symbol; full partner branding is reserved for the footer. Visual shell work in
T08 follows `docs/design/DESIGN.md` and its reference prototypes.

## Disclaimer

For entertainment and education only. Not financial advice. Points have no cash value. xStocks are not available in the United States and other restricted regions.

### Bootstrap verification (T02)

Verified on Windows PowerShell with Node 24.19.0 (`.nvmrc`) and pnpm 10.28.0.
If your Node installation does not include Corepack, install it with
`npm install --global corepack`, then run `corepack enable`. The `packageManager`
field selects the pnpm version; keep it when installing dependencies.

In the Codex bundled runtime (which has no npm or Corepack on PATH), the equivalent
local setup is:

```powershell
New-Item -ItemType Directory -Force .corepack | Out-Null
pnpm dlx corepack@0.36.0 enable --install-directory .corepack
$env:Path = "$PWD\.corepack;$env:Path"
pnpm install
```

The local `.corepack` shims are ignored by Git and formatting. Normal Node
installations do not need this local setup. No dependency ranges were changed;
`pnpm-lock.yaml` records the resolved versions.

`pnpm dev` starts web, API and the worker together. The optional root `.env` is
loaded by Node's `--env-file-if-exists`; no secrets are needed for this scaffold.
The worker polls and stores prices after the explicit migration step. Use Ctrl+C
to stop all three processes. Verify the API at `http://localhost:8787/api/health`
and the browser scaffold at `http://localhost:5173`.

The scaffold has 23 existing tests (14 game-core, 5 oracle, 3 host detection and
1 API health test), rather than the 22 stated in the original T02 acceptance.
