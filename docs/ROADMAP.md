# Roadmap

The MVP runs on Discord and Telegram by Nov 20, closed beta follows, and public launch targets Dec 8 (pending the Mantle admin's confirmation of the campaign date). Nothing moves to the next phase until its gate is met.

| Phase                   | Dates (2026)    | Deliverables                                                                                                                                                                                  | Gate to move on                                              |
| ----------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0 · Setup               | Oct 19 – Oct 30 | Repo, CI and staging live; Discord app and Telegram bot registered; xStocks API prices for all Magnificent 7 stocks with five Fluxion pool cross-checks; clickable UI prototype; quiz bank v1 | Live prices on staging for all 7 stocks                      |
| 1 · MVP build           | Nov 2 – Nov 20  | Daily Check-in, Daily Quiz, Higher or Lower, leaderboards, referrals; same app as Discord Activity and Telegram Mini App; admin panel                                                         | Feature complete; demo to the Mantle admin and Fluxion leads |
| 2 · Closed beta         | Nov 23 – Dec 4  | Mods and invited players test; anti-abuse tuned; guides and FAQ published; load test                                                                                                          | Go / no-go: no open critical bugs, rewards approved          |
| 3 · Launch and Season 1 | From Dec 8      | Public launch on both platforms; Season 1 leaderboard and rewards; Weekly Fantasy Portfolio; account linking                                                                                  | —                                                            |
| 4 · Season 2            | January 2027    | Stock Card collection, Dividend Farm, more xStocks as they list on Fluxion                                                                                                                    | —                                                            |

Ohio status (24/10): PR #30 is integrated. Hadukem reports cutover complete at 9fe93dc: Lightsail API/worker/Caddy online, 13 migrations and 60 questions copied to Supabase mstocks-arenaUS, Telegram setup and Vercel API_ORIGIN configured. A small operator follow-up fixes SSH runtime directory creation, root/600 container commands, explicit APP_RELEASE through sudo, ACME smoke retries, Caddy formatting and container-only copy/setup instructions. Closed markets without primary history get a clear waiting-for-open message. Codex has not performed any live operation. Manual gameplay/admin acceptance and retirement of old resources remain separate operator checks.

## Who does what

Hosting priority (22/10/2026): prepare the API/worker move to Lightsail in
`chore-lightsail-hosting`, following Hadukem's report that Railway is blocked after
the 21/10 environment-variable incident. Artifacts and the operator guide are for
review and integrated via PR #24; instance, DNS, new provider credentials and live
smoke tests remain pending. Railway resources/configuration are retained.
T28, T29 and T30 are integrated via PRs #23, #25 and #26. T31 reward registration and frozen payout snapshots are integrated via PR #27; live migration/smoke tests pending. No real database change or deployment is claimed.

Current queue: **Ohio operator follow-up → T34 → T27**, one branch/PR per task, no merge/deploy/live database changes by Codex. T31 and its follow-up are integrated via PRs #27/#29; T33 is integrated via PR #28 with dedicated screens, the new home and Flyer/Invite cards disabled as Soon. Ohio PR #30 is integrated and the cutover reported complete by Hadukem. T34 replaces the historical T13 referral brief: first-check-in qualification and inviter/invitee rewards will be implemented in that task. T27 then activates hold-to-rise/release-to-fall Flyer with deterministic 60 Hz press/release replay, outside-canvas release and mobile gesture blocking, using screen 4 of the approved six-screen mockup. T14 remains superseded by T28–T30 and T21 cancelled into T26. These dependencies do not confirm launch dates.

T28's admin foundation is integrated via PR #23:
standalone Discord web login, revocable admin sessions, four Staff roles,
owner-managed team and append-only audit. It requires migration `0009`, the new
Discord web redirect, `ADMIN_WEB_ORIGIN` and `OWNER_DISCORD_ID` after merge.
Real owner login/revocation, admin operations/game controls and T31 reward smoke tests remain pending deployment. Official Season 1 dates still need Mantle
confirmation; the admin hub records audited date changes without rewriting points.

T31 includes optional Profile Bybit UID/Mantle destinations plus season prize bands,
a frozen top-N snapshot and audited approval/delivery/void/CSV operations. Migration
`0012_rewards` leaves points/audit history intact. Eligibility remains a manual
review until T18; no real payout or deployment is claimed.

The official Task Board is `docs/TASKS.md` and this file; there is no external
board. T26 is integrated via PR #20, including the requested offer-recovery and
percentage-format review fixes and successful reads with an unavailable offer
alongside pending predictions. Post-deploy smoke tests remain pending confirmation.
**T32 — settlement query optimization**
is a separate follow-up required before T19's load test: select only due work in
SQL, including start boundaries, end targets, void deadlines and idle run expiry.

| Who                    | Owns                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hadukem (project lead) | Scope and approvals, Mantle admin sign-off, Discord app and Telegram bot registration, hosting and database accounts, secrets, merging pull requests, launch call |
| Claude                 | Specs and task briefs, quiz bank, player-facing copy, guides, review of every pull request, UI prototype                                                          |
| Codex                  | Implementation of each brief with tests, migrations, CI, fixes from review                                                                                        |
| Fluxion team           | xStock pool addresses on Mantle, how to read pool prices, review of the oracle package                                                                            |
| Mods                   | Beta testing, community reports, leaderboard review before rewards, FAQ answers                                                                                   |

## How a task moves

T16a is integrated via PR #21: private Telegram /start, /help
and a Play menu through the existing API webhook, separately from #20.
Operator setup/deployment and a real Telegram smoke test remain pending confirmation. No new service;
opt-in reminders remain pending in T16. This does not start the admin tasks or
change PR #20's status.

1. Claude writes the brief in `docs/TASKS.md`.
2. Hadukem gives the brief to Codex, which opens a pull request on a branch named `t<id>-<short-name>`.
3. Claude reviews the diff against the brief; Codex fixes what the review finds.
4. Hadukem merges. Production deploys only from tagged releases.

## Open questions

- Confirm with Mantle which reward identifiers are accepted (Bybit UID, Mantle address or both) and how rewards are delivered. T31 keeps both optional until confirmed.

- Telegram adiado: a conta principal do Hadukem está temporariamente impedida de criar bots no BotFather. Opção pendente: criar o bot de teste na conta do Clube Cupim, com 2FA, e transferir a posse depois. Web e API já suportam Telegram; faltam o bot, o token na Railway e o link do Mini App.
- Final launch date with the Mantle admin (the original brief said around Sep 10).
- Which Magnificent 7 xStocks are live on Fluxion, and their pool addresses.
- Reward pool: prizes, who pays, how winners are paid.
- One global leaderboard, or one per platform until accounts can be linked.
- Final product name and art direction.
- Confirmar com o admin da Mantle se a campanha é de mStocks (Bybit), xStocks ou ambos; brand kit, aviso legal e endereços dos mStocks na Mantle.
- Datas oficiais da Season 1 (início/fim) — confirmar com a Mantle.

T31 follow-up on `t31-snapshot-lock`: freeze and destination lock are atomic and
audited; CSV flags changes after the frozen snapshot. Integrated via PR #29, no new
migration or live operation. Ohio hosting preparation precedes T34.
