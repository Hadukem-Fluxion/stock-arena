# AGENTS.md — instructions for Codex

You are implementing Stock Arena: casual games about tokenized stocks that run as a Discord Activity and a Telegram Mini App from one codebase. Read README.md first, then the brief you were given from docs/TASKS.md.

## Where we are

The scaffold exists but has never been installed. Start with brief **T02** in `docs/TASKS.md`. After that, follow the task order and dependencies in `docs/TASKS.md`; tasks owned by people or Claude (T00, T01, T05, T06, T17, T20) are not yours.

`packages/game-core` and the helpers in `packages/fluxion-oracle` already hold tested logic. Reuse them; do not rewrite them.

## Git

- Branch per task: `t<id>-<short-name>` (for example `t03-db-schema`), from `main`.
- Commit messages: `type(scope): summary` (feat, fix, chore, docs, test, refactor), for example `feat(api): daily check-in endpoint (T09)`.
- Never commit `.env`, secrets or `node_modules`. Do not push or add remotes unless Hadukem asks.
- There is no GitHub remote yet. Until there is, "pull request" means: the task's branch, all checks passing, and a final summary in your reply in the PR description format below. Hadukem merges into `main` after Claude's review.
- When a task is done, say so in that summary; Hadukem updates the Task Board.

## How to work

- Do exactly one brief per pull request. If the brief is unclear or conflicts with this file, stop and ask in the PR description instead of guessing.
- Do not change game rules, point values or limits unless the brief says so. They live in `packages/game-core/src/config.ts`.
- Keep the PR small. Touch only the files the brief names, plus tests and docs.
- Before opening the PR run: `pnpm lint && pnpm typecheck && pnpm test`. All must pass.
- PR description must contain: the brief ID, what changed, how it was tested, and anything left open.

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

- Only `packages/fluxion-oracle` talks to the chain. Everything else reads `price_snapshots`.
- Settlement uses the 15-minute TWAP from snapshots, never one spot read.
- If the newest snapshot for a ticker is older than 2 minutes, or two consecutive snapshots differ by more than the configured jump limit, mark that ticker `paused`. Paused tickers are excluded from Higher or Lower and from settlement until resumed.

## Definition of done

- Acceptance criteria in the brief are met and covered by tests.
- No new lint or type errors. No secrets in code.
- Player-facing text added to `en.ts`.
- README or docs updated if setup or behavior changed.
