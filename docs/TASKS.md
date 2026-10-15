# Codex task briefs

One brief = one pull request. Paste the whole brief into Codex together with AGENTS.md. IDs match the Task Board in the project doc. Non-code tasks (T00, T01, T05, T06, T17, T20) are done by people or Claude and are not listed here.

---

## T02 — Bootstrap and verify the scaffold

**Context**: the scaffold already exists (written by Claude): pnpm workspaces, configs, CI, `apps/*` skeletons, `packages/game-core` with rules, scoring and tests, `packages/fluxion-oracle` with TWAP and health checks plus tests. It has **not** been installed yet: there is no lockfile and dependency versions were never resolved.

**Do**

- Move `setup/ci.yml` to `.github/workflows/ci.yml` (it could not be written there directly) and delete the empty `setup` folder.
- `git init`, default branch `main`, first commit with the files as delivered ("chore: initial scaffold").
- `pnpm install` to create `pnpm-lock.yaml`. If a pinned range does not resolve or two packages conflict, pick the closest compatible versions and list each change in the PR.
- Make `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass. Fix config problems in the scaffold; do not change rules in `packages/game-core/src/config.ts` or the expected values in its tests.
- Confirm `pnpm dev` starts web (http://localhost:5173), api (http://localhost:8787/api/health) and worker on Windows. If `--env-file-if-exists` or the parallel dev script fails on Windows, fix it and note how in README.
- Add a `.nvmrc` with the Node version used.

**Acceptance**

- All five commands pass locally. 22 existing tests pass, unchanged.
- `/api/health` returns 200 and the web page shows the detected host and the Stock of the Day.
- README "Getting started" matches what actually works on Windows.

---

## T03 — Database schema and points ledger

**Goal**: all tables for Season 1, with constraints that make double awards impossible.

**Database for development and tests**: there is no Supabase project yet. Use Drizzle with PGlite (`@electric-sql/pglite`) in tests and as the local fallback when `DATABASE_URL` is not set. With `DATABASE_URL` set, use the regular Postgres driver. The same migrations must run on both.

**Do** (in `packages/db`, Drizzle migrations)

- `users` (id uuid default `gen_random_uuid()`, display_name, avatar_url, created_at, status enum: active | suspended | banned)
- `identities` (user_id, platform enum: discord | telegram, platform_user_id, platform_created_at nullable, unique on platform + platform_user_id)
- `checkins` (user_id, day date, streak, unique on user_id + day)
- `quiz_questions` (id, prompt, options jsonb with exactly 4 items, answer_index 0..3, topic, active, scheduled_day date nullable)
- `quiz_attempts` (user_id, day, question_ids, answers, started_at per question, score, unique on user_id + day)
- `hl_runs` (id, user_id, day, run_number check 1..3, correct_count, ended_at, unique on user_id + day + run_number)
- `price_snapshots` (ticker, price_usd numeric, block_number, taken_at, index on ticker + taken_at)
- `ticker_status` (ticker, state enum: live | paused, reason, updated_at)
- `points_ledger` (id, user_id, amount int, reason, ref_id, created_at), indexes on (user_id, created_at) and (created_at)
- `referrals` (inviter_id, invitee_id unique, qualified_at nullable, check inviter_id <> invitee_id)
- `flags` (id, user_id, raised_by, note, state enum: open | cleared | actioned, created_at)
- `admin_actions` (id, admin_id, action, target_user_id, reason, created_at)
- Ledger immutability: a trigger that raises an error on any UPDATE or DELETE on `points_ledger`. Corrections are new rows with a negative amount and reason `admin_adjustment`.
- All times `timestamptz`, game days `date`.
- Root scripts `pnpm db:generate` and `pnpm db:migrate`; update README.
- Scope: `packages/db` only (schema, migrations, typed client, test helpers). Do not wire the API or worker yet.

**Acceptance** (tests run on PGlite)

- Migrations apply from an empty database.
- A second check-in for the same user and day fails.
- UPDATE and DELETE on `points_ledger` fail.
- `identities` rejects the same platform account twice.
- `referrals`: one inviter per invitee; self-invite fails.
- `hl_runs` rejects `run_number` 4.

---

## T04 — Price oracle (xStocks primary, Fluxion pools as cross-check)

Primary source (all 7 tickers): xStocks public API, no key.

- GET https://api.backed.fi/api/v2/public/assets/{symbol}/price-data -> {"quote": number}. Symbols: AAPLx, MSFTx, GOOGLx, AMZNx, METAx, NVDAx, TSLAx.
- GET https://api.backed.fi/api/v2/public/assets?page=N&pageSize=100 -> nodes[] with symbol, logo and trading: {tradingHoursMode, isTradingHalted, currentPeriod (market|extended|overnight|closed), openNow, nextChangeAt}. Refresh trading status every 5 min.
- Rate limit header x-ratelimit-limit: 1000. Poll each ticker every 15 s (28 req/min), retry with backoff, never crash the worker.

Cross-check (5 tickers with Fluxion V3 pools vs USDC, fee 0.3%, Mantle chain 5000): read slot0 via viem; USDC is token0 (6 decimals), wrapped xStock is token1 (18 decimals); priceUsd = 2^192 / sqrtPriceX96^2 * 10^12.

- AAPL pool 0x2cc6a607f3445d826b9e29f507b3a2e3b9dae106
- GOOGL pool 0x66960ed892daf022c5f282c5316c38cb6f0c1333
- META pool 0x782bd3895a6ac561d0df11b02dd6f9e023f3a497
- NVDA pool 0xa875ac23d106394d1baaae5bc42b951268bc04e2
- TSLA pool 0x5e7935d70b5d14b6cf36fbde59944533fab96b3c
  If the pool price differs from the xStocks quote by more than PRICE_DIVERGENCE_PCT (default 3), log a warning and mark the ticker paused with reason "divergence".

Mantle token addresses (xStock / wrapped), for links and metadata:
AAPLx 0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a / 0x5aa7649fdbda47de64a07ac81d64b682af9c0724
MSFTx 0x5621737f42dae558b81269fcb9e9e70c19aa6b35 / 0x63ad27614231767c8c489745b9145272de50d09b
GOOGLx 0xe92f673ca36c5e2efd2de7628f815f84807e803f / 0x1630f08370917e79df0b7572395a5e907508bbbc
AMZNx 0x3557ba345b01efa20a1bddc61f573bfd87195081 / 0xac85d37acbadca37545e21ab0fb991bce8c1187c
METAx 0x96702be57cd9777f835117a809c7124fe4ec989a / 0x4e41a262caa93c6575d336e0a4eb79f3c67caa06
NVDAx 0xc845b2894dbddd03858fd2d643b4ef725fe0849d / 0x93e62845c1dd5822ebc807ab71a5fb750decd15a
TSLAx 0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0 / 0x43680abf18cf54898be84c6ef78237cfbd441883
USDC on Mantle 0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9

Keep: twap(), checkTicker(), parsePoolsJson() and their tests. Add reasons "divergence" and "closed" to TickerState. When currentPeriod is "closed" or isTradingHalted is true, mark the ticker paused with reason "closed" (games use the last price and say "Market closed").
Config: XSTOCKS_API_BASE (default https://api.backed.fi/api/v2), FLUXION_POOLS_JSON (the 5 pools above), PRICE_DIVERGENCE_PCT. Put the addresses and logo URLs in packages/game-core/src/assets.ts, not in .env.
The worker stores snapshots through packages/db (source = xstocks, plus fluxion_pool rows for the cross-check), using the local PGlite fallback when DATABASE_URL is not set.
Tests: price parsing, slot0 math with a fixture (AAPL sqrtPriceX96 4268565857940899094584234137899180 -> ~344.50), divergence pause, closed-market pause, API error retry. Script pnpm oracle:print prints all 7 prices, period and divergence.
Player-facing copy: "Live xStock prices, as quoted on Fluxion RFQ."

---

## T07 — Login on Discord and Telegram

**Goal**: one session system for both platforms.

**Do**

- `POST /api/auth/discord` and `POST /api/auth/telegram` exactly as described in AGENTS.md.
- On first login create `users` + `identities`; store Discord account creation time from the snowflake.
- Return a signed session token (HttpOnly not possible inside both iframes, so return it in the body; client keeps it in memory).
- Middleware `requireUser` for all game routes; `requireAdmin` using the admin id lists.

**Acceptance**

- Tests: valid Telegram init data passes; tampered, missing hash or older than 24 h fails. Discord route tested with a mocked token endpoint.

---

## T08 — Platform adapter and app shell

**Goal**: the web app runs the right login and shows the main screens on both platforms.

**Do**

- `apps/web/src/platform/{discord,telegram,browser}.ts` with one interface: `init()`, `login()`, `openExternal(url)`, `user`.
- `browser` mode is for local development only, with a fake user, disabled in production builds.
- App shell with bottom tabs: Play, Leaderboard, Profile. Mobile-first layout, works at 360 px width.
- Respect Telegram theme colors and Discord's dark background.
- `openExternal` uses `sdk.commands.openExternalLink` on Discord and `Telegram.WebApp.openLink` on Telegram.

**Acceptance**

- Loads and logs in inside a Discord test server and a Telegram test bot (screenshots in the PR).

---

## T09 — Daily Check-in and Stock of the Day

**Use from game-core**: `nextStreak`, `checkinAwards`, `stockOfTheDay`, `STOCK_FACTS`.

**Do**

- `POST /api/checkin`: one per user per UTC day; streak = yesterday's streak + 1, else 1. Award 10; +50 when streak hits 7; +300 when it hits 30 (values from config).
- Stock of the Day: deterministic rotation over the 7 tickers by day number; returns live price, 24h change, one fact from `packages/game-core/src/facts.ts`, and the Fluxion link for that xStock.
- Check-in screen with streak counter and the stock card; card has "View on Fluxion" using `openExternal`.

**Acceptance**

- Tests for streak continue, break, day-7 and day-30 bonuses, and double check-in rejection.

---

## T10 — Daily Quiz

**Use from game-core**: `quizPoints`, `quizAnswerInTime`. Question bank: `packages/game-core/data/quiz.json` (written by Claude in T06).

**Do**

- `POST /api/quiz/start`: picks 3 active questions for the day (scheduled ones first, then a seeded rotation so everyone gets the same 3), returns them without answers.
- `POST /api/quiz/answer` per question: server checks time since that question was served (max 30 s + 2 s grace), stores answer, returns right or wrong and the correct option.
- Score: 20 per correct, +15 for 3 of 3. One attempt per day.
- Seed script loading the quiz bank from `packages/game-core/data/quiz.json`.

**Acceptance**

- Tests for timing, scoring, single attempt, and that answers never appear in the start response.

---

## T11 — Higher or Lower

**Use from game-core**: `higherOrLowerWinner`.

**Do**

- `POST /api/hl/start` (max 3 runs per day) and `POST /api/hl/pick`.
- Each round: two different live (not paused) tickers; the right pick is the one with the larger absolute 24h change. Exclude pairs whose changes differ by less than 0.1 percentage points.
- Run ends at first wrong pick or after 10 correct. 5 points per correct pick.
- The server stores the pair and the correct answer when the round is served, so price moves during the round do not change the result.

**Acceptance**

- Tests for run end conditions, daily run limit, paused tickers excluded, tie exclusion.

---

## T12 — Leaderboards and live prices

**Do**

- `GET /api/leaderboard?period=day|week|season&platform=all|discord|telegram` returning top 100 plus the caller's rank.
- Week = Monday 00:00 UTC to Sunday 23:59 UTC. Season dates from config.
- Ties: earlier time of reaching the score ranks higher.
- Cache results for 60 s.
- `GET /api/prices/stream` (SSE) pushing the latest snapshot and ticker status every 15 s.

**Acceptance**

- Tests for period boundaries and tie order. SSE reconnects in the client after a drop.

---

## T13 — Invite links and referrals

**Do**

- Each user gets an invite code. Discord: link to the Activity with the code as a custom id param; Telegram: `https://t.me/<bot>?startapp=<code>`.
- Store the inviter on the invitee's first login only. No self-invites.
- When the invitee checks in on their 3rd distinct day, award the inviter 50, up to 10 per season.

**Acceptance**

- Tests for qualification, cap, self-invite block, and that a later invite code does not overwrite the first.

---

## T14 — Admin panel

**Do** (route `/admin` inside the web app, `requireAdmin` on every API call)

- Quiz questions: list, add, edit, deactivate, schedule for a day.
- Players: search by name or platform id, view ledger history, suspend, ban.
- Points: adjustment with required reason (inserts a ledger row, logs to `admin_actions`).
- Flags: list open flags, clear or action them.
- Prices: ticker status, manual pause and resume.
- Export: season leaderboard CSV with platform ids and account-age eligibility.
- Mods get read-only player view and can raise flags.

**Acceptance**

- Every write creates an `admin_actions` row. Tests for permission checks on each route.

---

## T15 — Discord bot

**Do** (`apps/discord-bot`, discord.js)

- `/arena`: replies with a button that launches the Activity.
- `/rank`: the caller's daily, weekly and season rank (ephemeral).
- 00:05 UTC: post the previous day's top 10 to the leaderboard channel.
- Optional roles: grant Arena Player on first check-in; rotate Top Trader of the Week to the weekly top 10 on Monday.

**Acceptance**

- Commands registered for the Mantle guild. Role changes logged.

---

## T16 — Telegram bot

**Do** (`apps/telegram-bot`, grammY)

- `/start` (with or without a referral payload): welcome message in English plus a Play button that opens the Mini App.
- Set the menu button to open the Mini App.
- Opt-in daily reminder when the new quiz is ready, toggled from the app's Profile screen. Respect Telegram limits on message rate.

**Acceptance**

- Works in private chat; reminder only reaches users who opted in.

---

## T18 — Anti-abuse

**Do**

- Reward eligibility flag per user: Discord account at least 30 days old; member of the Mantle server (Discord) or group (Telegram) checked at login and weekly.
- Daily cap per user per reason, from config.
- Auto-flags: more than 5 qualified referrals in 24 h; quiz answers under 2 s on 3 days in a row; several accounts first seen from one invite in under 10 minutes.
- Ineligible users still play and appear on leaderboards with a marker, but are excluded from the reward export.

**Acceptance**

- Tests for each auto-flag rule and for the export exclusion.

---

## T19 — Load test

**Do**

- k6 or Artillery script: logins, check-ins, quiz answers, HL picks and SSE connections.
- Run against staging at the target set by Hadukem; report p95 latency and error rate in the PR.

---

## T21 — Daily Call

**Do**

- Each day 3 tickers (rotation). Players call Up or Down; calls close at 20:00 UTC.
- At close, store the 15-minute TWAP as the start price. 24 h later compare with the TWAP then; correct call = 30 points. A move under 0.1% counts as no result (no points, no loss).
- If a ticker is paused at settlement time, settle when it resumes, within 6 h; otherwise void.

**Acceptance**

- Tests for settlement, void path and the close time.

---

## T22 — Weekly Fantasy Portfolio and account linking

**Fantasy**: pick 3 tickers and a captain before Monday 13:30 UTC; score = average % change (captain counted twice) from Monday open TWAP to Friday close TWAP; top 10% earn a bonus from config.

**Linking**: a logged-in user creates a one-time 6-digit code valid for 10 minutes and enters it on the other platform; both identities move to one user, and their ledgers merge with an audit row.

**Acceptance**

- Tests for scoring, captain weight, lock time, code expiry and merge.

---

## T23 — Staging deploy

Goal: a public staging environment that Discord and Telegram can load, with live prices.

Layout:

- apps/web on Vercel (static Vite build).
- apps/api and apps/worker on Railway as two services from this repo (bots later, same pattern).
- Database: Supabase Postgres (DATABASE_URL in Railway, set by Hadukem).
- One origin for the client: vercel.ts rewrites /api/* to the Railway API URL, so the web app keeps calling relative /api paths in browser, Discord (URL mapping points to the Vercel domain) and Telegram. No CORS needed.

Do:

- vercel.ts in apps/web (approved by Hadukem): build command, output dir, SPA fallback, /api/* rewrite to the URL in an env var (document how to set it in the Vercel dashboard). Programmatic configuration replaces vercel.json so the destination can use the environment variable.
- Railway config for api and worker (railway.json or documented start commands): pnpm install with frozen lockfile, start with tsx, Node version from .nvmrc, health check on /api/health for the api service.
- api: listen on process.env.PORT when present (Railway), fall back to API_PORT.
- pnpm db:migrate runs before the api starts on Railway (pre-deploy command), never from the worker.
- docs/DEPLOY.md (in Portuguese): exact dashboard settings for Vercel and Railway, which env var goes where, how to roll back, how to read logs. Claude will follow this doc in the dashboards.
- Do not create accounts or projects; Claude does that in the dashboards with Hadukem logged in.
- Price retention: a daily worker job keeps every snapshot from the last 48 hours and, beyond that window, only the last snapshot of each hour per ticker and source. Test with PGlite.

Acceptance:

- Staging web loads at its Vercel URL and /api/health answers through the rewrite.
- Worker logs show price snapshots for all 7 tickers.
- README links to docs/DEPLOY.md.
