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

**Do** (in `packages/db`, Drizzle migrations)
- `users` (id, display_name, avatar_url, created_at, status: active | suspended | banned)
- `identities` (user_id, platform: discord | telegram, platform_user_id, platform_created_at nullable, unique on platform + platform_user_id)
- `checkins` (user_id, day, streak, unique on user_id + day)
- `quiz_questions` (id, prompt, options jsonb[4], answer_index, topic, active, scheduled_day nullable)
- `quiz_attempts` (user_id, day, question_ids, answers, started_at per question, score, unique on user_id + day)
- `hl_runs` (id, user_id, day, run_number 1..3, correct_count, ended_at, unique on user_id + day + run_number)
- `price_snapshots` (ticker, price_usd numeric, block_number, taken_at, index on ticker + taken_at)
- `ticker_status` (ticker, state: live | paused, reason, updated_at)
- `points_ledger` (id, user_id, amount int, reason, ref_id, created_at) — insert only
- `referrals` (inviter_id, invitee_id unique, qualified_at nullable)
- `flags` (id, user_id, raised_by, note, state: open | cleared | actioned, created_at)
- `admin_actions` (id, admin_id, action, target_user_id, reason, created_at)
- A DB role used by the API that has no UPDATE or DELETE on `points_ledger`.

**Acceptance**
- Migrations run from empty. A test proves a second check-in for the same user and day fails.

---

## T04 — Fluxion oracle package

**Goal**: reliable xStock prices for the Magnificent 7 from Fluxion pools on Mantle.

**Already in the scaffold**: `twap()`, `checkTicker()` and `parsePoolsJson()` in `packages/fluxion-oracle/src/index.ts`, with tests. Keep them and their tests; implement `getSpotPrices()` and the worker job.

**Inputs from Fluxion (T01)**: pool addresses, pool type and the correct read method (for example reserves, a price getter or a quoter), token decimals, quote token.

**Do** (in `packages/fluxion-oracle`, used by `apps/worker`)
- `getSpotPrices(): Promise<Record<Ticker, { priceUsd: string; blockNumber: bigint }>>` reading all 7 pools in one multicall via viem on `MANTLE_RPC_URL`.
- Keep the pool-reading logic behind one adapter function so it can be swapped when Fluxion confirms the method.
- Worker job every 15 s: read, insert into `price_snapshots`, run checks, update `ticker_status`.
- `getTwap(ticker, endAt, minutes = 15)` from snapshots (time-weighted, not a plain average).
- `get24hChange(ticker)` = TWAP now vs TWAP 24 h ago.
- Add `viem` as a dependency of this package only.
- Checks: stale if newest snapshot older than 2 min; jump if two consecutive snapshots differ more than `PRICE_JUMP_LIMIT_PCT` (config, default 5). Either pauses the ticker with a reason.
- Retry RPC failures with backoff; never crash the worker.

**Acceptance**
- Unit tests for TWAP, 24h change and both checks using fixture snapshots.
- A script `pnpm oracle:print` prints current prices for all 7 tickers from mainnet.

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
