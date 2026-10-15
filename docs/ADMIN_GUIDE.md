# Admin and Mod Guide

Mods keep the game fair and the community informed; admins own content, points and payouts. Every action taken in the admin panel is logged with who did it and why.

## Roles and permissions

| Action                                       | Mod | Admin |
| -------------------------------------------- | --- | ----- |
| View any player's profile and point history  | Yes | Yes   |
| Flag a player for review                     | Yes | Yes   |
| Answer questions in support channels         | Yes | Yes   |
| Add, edit and schedule quiz questions        | No  | Yes   |
| Adjust points (always with a written reason) | No  | Yes   |
| Suspend or ban a player                      | No  | Yes   |
| Pause or resume price-based games            | No  | Yes   |
| Export the leaderboard for rewards           | No  | Yes   |

Admin access is limited to Hadukem plus at most two people named by the Mantle team.

## Community setup

**Discord**

- #stock-arena: where players launch the Activity and use /arena and /rank.
- #arena-leaderboard: read-only; the bot posts the daily top 10 at 00:05 UTC.
- #stock-arena-support: questions and bug reports, answered by mods.
- Optional roles the bot can grant: Arena Player (first check-in) and Top Trader of the Week (weekly top 10).

**Telegram**

- Pin the bot link and the Player Guide in the Mantle group.
- The bot posts the daily top 10 to the group at 00:05 UTC, if the Mantle admins allow it.

## Daily routine (about 10 minutes)

- [ ] Check the status banner in the admin panel: prices live, jobs ran, no errors.
- [ ] Read new flags and support messages; answer or escalate within 24 hours.
- [ ] Look at the daily top 20 for anything odd (see signals below).
- [ ] Confirm tomorrow's quiz questions are scheduled.

## Weekly routine

- [ ] Review the weekly top 50 before roles or bonuses are granted.
- [ ] Post the weekly recap: winners, best streak, a fun stat.
- [ ] Retire quiz questions players reported as unclear; add replacements.

## Abuse signals and what to do

| Signal                                                                             | Action                                                                  |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Many new accounts arriving through one invite link in a short time                 | Flag the inviter; an admin freezes those referral points pending review |
| Perfect quiz scores answered in under 2 seconds, day after day                     | Flag for review; compare with that player's other games                 |
| Several accounts with near-identical names or avatars, playing at the same minutes | Flag all of them; an admin decides together                             |
| A player sharing quiz answers publicly                                             | Remove the message, warn once, then flag                                |
| Someone DMing players about prizes or wallets                                      | Ban from the server or group and post a scam warning                    |

Mods flag; admins decide. A ban removes all season points and is announced only to the player, never publicly by name.

## Incident playbook

| Incident                                    | First move                                                            | Who   |
| ------------------------------------------- | --------------------------------------------------------------------- | ----- |
| Prices show Paused for more than 30 minutes | Post a short notice in #stock-arena; check-in and quiz still work     | Mod   |
| A price looks wrong in the game             | Pause price-based games in the admin panel and alert the Fluxion team | Admin |
| A wrong quiz answer key                     | Fix the question; the system re-scores that day's quiz automatically  | Admin |
| The app is down on one platform             | Announce on both platforms; protect streaks for the outage day        | Admin |
| A bug that gives free points                | Pause the affected game, then remove the bad points with a reason     | Admin |

## Rewards and payouts

1. At season end, the admin exports the leaderboard from the admin panel.
2. Mods and admins review the top of the list together and remove disqualified players.
3. The Mantle team approves the final list and pays prizes outside the game.
4. Winners are announced in both communities. Prizes are never sent before the announcement.

## Ready-to-post messages

**Launch**

> Stock Arena is live! Check in daily, take the quiz and play Higher or Lower with live xStock prices from Fluxion. Free to play, no wallet needed. Start in #stock-arena or with our Telegram bot.

**Prices paused**

> Heads up: price-based games are paused while we check price data. Check-in and the Daily Quiz work as usual. We will post here when everything is back.

**Scam warning**

> Reminder: the Stock Arena team will never DM you first, and never asks for a wallet, seed phrase or payment. Report anyone who does.
