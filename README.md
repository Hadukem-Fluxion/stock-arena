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
| `docs/DEPLOY.md`        | Claude and Hadukem        | Staging dashboard settings, environment variables and rollback |
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
3. The worker polls xStocks every 15 s, stores primary snapshots with `source = xstocks`, and cross-checks five Fluxion pools with `source = fluxion_pool`. The authenticated API price stream reads persisted primary snapshots every 15 s; game prices and settlement use primary snapshots only.
4. Every point award is one row in `points_ledger`; leaderboards are sums over that ledger.

## Tech stack

- Node 22+, TypeScript (strict), pnpm workspaces
- React 18 + Vite, `@discord/embedded-app-sdk`, Telegram WebApp JS
- Fastify, Zod for validation
- Postgres (Supabase), migrations with Drizzle
- viem for Mantle reads
- Vitest for tests, Playwright for a smoke test of the web app

## Getting started

For the Vercel frontend, Railway API/worker and Supabase staging setup, follow
[docs/DEPLOY.md](docs/DEPLOY.md). The API uses Railway's `PORT` when present and
otherwise `API_PORT`. Migrations run only in the API's pre-deploy command.
The worker retains every price sample for 48 hours, then the last sample of each
UTC hour per ticker/source. Retention runs at startup and on each new UTC day,
without changing the points ledger.

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
status through this package; the API shares its connection between authentication
and game actions. Migrations
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

The schema includes the 12 Season 1 tables plus the private daily quiz selection,
their foreign keys and action
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

### Leaderboards and live prices (T12)

`GET /api/leaderboard?period=day|week|season&platform=all|discord|telegram`
returns the top 100 and the caller's position, including ranks outside that list.
Totals come from the immutable ledger; linked identities never duplicate points.
Ties use the first time the player reached their final score in the selected
window, then a stable user ID order. Results are cached for 60 seconds per filter,
with UTC day/week boundaries invalidating the cache. Caller data is selected from
that snapshot separately for each response.

Season dates live in `GAME_CONFIG.season`, provisionally from
`2026-10-16T00:00:00Z` with no end. A non-null end instant closes the season and
excludes later points; changes go through a reviewed PR, without ledger edits.
See [Game Rules](docs/GAME_RULES.md) and the open Mantle confirmation in the roadmap.

`GET /api/prices/stream` requires the same bearer session as game routes. It emits
an immediate `prices` SSE event and updates every 15 seconds with the catalog,
latest primary quotes, 24h changes and pause reasons. The browser uses streaming
fetch so authentication stays in the header, never a URL. Streams reconnect
after a drop, end after one minute to reauthenticate, and release server timers
on disconnect. The UI retains last prices with a reconnect/pause notice while
offline. Stalled streams are bounded; slow readers cannot accumulate snapshots.

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

All registered `/api/*` routes require a session by default, except `/api/health`,
the two login routes and `POST /api/discord/interactions` (authenticated by the
Discord Ed25519 signature). Routes under `/api/admin` additionally require a matching
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

For entertainment and education only. Not financial advice. Points have no cash value.

[xStocks are not available in the U.S. or to U.S. persons. Geo restrictions apply.](https://assets.backed.fi/legal-documentation)

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

## Platform shell development (T08)

The shared adapters in `apps/web/src/platform` expose `init()`, `login()`,
`openExternal(url)`, `user` and an in-memory `session`. Discord uses the official
embedded SDK; Telegram loads its official bridge only when launched as a Mini
App. All authentication requests use relative `/api/auth/*` URLs. Neither
sessions nor provider tokens are written to browser storage or logs.

Set the public `VITE_DISCORD_CLIENT_ID` to the same ID as `DISCORD_CLIENT_ID`.
Only the public ID belongs in the Vite build. Never prefix a server secret with
`VITE_`. The browser preview creates a local-only user on localhost in Vite
**development** mode, without an API session or point awards. Production browser
visits show instructions to open Discord or Telegram; no fake login is available.

The shell uses `docs/design/DESIGN.md`: mobile bottom navigation, two tablet
columns and three desktop columns. The app always keeps the approved brand palette,
regardless of Telegram's theme. Only Telegram's header/background colors match our
`--bg`, including on `themeChanged`. Typography is bundled locally with Fontsource, so fonts
need no third-party URL mapping. Stock logos use the official metadata URLs outside
Discord and the relative `/stock-logos/*` mapping inside an Activity; see
`docs/INFRA.md` for the portal settings.

Daily Check-in and Daily Quiz are available in T09–T10. Other games, price streaming and ranking
endpoints arrive in T11–T13. Their shell panels show explicit waiting states,
without sample prices, fake rankings or local point mutations. Login failures
offer a retry and only display copy from `en.ts`.

```powershell
pnpm exec playwright install chromium    # once, or use an installed Edge below
pnpm test:web
# Windows with Microsoft Edge already installed:
$env:PLAYWRIGHT_CHANNEL = "msedge"
pnpm test:web
```

Browser checks start web-only development and production servers on ports 5173
and 5174. They never start the API/worker or connect to the database. Checks cover
360/768/1024/1440px layouts, navigation, game selection, approved legal copy,
production browser blocking, simulated Telegram login/links and retry after an
API error. Unit tests mock Discord's ready/authorize/authenticate sequence and
verify relative API requests. Screenshots are saved under `apps/web/test-results`.
Real Discord test-server and Telegram test-bot screenshots remain pending platform
account configuration and staging; simulated tests do not replace that acceptance.

## Daily Check-in development (T09)

Authenticated `GET /api/checkin` reads today's state without awarding points.
`POST /api/checkin` accepts an empty JSON object and awards the check-in. Both
return the server UTC day/time, streak, ledger balance, today's awards, catalog
and Stock of the Day. The server uses the existing `nextStreak`, `checkinAwards`
and `stockOfTheDay` helpers; scoring values and the launch rotation are unchanged.
One transaction locks the player, inserts the daily action and its ledger awards.
Concurrent/repeated POSTs return `409 ALREADY_CHECKED_IN`; the client then reloads
the server state, so a lost response cannot award twice. No points are calculated
or saved locally. Browser previews cannot check in.

The stock card reads primary snapshots from the database, never from a browser
price API. Its 24h comparison uses the primary snapshot at or immediately before
24 hours ago, within the existing price freshness tolerance. Missing history shows
an unavailable change; stale/closed prices keep their pause label and the last
stored quote. Missing prices never prevent check-in points. The card refreshes
after an action, when the app becomes visible and at the next server UTC day;
continuous price streaming is part of T12.

`packages/game-core/src/assets.ts` owns catalog order, company metadata, token
addresses, logos, reference tickers, provider IDs and per-asset trade URLs.
`TICKERS` and company names are derived compatibility exports. Rotation and the
web lists work with arbitrary nonempty catalogs; tests cover 3 and 30 assets.
Provider display name, badge and exact legal notice are configured once in
`apps/web/src/copy/en.ts`; today every asset uses `provider = xstocks`. The price
reference stays independent of the token's provider. New catalog entries without
curated company facts show an explicit waiting message.

Hadukem approved `https://app.fluxion.network/trade` as each asset's temporary
trade URL. Token-specific deep links remain pending confirmation by Fluxion.
Tests use fake sessions and isolated PGlite databases; no real platform credentials
or Supabase data are required.

## Daily Quiz development (T10)

The private campaign bank lives outside Git (currently
`packages/db/.local/quiz-bank.json`). Never copy its questions, options, keys or
explanations into this public repository, tests, screenshots or PR descriptions.
Tests use invented markers rather than campaign content.

Migration `0003_quiz-storage` adds a unique import `slug` and `explanation` to
`quiz_questions`, plus `quiz_daily_sets` for private, frozen daily selections.
Legacy questions keep their UUIDs, a null slug and an empty explanation; seeded
rows always get the supplied `id` as their slug. Existing migrations are unchanged.

After review and merge, **Codex** applies/verifies migrations and runs the seed
locally against Supabase. The seed is not run during builds, API startup or worker
startup. From the repository root:

```powershell
pnpm db:seed-quiz "packages/db/.local/quiz-bank.json"
# Alternatively, set QUIZ_BANK_PATH privately and run pnpm db:seed-quiz.
```

The file must contain a JSON array with `id`, `topic`, `prompt`, four `options`,
`answer_index` (0–3), and `explanation`. Argument paths take precedence over
`QUIZ_BANK_PATH` and resolve from the command's working directory. Import validates
the entire bank before a transaction, rejects duplicate slugs, and upserts by
slug without replacing UUIDs or changing active/scheduled status. Repeating it
does not duplicate questions. Successful output is only the count of upserted
rows; errors omit file contents, validation details, SQL and connection strings.

The authenticated API exposes:

| Route                   | Behavior                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/quiz`         | Today's state, without starting an attempt or resetting timers                                                           |
| `POST /api/quiz/start`  | Empty body; creates or resumes the one UTC-day attempt                                                                   |
| `POST /api/quiz/answer` | `{day, questionId, position, choice}`; indices start at zero; `choice: null` records expiry after the full server window |
| `POST /api/quiz/next`   | Empty body; serves the next question after feedback, without resetting an already served question                        |

The first start freezes three active questions for everyone that UTC day:
scheduled-today questions first, then a deterministic day-seeded ordering of
unscheduled questions. Questions scheduled for other dates are excluded. Fewer
than three eligible questions returns `QUIZ_UNAVAILABLE` without consuming an
attempt. Later seed edits cannot change that day's questions, keys or explanations.

Only the current question is sent; future questions and all unanswered keys stay
on the server. After a reply, feedback includes the correct option and explanation
for that question only. The next timer starts when the player requests Next,
after reading feedback. The existing `quizAnswerInTime` enforces 30 seconds plus
2 seconds network grace, using server timestamps; refresh and request replay never
extend the deadline. Expired replies store `-1` as an unanswered/expired marker.

`quizPoints` computes the unchanged 20-per-correct score and 15-point perfect
bonus. Points are inserted into the ledger once, when all three replies are
recorded, in the same transaction as the final reply. A zero score has no award
row. Replays return the saved verdict, so changing the submitted option cannot
change an already recorded answer or award twice. The UI only displays server
results, resumes through GET after errors, and refreshes the ledger balance on
completion. Browser previews cannot start quizzes. Real quiz acceptance on Discord
and Telegram remains pending the post-merge seed and platform checks.
