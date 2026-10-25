# Game Rules

Play a few minutes a day, earn points, climb the leaderboard. Stock price references come from the xStocks public API; Fluxion pools on Mantle provide cross-checks. No wallet, no deposit, no purchase needed.

> For entertainment and education only. Not financial advice. Points have no cash value and cannot be bought, sold or transferred.

The values below are implemented in `packages/game-core/src/config.ts`. If you change one, change both in the same pull request.

## The day

A game day runs from 00:00 to 23:59 UTC. Daily games reset at 00:00 UTC. The stocks: Apple (AAPL), Microsoft (MSFT), Alphabet (GOOGL), Amazon (AMZN), Meta (META), Nvidia (NVDA) and Tesla (TSLA).

## Season 1 games

| Game            | How it works                                                                                                                                                                                    | Points                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Daily Check-in  | Open the app and tap Check in. You get the Stock of the Day: its live price, 24h change and one fact about the company.                                                                         | 10 per day. Streak bonus: +50 on day 7, +300 on day 30                   |
| Daily Quiz      | Three multiple-choice questions on tokenized stocks, RWA, Mantle and Fluxion. 30 seconds per question, one attempt per day.                                                                     | 20 per correct answer, +15 if all three are right (max 75)               |
| Higher or Lower | Predict whether one server-chosen stock will rise or fall in the next 15 minutes. First wrong pick ends the run; ten correct complete it. Three runs may start per UTC day and run in parallel. | 5 per correct pick, up to 50 per run; at most 3 runs started per day     |
| Invite friends  | Share your code before your friend plays. Your friend gets +20 at first check-in; you get +50 when they earn 200 game points.                                                                   | 50 per qualified friend; 20 welcome bonus; 50 qualifications per UTC day |

Missing a day resets your check-in streak to zero.

### Daily Quiz alternatives

Alternative order is personal to each player, day and question and remains stable
when reopening the quiz. A correct answer earns the same points in any displayed
position. The daily question selection, server deadline and one-attempt limit
are unchanged. Existing daily sets keep their original order during the rollout;
the shuffled presentation applies to newly frozen sets.

### Higher or Lower: future prices

Choose Up or Down for one randomly assigned eligible stock. The server locks
your pick on receipt. The start price is the first valid primary (`xstocks`)
sample strictly after that lock; the end is the first valid primary sample at
or after start + 15 minutes, within 120 seconds. These two stored samples replace
the TWAP for this game. A rise wins Up; a fall wins Down. Persisted decimal prices
are compared exactly: any nonzero movement counts. Equality means "No change —
pick again", with no points and no loss. Fluxion pools never decide results.

One pending pick per run, up to three active runs. Each correct pick gives +5;
the first wrong pick ends that run; ten correct complete it. The daily limit counts
runs started, not rounds settled. Pending predictions survive the UTC day change.
An idle run expires 24 hours after its last settlement, keeping points. Before
the first settlement, that clock starts at creation. Pending picks do not expire
as idle runs. The worker settles and awards once; leaving the app is safe.

### Closed markets, interruptions and voids

When the market is closed without a trading halt, you can lock a prediction for
the next session. "Waiting for market open" shows the scheduled opening in UTC.
After the source confirms reopening, the first valid primary sample at or after
that boundary starts the 15 minutes. This can involve a weekend wait; a scheduled
time alone never confirms that trading resumed.

Paused, stale, missing, divergent and jump-limited observations cannot supply
start/end prices. A recorded trading halt between those prices voids the round.
Missing start data retry for up to six hours from lock. Closed-market opening
delays or missing metadata retry for six hours from the scheduled boundary.
Missing end data retry for six hours from the original target, looking only in
its original 120-second sample window. After the deadline: "Void — no data";
no points, the run continues. A halted asset cannot accept a new pick.

Old retrospective rounds and awards are preserved as Classic data, with active
Classic runs ended at migration. T25 last-session comparisons remain display
data only. The closed-market price panel keeps the last primary price and may
show "On-chain · Fluxion pool" with its sample time, for information only.

## Coming later in Season 1

| Game                     | How it works                                                                                                                  | Points                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Weekly Fantasy Portfolio | Pick 3 stocks for the week and make one your captain (counts double). Your score is their average % change, Monday to Friday. | Top 10% of lineups earn a bonus |

## Leaderboards

- Season 1 dates are provisional and will be confirmed with Mantle. Staging starts
  at `2026-10-16T00:00:00Z`; `endsAt: null` means the season is ongoing and its
  leaderboard counts points from that start through the current time. A configured
  end instant closes the season and excludes points at or after that instant.
  Dates live in the database and owners/admins manage them in the admin hub with
  an audited reason. Only owners can change past start dates. The latest started
  season supplies the ranking window; ended seasons stay visible until the next
  begins. Windows cannot overlap. The points ledger is never rewritten when
  a season window changes.
- Daily, weekly and season leaderboards, on Discord and Telegram. Weeks run Monday to Sunday (UTC).
- Ties go to the player who reached the score first.
- The season leaderboard decides Season 1 rewards. Mods review the top of the leaderboard before any reward is paid.

## Fair play

Paused games display "Paused for maintenance". They do not accept new actions
or consume new daily attempts/runs. Existing attempts, quiz timers and idle run
expiry keep their original clocks. Locked predictions keep settling normally;
maintenance does not cancel choices or alter their price windows/points.
Manual ticker pauses keep last prices visible and prevent paused observations
from supplying new game prices. Removing a manual override does not bypass
automatic price health checks.

- One account per person. Duplicate or fake accounts lose all points and rewards.
- Discord accounts younger than 30 days can play, but their points do not count for rewards.
- You must be a member of the official Mantle Discord server or Telegram group to qualify for rewards.
- Bots, scripts and exploited bugs lead to a ban. Found a bug? Report it to a mod and earn a thank-you, not a ban.
- Points can be removed if an award turns out to be wrong, with a note in your history.

## Reward registration and season review

Profile optionally accepts a Bybit UID and/or Mantle address without connecting a
wallet. Players review and confirm their own details; registration does not verify
ownership or promise a reward. Changes have a masked history. Payout review can
lock destinations; players cannot edit until every season lock is released.

Rewards are reviewed by mods and paid manually according to the campaign terms.
After a season ends, owners/admins explicitly freeze its top N using the same
leaderboard score and first-attainment tie rules. The snapshot preserves names,
platform IDs, window and prizes; later ledger/date/profile changes do not rewrite
it. Approving/delivering/voiding prizes never changes game points. Eligibility
still requires manual review until T18 is implemented. Destinations are current
at export, so operators lock them during delivery review.

Quiz maintenance preserves the original 30-second deadline. Replies are blocked
while paused; a reply after resumption may time out on that original deadline.
T31 verifies/documents this existing policy without changing points or timers.

## Invite friends

Your friend gets +20 on their first check-in. You get +50 when they earn 200
points from games. There is no percentage or recurring commission.

Register one invite before playing and within 24 hours of account creation,
through a platform link or the manual code field. No self-invites, reassignment,
or repeat welcome bonuses. Only check-in/streak, completed quiz and Higher or
Lower points count toward 200; referral and administrative points are excluded.
A friend who reaches 200 before checking in can receive the welcome bonus later.

An inviter can qualify up to 50 friends per UTC day. Capped claims remain pending
until a later game action can retry. A maintenance pause defers claims/bonuses;
it does not pause the other games. Voiding an invite reverses paid bonuses with
new ledger corrections and a required staff note, never deletes history, and
never frees previously used daily qualification quota. These are points only;
registration does not promise a monetary reward. No multi-account detection is
claimed by this feature.
