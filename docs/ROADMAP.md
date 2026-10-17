# Roadmap

The MVP runs on Discord and Telegram by Nov 20, closed beta follows, and public launch targets Dec 8 (pending the Mantle admin's confirmation of the campaign date). Nothing moves to the next phase until its gate is met.

| Phase                   | Dates (2026)    | Deliverables                                                                                                                                                                                  | Gate to move on                                              |
| ----------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0 · Setup               | Oct 19 – Oct 30 | Repo, CI and staging live; Discord app and Telegram bot registered; xStocks API prices for all Magnificent 7 stocks with five Fluxion pool cross-checks; clickable UI prototype; quiz bank v1 | Live prices on staging for all 7 stocks                      |
| 1 · MVP build           | Nov 2 – Nov 20  | Daily Check-in, Daily Quiz, Higher or Lower, leaderboards, referrals; same app as Discord Activity and Telegram Mini App; admin panel                                                         | Feature complete; demo to the Mantle admin and Fluxion leads |
| 2 · Closed beta         | Nov 23 – Dec 4  | Mods and invited players test; anti-abuse tuned; guides and FAQ published; load test                                                                                                          | Go / no-go: no open critical bugs, rewards approved          |
| 3 · Launch and Season 1 | From Dec 8      | Public launch on both platforms; Season 1 leaderboard and rewards; Daily Call; Weekly Fantasy Portfolio; account linking                                                                      | —                                                            |
| 4 · Season 2            | January 2027    | Stock Card collection, Dividend Farm, more xStocks as they list on Fluxion                                                                                                                    | —                                                            |

## Who does what

| Who                    | Owns                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hadukem (project lead) | Scope and approvals, Mantle admin sign-off, Discord app and Telegram bot registration, hosting and database accounts, secrets, merging pull requests, launch call |
| Claude                 | Specs and task briefs, quiz bank, player-facing copy, guides, review of every pull request, UI prototype                                                          |
| Codex                  | Implementation of each brief with tests, migrations, CI, fixes from review                                                                                        |
| Fluxion team           | xStock pool addresses on Mantle, how to read pool prices, review of the oracle package                                                                            |
| Mods                   | Beta testing, community reports, leaderboard review before rewards, FAQ answers                                                                                   |

## How a task moves

1. Claude writes the brief in `docs/TASKS.md`.
2. Hadukem gives the brief to Codex, which opens a pull request on a branch named `t<id>-<short-name>`.
3. Claude reviews the diff against the brief; Codex fixes what the review finds.
4. Hadukem merges. Production deploys only from tagged releases.

## Open questions

- Final launch date with the Mantle admin (the original brief said around Sep 10).
- Which Magnificent 7 xStocks are live on Fluxion, and their pool addresses.
- Reward pool: prizes, who pays, how winners are paid.
- One global leaderboard, or one per platform until accounts can be linked.
- Final product name and art direction.
- Confirmar com o admin da Mantle se a campanha é de mStocks (Bybit), xStocks ou ambos; brand kit, aviso legal e endereços dos mStocks na Mantle.
- Datas oficiais da Season 1 (início/fim) — confirmar com a Mantle.
