# Codex task briefs

One brief = one pull request. Paste the whole brief into Codex together with AGENTS.md. This file and `docs/ROADMAP.md` are the official Task Board; there is no external board. Keep them updated with implementation/review status and dependencies. Non-code tasks (T00, T01, T05, T06, T17, T20) are done by people or Claude and are not listed here.

## Task Board updates — 2026-10-27

| Task                | State / dependency                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| T14                 | Superseded by T28–T30                                                                                |
| T21 Daily Call      | CANCELLED — merged into T26                                                                          |
| T26                 | Integrated via PR #20; post-deploy smoke test remains pending confirmation                           |
| T28                 | Integrated via PR #23; real admin smoke test pending deployment                                      |
| Lightsail hosting   | Integrated via PRs #24/#30/#31; Ohio cutover reported complete at 9fe93dc; operator fixes integrated |
| T29                 | Integrated via PR #25; post-deploy smoke test pending                                                |
| T30                 | Integrated via PR #26; post-deploy smoke test pending                                                |
| T31                 | Integrated via PR #27; live smoke test pending                                                       |
| T31 follow-up       | Integrated via PR #29: atomic snapshot lock and CSV marker                                           |
| T33                 | Integrated via PR #28; dedicated home/screens and review adjustments; live smoke test pending        |
| Quiz option order   | Integrated via PR #32; deterministic per-player/day/question presentation and legacy sets preserved  |
| T35 public stats    | Integrated via PR #33; anonymous stats before T34                                                    |
| T34                 | Integrated via PR #34; simplified 200-point qualification                                            |
| T27 mStocks Flyer   | Integrated via PRs #35/#36; cross-session history and friendly chart retry retained for v1           |
| T36 Daylight Market | Integrated via PR #37; build-memory follow-up integrated via PR #38; rollout is operator-owned       |
| T37 Flyer v3        | Integrated via PR #39; follow-up on t37-flyer-polish                                                 |
| T37 follow-up       | Implemented for review: flyer-3b trails, clean title and canvas-contained exit                       |
| T32                 | Settlement query optimization; required before T19 load test; not part of T26                        |

Campaign decision for Mantle (not code): accepted reward identifiers (Bybit UID,
Mantle address or both) and manual delivery process. Keep both fields optional
until confirmed. This table records the official task status changes.

## T37 follow-up — More coins and layout polish

After PR #39 is merged, one PR on t37-flyer-polish. No merge, deployment or real
database operations. The approved exit/focus-loss behavior remains unchanged.

- Version new coin positions as **flyer-3b**; flyer-3 keeps its exact coin positions,
  physics, inputs and replay. Every seeded trail has 1–3 coins; trails are spaced
  exactly 3 or 4 buildings apart, between buildings, outside forced collisions.
  Physics, per-coin score, daily-best delta and campaign cap remain unchanged.
- Existing immutable daily courses stay untouched. New daily courses use v3b;
  a day already frozen as v3 continues using v3 for all players until UTC rollover.
  Migration 0017 only allows the extra protocol in the existing JSON check.
- Lobby title area contains sky/clouds only: no upper stock buildings or company
  logo badges behind mStocks FLYER; decorative buildings remain below the title.
- While playing, place the exit button at the top-left inside the visible canvas
  bounds, including desktop letterboxing and resize; retain mobile safe areas.
- Tests: exact released v3 coin/replay fixture; deterministic v3b spacing,
  collision clearance, shared replay and unique pickup; unchanged cap/awards;
  existing course/open-session migration and next-day activation; Discord and
  Telegram at 360×640, 390×844, 1440×900, including title-region pixel checks and
  actual button/canvas bounds. Evidence: docs/review/t37-follow-up.

## T37 — Flyer full-screen, tap-to-flap, charts and coins

After memory PR #38, one PR on `t37-flyer-gameplay`. No merge, deployment or
real database work. Approved reference: the **Flyer v3** row (Start, Play,
Game over, Bird) at https://claude.ai/artifact/SnR71PUz9Amb8XUtNqmJgd.

- Full-height 100dvh screens with safe areas, no app header/bottom navigation/card
  or page scroll. Desktop letterboxes only at the sides; mobile fills the height
  with a rendering-only horizontal camera crop. Preserve canonical physics and
  circular hitbox. Resize/rotation must not reset the simulation. Restore page
  styles on exit. Telegram requests fullscreen/expand and disables vertical swipes
  while flying, restoring prior state afterward. A visible 44px exit ends the
  flight with its verified current score; loss of focus/visibility also ends it,
  rather than introducing unrecorded pauses into the wall-clock replay.
- `flyer-3`: one fixed upward impulse per tap/click/Space, constant gravity and
  minimum one-tick debounce. Version all tuning in GAME_CONFIG; keep open
  flyer-1/flyer-2 physics/replays valid. Ordered flap ticks, strict bounds,
  wall-clock ±15%, single-use server replay. Aim for 5–15 buildings for a beginner;
  difficulty ramps every ten buildings, independently of coins.
- Start: live decorative scene, large mStocks FLYER, animated bird, Best today,
  Points today X/50 progress, TAP TO PLAY, Leaderboard and How to play modal;
  Back/sound at top. Play: outlined score, coin count and 44px exit only;
  "Tap to flap" before the first flap, never hold instructions in v3.
- Game over: large heading, Score/NEW BEST, Stocks, Coins, earned/cap progress,
  Charts you flew (official logos, accessible frozen primary 10–20-point
  sparklines, blue/orange plus ▲/▼), See all, top gainers/decliners, PLAY AGAIN,
  Home/Ranks/Share. Ranking opens separately. Missing chart history has an
  explicit fallback, never fabricated values or external API price requests.
- Flux bird: green #20c997 round body, dark outline, official transparent white
  Fluxion PNG in the center, dark visor/mint shine, orange beak and white wing;
  velocity tilt −25° to +70°, circular hitbox unchanged. Hadukem supplies the PNG;
  do not recreate or alter the official mark.
- Coins: **1–3 per group of ten buildings**, deterministic from the frozen daily
  course, optional risk trails outside forced collisions. Integer circle-circle
  collection once per coin in shared simulation; score = buildings + coins.
  Client never supplies coin counts. Disappear on pickup with golden +1/sound.
  Daily-best delta awards, campaign cap 50/day and referral eligibility unchanged.
- Tests: v3 deterministic replay/coins/input rejection, legacy compatibility,
  unique pickup, collision/miss, cap/delta, full-height/scroll restore, mocked
  Telegram fullscreen/swipes, charts accessibility/fallback. Discord/Telegram/
  browser at 390×844, 360×640 and 1440×900; all three screens and short gameplay
  video in docs/review/t37. Physical-device performance remains an operator check.

## T36 — Flyer v2 "Daylight Market" and S&P 500 reference catalog

### T36 build-memory follow-up

PR #37 is integrated, but Hadukem reports production remains healthy at 551d55d
because the 512MiB API compiler build exhausted its heap. On `t36-build-memory`,
move generated catalog data out of the TypeScript literal graph into runtime
validated JSON; preserve contents/version/rules. Keep complete CI typechecking,
use sequential strict production checks in Docker, and expose a build-only heap
argument (initial default 512MiB; Hadukem delegated the cheapest viable setting, so validate 280MiB). Measure API/worker compiler peak RSS before/after with
GNU time on Node 24.19.0; gate production checks below 400 MB. Add an effective
1GiB RAM + 2GiB swap image-build CI job and document reproduction/emergency heap
adjustment. No merge, deployment or real database operation.

Approved mockup: https://claude.ai/artifact/SnR71PUz9Amb8XUtNqmJgd, **B only**;
A/C discarded. One PR on `t36-daylight-market`; no merge/deploy/real database work.

- Freeze a dated S&P 500 constituent list and intersect it reproducibly with public
  xStocks availability, stocks only. Keep core Magnificent 7 unchanged for
  check-in/Home/HL and their 15s polling. Extended assets feed Flyer only, through
  independent configurable 5min bounded batches, rate-limit handling, compact
  primary summaries and bounded temporary references. Public logo colors are
  extracted offline and cached by ticker/official URL, with neutral fallback.
- One stock per pipe, server-chosen daily shuffle identical for all players,
  no repetition until exhaustion. Signed 24h/last-session change raises/lowers
  the gap within playable clamps; difficulty still ramps each ten pipes. Freeze
  the complete daily course (order/heights/metadata) and reference it immutably
  from sessions. Bump to flyer-2, preserving open flyer-1 replays and all existing
  physics, anti-cheat, caps, referral eligibility and award rules.
- Daylight sky/sun/parallax clouds/skyline/ground; rounded company-colored
  buildings with windows/caps, circular official logo and direction arrow, no
  visible ticker text on buildings. Ticker/move in screen-reader announcements
  and results. Fluxion bird/wings/outline/tilt; decorative coins, no extra points.
- HUD Back/S&P 500 run/star best/outlined score, "Hold to fly · release to drop";
  recorded 3-2-1, +1/particles/trail/collision shake/flash. Optional short sound
  only after first gesture with mute; Telegram-only haptics. Reduced motion,
  bounded decoded logo cache and target 60fps. Results: "You flew past N S&P 500
  stocks", top three gainers/decliners passed, logos/score/best/replay/ranking.
- Acceptance: deterministic v2 replay plus v1 compatibility; daily course sharing
  and persistence; dated intersection/no ETFs; clamps; color/logo fallback;
  bounded polling/retention; 3/30 assets and full-catalog phone frame budget;
  Discord/Telegram/browser e2e; screenshots at 390px/desktop and short video in
  docs/review/t36. Operator warm-up/rolling compatibility documented separately.

## Operational priority — Ohio cutover (2026-10-24)

After synchronizing T33 with merged T31 and the separate T31 lock/CSV follow-up, prepare one PR on chore-lightsail-ohio, before T34. Resources were created by Hadukem: mstocks-arena Lightsail/Ohio, 77.114.44.78, and fresh Supabase mstocks-arenaUS/fhslaelrgoiibblgfinu. Include Portuguese one-command-per-block PowerShell/SSH runbook, templates, official Docker/swap/hardening, secret rotation/validation, explicit migrations 0000–0012, local content-only quiz copy with counts, API_ORIGIN legacy compatibility, direct Ohio Telegram webhook, safe live smoke checks, manual Activity/Mini App/admin checklist and rollback/retirement. No merge, deploy, credentials, private question content or real database access by Codex. Old player/points/admin/reward data are intentionally not copied. Tests use isolated PGlite and mocked providers. Review adjustment: host UFW opens 22/80/443 without IP pinning; SSH stays key-only. Optional SSH source restrictions belong only in the browser-editable Lightsail firewall; explicitly open 443 there. Bootstrap firewall tests use mocked ufw on Linux, without provisioning.

### Follow-up — Ohio cutover fixes (2026-10-24)

Integrated via PR #31. Hadukem reports cutover complete at 9fe93dc:
API/worker/Caddy online, 13 migrations, 60 questions copied, Telegram setup and
Vercel API_ORIGIN configured. Operator fixes below are preserved; no
merge/deployment/live database access by Codex:

- Create /run/sshd (755) before sshd -t on Ubuntu 24.04 socket activation.
- Root/600 env validation/diagnostics use docker run --user 0; manual Compose
  commands pass APP_RELEASE explicitly through sudo.
- Live HTTPS smoke retries for about 60 seconds for first ACME issuance, with
  verified TLS and concise errors instead of empty-JSON tracebacks.
- Format Caddyfile with caddy fmt and check formatting in container CI.
- Document content copy (read -s + stdin) and Telegram setup in the server container
  as official alternatives to local PowerShell 7/Node tools. No secret echo/argv.
- Home/Markets explicitly say "Prices resume when the market opens" for closed
  assets without a stored primary quote. Keep existing last prices and informational
  pools; do not change price sources/game rules. Test missing-history and outage
  states, catalogs of 3/30 assets, mobile/desktop, and mocked HTTPS retries.

### Operational brief — Lightsail replacement hosting (2026-10-22)

Hadukem requested this hosting change before continuing feature work. Prepare one
PR on `chore-lightsail-hosting`, without merging. Railway is blocked per Hadukem's
21/10 incident report; retain its resources and historical setup.

- Ubuntu LTS/1 GB, pinned Node 24.19.0 and existing install/typecheck/start commands.
- Run migrations before API startup; worker never migrates or publishes a port.
- Caddy HTTPS proxy, `/api/health`, restricted SSH/80/443 firewall, key-only SSH,
  automatic Ubuntu security updates and a private server `.env` with mode 600.
- Generate fresh 48-character URL-safe session/webhook secrets without printing
  values; never include env files or the private quiz bank in images/Git.
- Portuguese `HOSTING_LIGHTSAIL.md` covers instance/static IP/DNS, provider secret
  rotation, Vercel's existing `RAILWAY_API_URL` key pointing to the new backend,
  local env synchronization, explicit `pnpm telegram:setup`, logs and rollback.
- Test generator/runtime guards locally and containers/Caddy/migration failure in
  Linux CI. Actual deployment and external smoke tests remain operator tasks.

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
- Stock of the Day: deterministic rotation over the catalog in `assets.ts` by day number; returns live price, 24h change, one fact from `packages/game-core/src/facts.ts`, and the asset's configured Fluxion link. Keep the launch rotation and scoring unchanged; lists, rotation and layouts must also work with 3 and 30 assets.
- Every asset declares a provider. Product name, logo badge and legal notice come from one provider configuration; all current assets use `xstocks`, independently of the xStocks reference-price source.
- Hadukem approved `https://app.fluxion.network/trade` as the per-asset destination until Fluxion confirms token-specific deep links. Do not invent URL parameters.
- Check-in screen with streak counter and the stock card; card has "View on Fluxion" using `openExternal`.

**Acceptance**

- Tests for streak continue, break, day-7 and day-30 bonuses, and double check-in rejection.
- Tests with 3 and 30 assets, atomic ledger/action rollback and server-confirmed UI awards. Existing game-core tests stay unchanged.

---

## T10 — Daily Quiz

**Use from game-core**: `quizPoints`, `quizAnswerInTime`. The private question bank is supplied by Claude outside version control, currently at `packages/db/.local/quiz-bank.json`. Never commit real questions, options, answers or explanations, including in tests or docs. Use invented fixtures only.

**Do**

- `POST /api/quiz/start`: picks 3 active questions for the day (scheduled ones first, then a seeded rotation so everyone gets the same 3), returns them without answers.
- `POST /api/quiz/answer` per question: server checks time since that question was served (max 30 s + 2 s grace), stores answer, returns right or wrong and the correct option.
- Score: 20 per correct, +15 for 3 of 3. One attempt per day.
- Idempotent `pnpm db:seed-quiz` reads a file path argument or `QUIZ_BANK_PATH`; JSON entries have `id`, `topic`, `prompt`, `options[4]`, `answer_index` and `explanation`. Upsert using `id` as a unique slug. Add `slug` and `explanation` to `quiz_questions` in a new migration; never edit old migrations. Print only the upserted count, never content or raw errors. Codex runs the Supabase seed locally **after merge**, not during implementation.
- Persist the daily selection to keep it stable across seed edits. Serve only the current question; `GET /api/quiz` resumes an attempt without resetting its timer, and `POST /api/quiz/next` serves the next question after feedback. Repeated starts/replies resume the same attempt rather than awarding twice. Expose the correct option/explanation only for answered questions.

**Acceptance**

- Tests for timing, scoring, single attempt, and that answers never appear in the start response.

### T10 follow-up — deterministic option ordering (2026-10-24)

Priority: Quiz option ordering → T34 referrals → T27 Flyer, one branch/PR at a
time, without merge/deployment/live database access by Codex.

- Shuffle alternatives on the server deterministically for (userId, UTC day,
  questionId). Map a submitted displayed index back to the original answer_index;
  store original indices and return feedback in the displayed order.
- No schema/migrations, bank edits, scoring or timer changes. Keep future keys,
  seeds and index mappings out of client responses. Tests use invented content.
- New frozen daily JSON snapshots include a private derived seed; existing
  unmarked sets retain their old order, protecting already displayed questions
  and historical answers. Persisted seeds keep an order stable across API restart
  and session-key rotation. Never rewrite an existing daily set to activate it.
- Cover stable reads/retries/restarts, different player/day fixtures, all four
  original key indices, correct feedback and scoring, idempotent awards,
  unmodified bank content and legacy in-progress/completed attempts.

---

## T11 — Higher or Lower

**Use from game-core**: `higherOrLowerWinner`.

**Staging follow-up (T11 only)**: if trading-metadata failures recur in staging,
fetch only assets configured in the catalog instead of the complete paginated
list, and cache the rarely changing metadata. Do not change the oracle during T09.

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

**Superseded by T34.** Historical three-check-in qualification below is not the new referral brief.

**Do**

- Each user gets an invite code. Discord: link to the Activity with the code as a custom id param; Telegram: `https://t.me/<bot>?startapp=<code>`.
- Store the inviter on the invitee's first login only. No self-invites.
- When the invitee checks in on their 3rd distinct day, award the inviter 50, up to 10 per season.

**Acceptance**

- Tests for qualification, cap, self-invite block, and that a later invite code does not overwrite the first.

---

## T14 — Admin panel

**Superseded by T28–T30.** Historical brief below; do not implement as one task.

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

- `/arena` (and `/start`) Activity launch is covered by T24 via the HTTP Interactions endpoint. Do not reimplement it in this bot task.
- `/rank`: the caller's daily, weekly and season rank (ephemeral).
- 00:05 UTC: post the previous day's top 10 to the leaderboard channel.
- Optional roles: grant Arena Player on first check-in; rotate Top Trader of the Week to the weekly top 10 on Monday.

**Acceptance**

- Commands registered for the Mantle guild. Role changes logged.

---

## T16 — Telegram bot

**Split**: T16a covers /start, /help and the Play menu through the API webhook, without a new service. Opt-in reminders remain a later T16 task; do not duplicate the webhook with a polling bot.

**Do** (`apps/telegram-bot`, grammY)

- `/start` (with or without a referral payload): welcome message in English plus a Play button that opens the Mini App.
- Set the menu button to open the Mini App.
- Opt-in daily reminder when the new quiz is ready, toggled from the app's Profile screen. Respect Telegram limits on message rate.

**Acceptance**

- Works in private chat; reminder only reaches users who opted in.

---

## T16a — Telegram /start via webhook (no new service)

**Status**: code integrated via PR #21, separately from PR #20. Real setup/deployment and the Telegram smoke test remain pending confirmation. No merge by Codex.

**Do**

- Add `POST /api/telegram/webhook`, exempt only this exact POST route from player session auth. Verify `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET` using constant-time comparison; missing/invalid credentials or unconfigured secret return 401. Never log tokens, secrets or full updates.
- Reply directly in the webhook response with `method: sendMessage`. No outbound polling, new Railway service, database writes or point awards.
- Private chat `/start`, with or without payload: "Welcome to mStocks Arena! Play a few minutes a day with tokenized stocks: daily check-in, quiz and Higher or Lower. Points only, no wallet. Not financial advice." Inline button "Play", `web_app.url = https://mstocks-arena.vercel.app`.
- Keep the parsed start payload available for T13, without storing, echoing or logging it. `/help` explains how to play and warns that the app will never ask for a wallet/seed. Other text gets the Play button. Ignore non-message, non-text and non-private-chat updates (web_app buttons require a private chat).
- Keep all bot copy in `apps/web/src/copy/en.ts`.
- `pnpm telegram:setup`: explicit local operator script reading `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` from `.env`. Set webhook URL to `https://mstocks-arena.vercel.app/api/telegram/webhook`, with `secret_token` and `allowed_updates: ["message"]`; set commands start/help; set default web_app menu button "Play". Hadukem runs it after deployment; never run setup at startup or in CI.
- Add the new secret to `.env.example` and DEPLOY.md. Hadukem generates a random 32+ character secret and configures Railway/local environment. Setup accepts Telegram's URL-safe character set, up to 256 characters. Sanitize all setup failures because Telegram request URLs contain the bot token.

**Acceptance**

- Tests cover secret authentication, /start with and without payload, /help, other text, ignored updates and log privacy. Other API routes remain session protected.
- Mocked setup tests verify all three configuration calls, validation and sanitized failures, with no real credentials or network requests.
- No new service or migration. Real Telegram smoke test and setup remain post-merge, after Railway recovers. Rest of T16 remains pending.

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

**Dependency**: complete T32 (settlement query optimization) before running this task.

**Do**

- k6 or Artillery script: logins, check-ins, quiz answers, HL picks and SSE connections.
- Run against staging at the target set by Hadukem; report p95 latency and error rate in the PR.

---

## T21 — Daily Call

**CANCELLED — merged into T26.** Historical brief below, not a separate game.

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

---

## T24 — /arena via Discord Interactions endpoint

**Scope**: a small task separate from T15. Open the Activity from chat, without a gateway connection or discord.js. T15's rank, announcements and roles remain for later.

**Do**

- `POST /api/discord/interactions` verifies Ed25519 over the exact raw request body prefixed by `X-Signature-Timestamp`, using `DISCORD_PUBLIC_KEY`. Missing/invalid signatures return 401. Never verify re-serialized JSON. Parse and validate JSON only after verification.
- Signed PING (`type: 1`) returns PONG (`type: 1`). Signed APPLICATION_COMMAND (`type: 2`) for `/arena` and `/start` returns `type: 12` (LAUNCH_ACTIVITY). Unknown commands get short English ephemeral copy from the API copy file. No database, point awards or user session is needed.
- Exempt only this POST route from the `/api/*` session requirement; Discord's signature authenticates it. Other game/auth behavior stays unchanged. Missing/invalid public-key configuration fails closed.
- `pnpm discord:register-commands` registers global CHAT_INPUT commands `arena` and `start`, each described as `Open mStocks Arena`. Use `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` with client credentials / `applications.commands.update`, or `DISCORD_CLIENT_ID` and `DISCORD_BOT_TOKEN`. Upsert the two commands individually, preserving unrelated commands. Never print credentials, tokens or raw provider errors.
- Codex runs registration locally once **after merge**. Never register on API startup, build or CI. Tests use mocked HTTP only.
- Add `DISCORD_PUBLIC_KEY` to `.env.example` and `docs/DEPLOY.md`. Claude copies this public key from Developer Portal to the Railway API variables; no secrets enter the frontend.
- Document Developer Portal's Interactions Endpoint URL: `https://mstocks-arena.vercel.app/api/discord/interactions`. Deploy the API with the matching public key before Claude saves the URL: Discord sends a validation PING while saving.

**Acceptance**

- Tests: valid/invalid/missing signatures, signed PING, `/arena` and `/start` returning type 12, unknown command with ephemeral English copy, raw bytes (whitespace/Unicode/re-serialization), JSON-parser/session isolation and sanitized registration failures.
- One PR on `t24-discord-arena`, no merge by Codex. Real registration and Discord smoke tests remain post-merge actions.

---

## T25 — Closed-market last-session mode

**Goal**: Higher or Lower works seven days a week when primary history is available. Fluxion pools must never supply gameplay prices.

- When xStocks reports `currentPeriod: closed` without a trading halt, compare each asset's last primary snapshot before the closing boundary with its primary snapshot at or immediately before 24 hours before that boundary. Keep the existing 120-second tolerance for both samples and `minChangeGapPct`.
- Use persisted `xstocks` snapshots only. Exclude assets without verifiable closing/history data; fewer than two eligible assets keeps the game paused without consuming a run. Trading halts remain paused. Do not mix live and last-session comparisons in a pair.
- At confirmed closing, freeze the closing price, session change, closing boundary and source sample prices/times in `ticker_status` outside snapshot retention. HL reads the frozen session even after raw samples disappear. Confirm an open-to-closed transition on the first valid poll after the scheduled boundary without a detection deadline, including restart/API failures; the 120-second tolerance still applies to the primary samples.
- Keep scoring, daily limits, UTC resets and open-market behavior unchanged. Freeze the comparison mode with each round, including feedback after reopening.
- English copy in `en.ts`: `Which stock moved more in the last trading session?` and `Last session` on rounds and feedback.
- When closed, the price panel also displays the persisted Fluxion pool price if available, labeled `On-chain · Fluxion pool`. It is informational only.
- Document in README and GAME_RULES. Tests: weekend with history, missing history, halt, Friday-to-Monday transition and unchanged weekday behavior; catalog layouts with 3 and 30 assets at mobile/desktop widths.
- Review regressions: simulate 60 hours with real retention deleting the original samples and play on Sunday night; simulate a worker restart or metadata failure spanning ten minutes after closing, including missing/out-of-tolerance samples.
- Branch `t25-closed-market-mode`, one PR with screenshots, no merge by Codex.

---

## T26 — Higher or Lower becomes a 15-minute Up/Down prediction

**Why**: the retrospective comparison can be looked up on any broker. The result must be unknown when the player picks.

**Rules (confirmed by Hadukem)**

- One stock per round, chosen at random by the server among eligible (live, not halted) catalog assets. The player picks Up or Down.
- Result 15 minutes after the start price. Any rise = Up wins, any fall = Down wins. No neutral band. An exactly equal price = no result: no points, the run continues and the player may pick again.
- +5 points per correct pick, up to 10 correct per run. First wrong pick ends the run. Max 3 runs started per UTC day; up to 3 runs may be active at the same time, each with at most one pending prediction.
- Market closed (not halted): the player may lock a prediction for the next session. It shows "Waiting for market open" and settles 15 minutes into that session.
- Points only. No money, no real trading, no wallet. xStocks API is the only price reference; Fluxion pools stay informational.

**Price windows**

- Lock time = server receipt of the pick (never client time).
- Start price = first primary (`xstocks`) snapshot taken strictly after lock (prevents latency sniping). For closed-market picks: first primary snapshot at or after the confirmed reopening boundary.
- End price = first primary snapshot taken at or after start.takenAt + 15 min, within the 120 s staleness tolerance.
- AGENTS.md exception: T26 settles on these two primary samples instead of a 15-minute TWAP. Jump-limit/divergence pauses still apply.
- Equality: compare the stored decimal prices exactly, at the precision persisted in `price_snapshots`; no float rounding.
- Store start/end price and takenAt on the round row at the moment they are captured, so settlement never depends on snapshots surviving retention.

**Edge cases**

- If an unlocked offered stock becomes ineligible, read/next/pick atomically voids that offer and serves a replacement at the next position, without affecting points, correct count, daily starts or run expiry. A pick intended for the old offer is never applied to the new stock. With no replacement, read returns the complete view (200), keeping the offer untouched with `canPick: false` and `canStart: false`; other runs, including pending predictions, remain visible. Next/pick return `HL_UNAVAILABLE`, leaving all state unchanged.
- Ticker paused, halted, stale or missing data at the start or end moment: keep retrying until valid data appears, up to `settlementRetryHours` (6). Otherwise void: no points, the run continues. A halt between start and end voids the round.
- Opening delayed or metadata missing: the prediction stays pending; same 6 h void rule, counted from the scheduled boundary.
- UTC day change: pending predictions settle normally. The daily limit counts runs started per UTC day. A run expires (keeping its points) 24 h after its last settlement without a new pick.
- Persistence: everything is server-side. Leaving the app or restarting the worker/API must not lose or duplicate anything.
- Settlement runs in the worker, idempotent: one transaction per round with row lock; ledger ref_id `hl:<roundId>` with a unique constraint, so no double award. The API only displays the state.
- Migration: preserve the ledger and old hl rounds. If displayed in history they are "Classic". End runs still active on the retrospective model at deploy without awarding or removing points. T25 no longer feeds gameplay; keep its frozen-session data only for the closed-market price panel.

**UI (English, en.ts)**: "Will {TICKER} go up or down in the next 15 minutes?", buttons "Up" / "Down", pending card with countdown, "Waiting for market open" for closed-market picks, result card with start price, end price and % move, "No change — pick again", "Void — no data", 3 run slots.

Display price moves with two decimal places and a sign for nonzero moves (e.g. `+1.00%`, `-0.37%`). This formatting is UI-only; settlement still compares persisted prices exactly.

**Acceptance (tests)**: up/down/equal outcomes; start sample strictly after lock; 15-minute end sample; parallel runs and one pending per run; daily start limit; 10-correct cap; closed-market pick settled after reopening; delayed reopening; halt mid-window → void; 6 h void; worker restart mid-window; double settlement attempt pays once; UTC rollover; run expiry; old rounds/ledger preserved. Catalog layouts with 3 and 30 assets at mobile and desktop. Update README and GAME_RULES. One PR with screenshots.

**Implementation contract**: valid end samples stay in the fixed `[start + 15min, start + 17min]` window. Retries wait up to 6h for those observations; they never silently move the prediction window. Unlocked offers expire after 24h from run creation; settled runs after 24h from last settlement. Locked predictions are not expired mid-window. Historical Classic runs are preserved but not included in the new prediction slots.

---

## T28 — Admin hub foundation: login, team and audit

**Status**: integrated via PR #23, merged by Hadukem. Real deployment validation remains pending.
Includes migration `0009_admin-foundation`, PGlite/OAuth tests, browser captures,
and operator/deploy guides. Real Discord web login is pending post-merge setup.

**Goal**: Hadukem runs the product alone and can grant/revoke team access without code changes or AI. Implement only after T26 is integrated.

- Standalone admin at `/admin` on the web app (desktop browser, outside the Activity). Login with Discord OAuth web redirect flow (scope `identify`), separate admin session cookie (HttpOnly, Secure, SameSite=Strict, 12 h), logout and server-side revocation.
- Table `staff` (user_id, role, granted_by, granted_at, revoked_at). Roles: owner, admin, moderator, support. Permission map in code:
  - owner: everything, incl. team management and ownership transfer (requires confirming by typing the target's display name).
  - admin: all operations except team management.
  - moderator: read players, raise flags.
  - support: read-only.
- Bootstrap: `OWNER_DISCORD_ID` env creates the first owner on first login if no owner exists. `ADMIN_DISCORD_IDS`/`ADMIN_TELEGRAM_IDS` are deprecated (keep working until T29 merges, then remove).
- Team screen: add a member by Discord user id, change role, revoke (takes effect on the next request; revoked sessions are rejected). There must always be at least one owner.
- Audit: extend `admin_actions` → nullable target_user_id, target_type, target_id, details jsonb, ip hash. Every admin write and every export creates a row. Audit log screen with filters (actor, action, date). Audit rows are append-only.
- `requirePermission(perm)` on every `/api/admin/*` route; deny by default.
- Write an operator guide `docs/ADMIN_GUIDE.md` (English) and keep it updated in T29–T31.
- Tests: each role × each route permission, revocation, last-owner protection, ownership transfer, audit row per write.

## T29 — Admin operations: quiz, players, points, flags

Implementation: quiz bank and frozen-day-safe imports; player profiles/status;
idempotent ledger corrections; append-only flag notes and transactional resolution.
Migration `0010_admin-operations` is required. Legacy admin allowlists are removed;
operators must have Staff membership. English guide: `docs/ADMIN_GUIDE.md`.
Review captures contain synthetic data only. No live migration or production
bank import is part of this PR. Game controls/seasons remain T30; rewards remain T31.

- Quiz bank: list, search, add, edit, deactivate, schedule for a day, import JSON (same format as seed-quiz). Answer key visible only in admin. Questions in use by today's frozen set cannot be edited, only deactivated for future days.
- Players: search by name or platform id; profile with identities, account age, eligibility, ledger history, runs/attempts; suspend and ban with reason (suspended users cannot earn points; banned cannot log in).
- Points: adjustment with required reason → new ledger row `admin_adjustment` (positive or negative); never update/delete ledger rows.
- Flags: list open flags, add note, clear, or action (suspend/ban/adjust).
- Tests for each write path and the audit rows.

## T30 — Admin game controls and seasons

Implementation: game gates preserve reads and in-flight prediction settlement;
manual ticker overrides are separate from oracle health; database seasons replace
`GAME_CONFIG.season`. Migration `0011_admin-game-controls` preserves Season 1,
seeds active game switches and retains legacy manual pauses. Owner-only past-start
changes and all controls are audited. Review uses PGlite and synthetic mobile/
desktop captures (catalogs with 3/30 assets). Live migration/deploy checks remain
pending after review/merge; no ledger rewrite or T31 feature is included.

- Per-game switch: pause/resume Check-in, Quiz, Higher or Lower (paused game shows an English "Paused for maintenance" message; no runs consumed).
- Prices: ticker status table; manual pause/resume per ticker with reason.
- Seasons table in the database (id, name, starts_at, ends_at) replacing `GAME_CONFIG.season`; owner/admin can create the next season and set/change end dates. Leaderboards read it. The ledger is never rewritten. Changing a past start date requires owner role and is audited.
- Tests: paused game blocks actions without consuming limits; season boundaries on leaderboards.

## T31 — Reward registration, season snapshots and delivery review

Hadukem confirmed on 2026-10-23 that this delivery includes both the original
Profile destination registration and the expanded season reward workflow.
Implementation branch: `t31-rewards`. No merge, deploy or real database writes by Codex.

- Player Profile: optional Bybit UID (5–12 digits) and Mantle address (0x + 40 hex; validate EIP-55 for mixed case). No wallet connection/signatures. Explicit review and confirmation: "I confirm these details are mine and correct".
- Changes append masked old/new values, timestamp and player/staff actor to `reward_destination_history`. Players can read only their own data. Staff corrections require owner/admin, confirmation and an audited reason. Concurrent stale edits fail safely.
- Owner/admin can lock destinations for a season before payout. Any locked season blocks all player/staff destination edits until every lock is cleared. UI: "Locked for payout review". Moderator/support see only the last four characters; full values/export are owner/admin only.
- Migration `0012_rewards`: prize rank bands by season, immutable top-N ranking snapshots, immutable recipient rows and append-only status events (pending / approved / delivered / void). Ledger and admin_actions remain append-only; no historical migration changes.
- Admin defines nonoverlapping prize bands covering ranks 1 through N (N configurable in the UI). After the season ends, owner/admin explicitly generate its snapshot once. Freeze the season window, rank, points, display name, Discord/Telegram identities and prize description. Use the existing ranking/tie rules. Never regenerate/delete a frozen snapshot; later ledger/name/date changes do not rewrite it.
- Owner/admin approve pending rewards, then mark delivered, or void pending/approved rewards. Notes required; delivered/void are final. Support/moderator read only. Inactive players cannot be approved/delivered.
- Export CSV from the snapshot, with current destination values and their last-change time, rank, points, display name, platform IDs, account/reward status and eligibility. Audit actor and row count for each export. Include no authentication, IP, quiz or unrelated personal data. Escape CSV formulas. T18 eligibility is still pending: export `review_required`, never claim automated verification.
- English copy: "Rewards are reviewed by mods and paid manually according to the campaign terms." No automatic-payment or ownership-verification promise.
- Quiz check: T30 intentionally preserves the 30-second server deadline across maintenance. Document that a late reply after resumption times out; this delivery does not change timers, points or attempts. Include a regression test and operator warning to pause between questions where possible.
- Tests: validation, history, ownership/privacy, lock and concurrent edits, roles/revocation/CSRF, season boundaries/ties/top N, freeze preservation, state transitions, CSV content/formula escaping, export/write audit, migration preservation and append-only triggers. E2E and synthetic mobile/desktop screenshots in `docs/review/t31`; update ADMIN_GUIDE, README and GAME_RULES.

---

## T27 — mStocks Flyer (hold-to-rise arcade)

**Order**: T31/T33/T34 are integrated; implement T27. One branch/PR, no merge/deploy/live database changes by Codex.

**Post-merge follow-up (Hadukem, 25/10)**: PR #35 is integrated. Anchor the course's
history at each ticker's latest primary snapshot at/before server now. The urgent
26/10 correction in the same PR #36 replaces wall-clock buckets, which still fail
after Monday/holiday reopening, with the approved sample-count alternative: take
the latest N distinct primary observations, N = ceil(24h / configured poll
interval), then ntile(10) by position, preserving first/last prices. At least ten
observations are required; closed gaps and hourly retention do not block play.
Charts ending more than the existing 120-second tolerance ago show "Last session".
Keep frozen sessions compatible and all replay/scoring validations. Missing history
shows "Flyer is getting today's charts ready. Try again soon." with a retry that
starts a new request. Cover Saturday, Monday 01:00 UTC with Friday + new data,
midweek holiday, normal intraday data, <10 samples and the friendly-state e2e.
No migration/deployment/live database operations. S&P 500 planning follows
Hadukem's forthcoming brief, outside this PR.

**Goal**: a quick skill game that keeps the stock theme: the pipes follow real price charts.

**Gameplay**

- Hold to rise, release to fall; pass through gaps between pipes. While touch, mouse or Space is held, the bird rises with acceleration up to a maximum upward speed. On release, gravity pulls it down. Movement is smooth; there is no fixed impulse per tap. Canvas, 60 fps target, works inside the Discord Activity and the Telegram Mini App, portrait and landscape.
- Mobile input: use `touch-action: none` and `user-select: none` on the canvas, and `preventDefault` for `touchstart`/`contextmenu` to block long-press, selection and context menus. Releasing outside the canvas must count as a release too. Keep this behavior working inside both Discord Activity and Telegram Mini App.
- Course: segments of 10 pipes, one stock per segment, in a server-chosen random order from the catalog (never assume 7 assets). The gap center of each pipe follows that stock's primary (`xstocks`) price over the last 24 h, downsampled to 10 points and normalized to the playfield (min→bottom margin, max→top margin). Segment label shows ticker and logo.
- Difficulty ramps per segment: scroll speed up, gap size down, to config limits. Tune the curve for held acceleration and gravity rather than tap impulses. Document the chosen rise acceleration, maximum rise/fall speeds, gravity and minimum gap (with units), plus segment ramp values, in the versioned game config during T27 implementation.
- Game over card: the chart(s) flown with ticker and 24 h % move, a company fact (reuse facts), score, daily best, "Play again".
- Branding: bird uses the Fluxion mark, pipes show provider logos via the asset/provider configuration. No Bybit/mStocks assets until the brand kit is approved; swapping must be config/asset-only.

**Server-validated scores (required)**

- `POST /api/flyer/start` → session id, seed, course data (price points per segment), config version. One active session per user; expires after 10 min.
- Deterministic simulation in `packages/game-core` (fixed 60 Hz timestep, fixed-point or integer math, no Math.random/Date in the sim), shared by client and server.
- `POST /api/flyer/finish` with the input log: tick-stamped `press`/`release` pairs, alternating and beginning with `press`. Record actual held-state transitions, not repeated flap impulses. The server replays these transitions with the session's seed/course in the same deterministic 60 Hz simulation and computes the score. Reject out-of-order or overlapping events, invalid press/release sequences, events with ticks beyond the match's end, mismatched or impossible logs, tick count inconsistent with wall-clock time between start and finish (±15%), and expired or reused sessions. The client score is never trusted.
- Limits from config/env (not committed values for anti-abuse thresholds): max finishes per user per UTC day, max session length. FLYER_MAX_FINISHES_PER_DAY and FLYER_MAX_SESSION_SECONDS are required private values with no repository defaults; missing/invalid configuration disables starts. The session length must be a positive integer below the public 600-second expiry, leaving time to submit a result.

**Points and leaderboard**

- 1 point per pipe of the player's daily best, capped at 50 points per UTC day. Award only the increase when a new daily best is set (ledger reason `flyer_best`, ref_id `flyer:<day>:<sessionId>`, unique; never above the cap).
- Own leaderboard (best score: today / week / season), ties to whoever reached it first. Points also count in the main leaderboards. Hadukem confirmed that flyer_best belongs in rewardReferral gameReasons and counts toward the 200 gameplay-point referral milestone.
- Admin (T29/T30): per-game pause switch includes Flyer; admin can view a player's sessions and void a session (ledger correction row).

**Approved layout**: screen 4 of the shared T33/T34/T27 mockup: Back to home + "Best N", segment ticker and score above the central canvas, "Hold to rise" hint. Enable the home card only when this task is implemented. Include a short gameplay video/GIF, mobile/desktop captures and Discord/Telegram/browser e2e checks.

**Copy (en.ts)**: "mStocks Flyer", "Hold to fly, release to fall", "Fly through real price charts", "New best!", "Daily points cap reached — keep playing for the leaderboard".

**Acceptance (tests)**: deterministic press/release replay (same log → same score on client and server); invalid sequences (including starting with release), out-of-order/overlapping events and ticks beyond match end rejected; release outside the canvas clears held input and is captured in the replay; touch/mouse/Space controls and mobile long-press/selection/context-menu blocking; tampered log rejected; time-inconsistent log rejected; session expiry/reuse; daily cap and delta awards; course built from primary snapshots only, with missing data → that stock skipped; catalogs with 3 and 30 assets; mobile and desktop screenshots; performance check on a mid-range phone viewport. Update README and GAME_RULES.

---

## T32 — Prediction settlement query optimization (before T19)

**Status**: follow-up from T26 review; does not block PR #20. Implement in a separate branch/PR before T19's load test, with no merge by Codex.

**Goal**: avoid scanning every unsettled prediction and open run on every worker poll, especially with thousands of queued weekend predictions.

**Do**

- Select due prediction work in SQL: start capture only after its lock/reopening boundary, `target_at <= now` for end capture, or a reached void deadline. Do not open a transaction for future work that cannot progress yet.
- Select expiring idle runs in SQL with `coalesce(last_settled_at, created_at) < now - 24 hours`, excluding runs with a pending prediction. Avoid scanning every open run.
- Preserve captured samples, original price windows, observed-halt voids, six-hour retries, pending predictions across UTC/weekend boundaries, row-lock order and exactly-once ledger awards. Review indexes/query plans as needed, using new migrations only.

**Acceptance**

- Due work is processed and future-boundary/target work is skipped without changing gameplay.
- Thousands of weekend predictions and idle/active runs demonstrate bounded candidate selection; pending runs do not expire as idle.
- Regression tests preserve halt handling, delayed reopening, void deadlines and double-settlement protection. Document query plans and how the changes prepare T19.

---

## T33 — New home and dedicated screens

**Scope**: frontend only; no API, database, dependencies or scoring changes.
**Reference**: Hadukem-approved six-screen mockup: https://claude.ai/artifact/JMjJR4PjDSx3LysupiTTdN. Retain the DESIGN.md brand tokens and official assets. Queue: T31 → T33 → T34 → T27.

- State/hash screens: home, quiz, higherLower, flyer, invite, markets, leaderboard, profile. Preserve platform launch parameters. Bottom navigation: Home · Markets · Ranks · Profile; no duplicate header navigation. Game screens have a 44px "Back to home" button and native Telegram BackButton support.
- Fixed brand header with days/points pills; remove page intro and host label. Show connection status only while loading or on error.
- Vertical Home: compact Stock of the Day (logo, symbol, name, price, change, one-line fact and check-in/done state); Daily Quiz and Higher or Lower cards with concise rules and remaining run count; disabled mStocks Flyer card with "Soon"; highlighted disabled Invite friends card, "+50 pts for each friend who checks in" and "Soon". No referral or Flyer mutations yet.
- Today's top 3, caller row when outside the top three, "See all" → Ranks. Compact provider/Fluxion/Mantle footer and legal sheet with full approved notices.
- Reuse QuizPanel and HigherLowerPanel on dedicated screens. Higher or Lower: three keyboard-accessible run tabs, 64px Up/Down buttons, countdown and "Safe to close the app.", rules in "How it works" details. Preserve maintenance, closed-market, void, daily limits and error handling.
- Markets owns the existing catalog list, "Live · 24h" status when live, Fluxion link and provider price disclaimer. Informational pool price remains closed-market only.
- All copy in en.ts, remove obsolete strings; 44px targets, visible focus, 4.5:1 text contrast. Test 3/30 assets, mobile/desktop, browser preview and simulated Discord/Telegram. Save 390px/desktop captures in docs/review/t33. No merge/deploy/real database changes.

## T35 — Public statistics for Mantle Synch

**Order**: before T34, one small branch/PR without merge, deployment or real DB access.

- GET /api/public/stats, forwarded through the existing Vercel rewrite; anonymous,
  read-only, no cookies or player/identity/reward data. Return updatedAt, UTC day,
  season metadata or null, player total/activeToday, today's check-ins/completed
  quizzes/locked HL predictions and active/paused switches for the three games.
- One aggregate SQL query per 60-second process-local cache window; coalesce
  concurrent refreshes and suppress per-request DB retries on failures. Invalidate
  at UTC midnight. Successful responses: Cache-Control public, max-age=60.
- CORS allows exactly https://mantle-synch.netlify.app and GET/OPTIONS, without
  credentials; other origins have no allow header. Vary by Origin. Other methods
  return 405; unknown query parameters are rejected.
- Simple per-IP/minute HTTP limit (public default 60, configurable via env),
  bounded memory and Retry-After on 429. Trust only the nearest forwarded address
  from the existing private Caddy hop; do not enable global proxy trust.
- Document counter definitions, cache/CORS/limit behavior and a synthetic example
  in docs/PUBLIC_API.md. Tests cover exact shape/no PII, real isolated aggregates,
  concurrent cache, rollover, CORS allow/deny, methods, quota and sanitized errors.
- No migrations, schema, game rules, points or account/session behavior changes.

## T34 — Invite friends (referrals)

**Dependency**: T33, quiz ordering and T35 are integrated. Before T27. One branch/PR; no merge/deploy/live database changes. Use screen 5 of the approved mockup, with the updated reward copy below.

**Product decision confirmed by Hadukem on 2026-10-25**: keep it simple. Invitee gets +20 at their first check-in. Inviter gets +50 once the invitee earns 200 gameplay points. No percentage, commission window or recurring commission. This replaces first-check-in qualification, the historical three-check-in/season cap, and all intermediate percentage proposals.

- Fixed random, non-sequential per-user codes. Migration 0013 upgrades the existing referrals table without deleting old assignments/qualification dates; new invite_codes table, stored code/platform/creation/status (pending/rewarded/void) and invitee_bonus_at. Assignment and codes are immutable; no referral deletion. Legacy platform may be null when not known.
- Telegram deep link t.me/<bot>?startapp=ref_CODE: read start_param only after verifying the signed raw initData at login. Discord SDK shareLink with custom_id; SDK customId travels with the OAuth login and is validated against stored codes. Capture only on new account creation. Unknown/paused launch codes never block login.
- Manual fallback POST /api/referral/claim before any prior check-in, quiz attempt, HL run or ledger activity, within the first 24 hours. No self-invite, inactive inviter or reassignment. One immutable inviter per account, including after a void.
- GAME_CONFIG.referrals owns +50/+20/200 and maxRewardsPerDay (50 qualifications per inviter/UTC day). Check-in/streak, completed quiz and settled Higher or Lower points count; T27 also includes verified Flyer daily-best awards. Referral bonuses and admin adjustments never count. The invitee keeps every gameplay point. Qualify inside the game award transaction. No multi-account detection in this task.
- Award each bonus once with ledger reason referral and reference ref:<inviteeId>, unique per user. Bonus times are independent: an invitee who qualifies before their first check-in can still get +20 later. Invite maintenance blocks claims and both bonuses, not the underlying games; a later game action retries pending bonuses after resume. Inactive inviters cannot receive referral awards.
- At the daily qualification cap, retain pending status; retry on a later game award/check-in after UTC rollover. Voided qualifications retain their original timestamp and never free daily quota.
- UI: +50 pts hero, plain 200-point condition, invitee +20 explanation, Copy/Share, Friends joined and net inviter Points earned, three steps, manual code details and full rules in How it works. Activate Home Invite card; Flyer remains Soon. All copy in en.ts, provider branding unchanged.
- Admin: filter by inviter/invitee/status, paginated list. All Staff roles read; owner/admin void with a required note. Void reverses every paid bonus (including a welcome-only pending invite) through new negative admin_adjustment rows, never ledger edits. One transactional audit row; retries cannot reverse twice. Never delete or reassign.
- Tests: signed platform entry/tampering, new-account/no-games/manual cutoff, self-invite/reassignment, stable random codes, 199/200 boundary, exclusion of referral/admin points, separate bonuses, qualification via check-in/quiz/worker, concurrent/double awards, cap/UTC retry, pause, permissions, audit/void reversals and immutable records. Isolated PGlite only. Discord/Telegram/browser e2e, catalogs 3/30 and 390px/desktop screenshots in docs/review/t34. Update README, GAME_RULES, PLAYER_GUIDE and ADMIN_GUIDE.

### T31 follow-up — atomic snapshot locks and CSV change marker

Freeze automatically upserts the season reward lock to true in the snapshot transaction and audits the prior/new lock state. CSV includes changed_after_snapshot (strictly later than snapshot.created_at, false when equal/missing). Preserve ledger/audit append-only rules. Test initial/already-held locks, empty rankings, rollback on audit failure, concurrent freeze and CSV time boundaries. Integrated via PR #29; no new migration or real database operation.
