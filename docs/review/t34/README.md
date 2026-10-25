# T34 review — Invite friends

Hadukem's final product decision (2026-10-25): +20 to the invitee at first
check-in; +50 to the inviter once that friend earns 200 gameplay points.
No percentages, recurring commissions or commission windows. The approved
screen 5 layout is retained with updated reward copy.

## Captures

All identities, links, balances and referrals are synthetic. No real question
bank, platform session, credential or database was used.

- [Mobile, 3 assets](invite-390-3.png)
- [Mobile, 30 assets](invite-390-30.png)
- [Mobile at the end of the page](invite-390-bottom.png)
- [Desktop, 3 assets](invite-1440-3.png)
- [Desktop, 30 assets](invite-1440-30.png)
- [Owner operations](admin-invites-owner.png)
- [Support read-only](admin-invites-support.png)

Full-page captures retain the fixed navigation at its viewport position. The
mobile end-of-page capture and an e2e bounding-box assertion verify that the last
control can scroll fully above the bottom navigation.

## Behavior and validation

- Stable random codes, signed Telegram start_param and Discord SDK customId
  capture only on first account creation; manual fallback before playing/24 h.
- Separate bonus times, exact 199/200 boundary, game-only qualification and
  idempotent transaction/ledger awards through check-in, quiz and worker settlement.
- Public product quota: 50 qualifications per inviter/UTC day. Capped or paused
  claims remain pending for later game actions; reversals never free old quota.
- Owner/admin audited voids reverse all paid bonuses, including welcome-only
  pending claims. Original ledger rows/assignments cannot be deleted or changed.
- Migration 0013 preserves legacy referrals sharing the same inviter and their
  points; no old migration was edited. Apply before the matching API/worker.
- Isolated PGlite tests cover API authorization, tampering, replay/races, rollback
  on failed audit, quota rollover and legacy migration. PGlite serializes local
  transactions; no real Postgres load test is claimed.
- Browser checks use the real Discord SDK against a synthetic parent and a mocked
  Telegram bridge, plus browser preview, maintenance, 44px controls, Copy/Share,
  manual code entry and native back. Real platform acceptance remains post-deploy
  operator work; Codex performs no merge, deployment or real database changes.

Game/claim user locks use NO KEY UPDATE to serialize actions without blocking
FK KEY SHARE checks from concurrent referral credits or reversals. The inviter
code row serializes the daily quota; a KEY SHARE lock on the inviter user orders
qualification against administrative suspension (which takes FOR UPDATE).
These modes follow [PostgreSQL's lock compatibility documentation](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS).

Discord URLs and SDK sharing follow the official
[growth and referrals guide](https://github.com/discord/discord-api-docs/blob/main/developers/activities/development-guides/growth-and-referrals.mdx).
The API generates platform links from public DISCORD_CLIENT_ID and
TELEGRAM_BOT_USERNAME; missing configuration keeps code sharing available.
No dependency versions, other game scoring or private question content changed.

## Final local checks

- Lint, format check, typecheck and workspace build: passed.
- Full unit suite: 553 passed; 8 POSIX-only tests skipped on Windows (Linux CI runs them).
- Latest referral/migration/adapter subset after the final lock changes: 46 passed.
- Full browser suite: 83 passed, including Discord, Telegram and browser simulations.
- Review captures: 390px/1440px with 3/30 assets, mobile bottom navigation clearance,
  owner operations and support read-only.
