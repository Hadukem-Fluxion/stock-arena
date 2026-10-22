# AGENTS.md — instructions for Codex

You are implementing mStocks Arena: casual games about tokenized stocks that run as a Discord Activity and a Telegram Mini App from one codebase. Read README.md first, then the brief you were given from docs/TASKS.md.

## Language

- Talk to Hadukem in **Brazilian Portuguese**: task summaries, questions, explanations, review replies.
- Everything inside the product stays in **English**: player-facing text, `apps/web/src/copy/en.ts`, player and admin guides that get published, error messages shown to players.
- Code, identifiers, code comments and commit messages stay in English so the codebase is consistent.

## Where we are

The scaffold exists but has never been installed. Start with brief **T02** in `docs/TASKS.md`. After that, follow the task order and dependencies in `docs/TASKS.md`; tasks owned by people or Claude (T00, T01, T05, T06, T17, T20) are not yours.

`packages/game-core` and the helpers in `packages/fluxion-oracle` already hold tested logic. Reuse them; do not rewrite them.

## Git

- Remote: the public GitHub repository `origin` (see `docs/INFRA.md`). `main` is protected: changes land only through pull requests with green CI.
- Branch per task: `t<id>-<short-name>` (for example `t03-db-schema`), from an up-to-date `main`.
- Commit messages: `type(scope): summary` (feat, fix, chore, docs, test, refactor), for example `feat(api): daily check-in endpoint (T09)`.
- Push the task branch to `origin` and give Hadukem the link to open the pull request (`https://github.com/<owner>/<repo>/compare/main...<branch>`). The PR description follows the format below, in Portuguese.
- Never merge your own PR. Claude reviews, Hadukem approves and merges.
- Never commit `.env`, secrets or `node_modules`. Never force-push `main`.
- The official Task Board is `docs/TASKS.md` and `docs/ROADMAP.md`; there is no external board. Keep both updated and report completed tasks in the PR summary for Claude's review.

## Accounts and secrets

- Hadukem owns every external account (GitHub, Supabase, Discord, Telegram, Vercel, Railway, AWS Lightsail). Claude configures the web dashboards; you work only from this repository and the terminal.
- Never ask for passwords or tokens in chat. Secret values live only in the local `.env` and in the hosting dashboards, entered by Hadukem.
- Never commit the quiz question bank or anti-abuse thresholds; both come from the database or environment variables.
- Lightsail hosting follows `docs/HOSTING_LIGHTSAIL.md`: server secrets stay in `/etc/mstocks-arena/.env`, root-owned and mode 600, outside the checkout. Railway configuration is retained as history; do not send rotated secrets to the blocked service.
- If a command needs a login (for example the first `git push`), stop and tell Hadukem what window will open and what to click.

## How to work

- Do exactly one brief per pull request. If the brief is unclear or conflicts with this file, stop and ask in the PR description instead of guessing.
- Do not change game rules, point values or limits unless the brief says so. They live in `packages/game-core/src/config.ts`.
- Keep the PR small. Touch only the files the brief names, plus tests and docs.
- Before opening the PR run: `pnpm lint && pnpm typecheck && pnpm test`. All must pass.
- PR description (in Portuguese) must contain: the brief ID, what changed, how it was tested, and anything left open.

## Code rules

- TypeScript strict mode. No `any` unless commented why.
- Validate every API input with Zod. Return typed errors, never stack traces.
- The server decides everything that affects points: answers, timers, scores, settlement. The client only displays.
- Quiz questions are sent to the client without the answer key. The answer is checked on the server, and the 30-second limit is measured on the server.
- Every point award is an insert into `points_ledger` with `user_id`, `amount`, `reason`, `ref_id`, `created_at`. Never update or delete ledger rows; corrections are new rows with a negative amount and reason `admin_adjustment`.
- Use one database transaction per game action, with a unique constraint that blocks double awards (for example one check-in per user per UTC day).
- All times are UTC. A game day is `YYYY-MM-DD` in UTC.
- All player-facing strings go in `apps/web/src/copy/en.ts`. English only.
- Never log tokens, secrets, Telegram init data or OAuth codes.

## Asset catalog and providers (from T09 onward)

- New lists, screens and games read the catalog from `packages/game-core/src/assets.ts`; never assume exactly seven assets. Cover catalogs with 3 and 30 assets in layout and game tests.
- Each asset selects a provider. Product names, logo badges and legal notices come from one provider configuration; do not scatter xStocks branding through new code. All current assets use provider `xstocks` when this configuration is introduced.
- Token provider and price reference are independent. The xStocks public API remains the stock price reference, including for possible future mStocks assets. Do not invent unconfirmed issuer details, branding or token addresses.

## Platform specifics

**Discord Activity**

- Use `@discord/embedded-app-sdk`: `new DiscordSDK(clientId)`, `await sdk.ready()`, `sdk.commands.authorize({ client_id, response_type: 'code', prompt: 'none', scope: ['identify'] })`.
- Send the code to `POST /api/auth/discord`; the API exchanges it at `https://discord.com/api/oauth2/token`, calls `/users/@me`, then returns `{ access_token, session }`. The client finishes with `sdk.commands.authenticate({ access_token })`.
- All network calls go through relative paths (`/api/...`) because the Activity is served by Discord's proxy.
- Discord account creation time = `(BigInt(id) >> 22n) + 1420070400000n` ms. Used by the anti-abuse rule.

**Telegram Mini App**

- Load `https://telegram.org/js/telegram-web-app.js`, call `Telegram.WebApp.ready()` and `expand()`.
- Send `Telegram.WebApp.initData` (the raw string) to `POST /api/auth/telegram`.
- Verify on the server: `secret = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)`; `check = hex(HMAC_SHA256(key=secret, msg=data_check_string))` where `data_check_string` is every field except `hash`, sorted by key, as `key=value` joined by `\n`. Reject if `check !== hash` or `auth_date` is older than 24 h. Use a constant-time compare.

## Prices

- The xStocks public API is the primary price source for all seven tickers. Fluxion V3 pools on Mantle are cross-checks for the five configured tickers.
- Only `packages/fluxion-oracle` talks to external price sources or the chain. Everything else reads `price_snapshots`, using `source = xstocks` for game prices; `fluxion_pool` rows are for cross-checking.
- Settlement normally uses the 15-minute TWAP. Explicit T26 exception: Higher or Lower compares two stored primary samples exactly: the first strictly after server lock (or at/after confirmed reopening), then the first at/after start + 15 minutes within 120 seconds. No float rounding decides equality. The worker persists both samples and awards points idempotently.
- If the newest snapshot for a ticker is older than 2 minutes, or two consecutive snapshots differ by more than the configured jump limit, mark that ticker `paused`. Paused or halted observations cannot supply a T26 start/end. A non-halted closed ticker may accept a queued prediction for the next confirmed opening. T25 frozen-session comparisons remain display data only and never determine T26 gameplay.
- Pause a ticker with reason `divergence` when its pool price differs from the primary quote by more than `PRICE_DIVERGENCE_PCT` (default 3). Pause with reason `closed` when trading is halted or the market period is closed; keep the last price and display "Market closed".

## Definition of done

- Acceptance criteria in the brief are met and covered by tests.
- No new lint or type errors. No secrets in code.
- Player-facing text added to `en.ts`.
- README or docs updated if setup or behavior changed.
