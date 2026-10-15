# Game Rules

Play a few minutes a day, earn points, climb the leaderboard. Every game uses live prices of tokenized Magnificent 7 stocks (xStocks) from Fluxion on Mantle. No wallet, no deposit, no purchase needed.

> For entertainment and education only. Not financial advice. Points have no cash value and cannot be bought, sold or transferred.

The values below are implemented in `packages/game-core/src/config.ts`. If you change one, change both in the same pull request.

## The day

A game day runs from 00:00 to 23:59 UTC. Daily games reset at 00:00 UTC. The stocks: Apple (AAPL), Microsoft (MSFT), Alphabet (GOOGL), Amazon (AMZN), Meta (META), Nvidia (NVDA) and Tesla (TSLA).

## Season 1 games

| Game | How it works | Points |
| --- | --- | --- |
| Daily Check-in | Open the app and tap Check in. You get the Stock of the Day: its live price, 24h change and one fact about the company. | 10 per day. Streak bonus: +50 on day 7, +300 on day 30 |
| Daily Quiz | Three multiple-choice questions on tokenized stocks, RWA, Mantle and Fluxion. 30 seconds per question, one attempt per day. | 20 per correct answer, +15 if all three are right (max 75) |
| Higher or Lower | Two stocks appear. Pick the one with the bigger 24h price move. A run ends at your first wrong pick or after 10 correct picks. Up to 3 runs a day. | 5 per correct pick (max 150 a day) |
| Invite friends | Share your invite link. Your friend counts once they check in on 3 different days. | 50 per friend, up to 10 friends per season |

Missing a day resets your check-in streak to zero.

## Coming later in Season 1

| Game | How it works | Points |
| --- | --- | --- |
| Daily Call | Call Up or Down for three stocks before 20:00 UTC. Calls settle 24 hours later on Fluxion's 15-minute average price. Moves under 0.1% count as no result. | 30 per correct call |
| Weekly Fantasy Portfolio | Pick 3 stocks for the week and make one your captain (counts double). Your score is their average % change, Monday to Friday. | Top 10% of lineups earn a bonus |

## Leaderboards

- Daily, weekly and season leaderboards, on Discord and Telegram. Weeks run Monday to Sunday (UTC).
- Ties go to the player who reached the score first.
- The season leaderboard decides Season 1 rewards. Mods review the top of the leaderboard before any reward is paid.

## Fair play

- One account per person. Duplicate or fake accounts lose all points and rewards.
- Discord accounts younger than 30 days can play, but their points do not count for rewards.
- You must be a member of the official Mantle Discord server or Telegram group to qualify for rewards.
- Bots, scripts and exploited bugs lead to a ban. Found a bug? Report it to a mod and earn a thank-you, not a ban.
- Points can be removed if an award turns out to be wrong, with a note in your history.
