# T33 review — dedicated player screens

Reference: [approved six-screen mockup](https://claude.ai/artifact/JMjJR4PjDSx3LysupiTTdN), using the existing DESIGN.md tokens and official brand files.

All captures use synthetic accounts, companies, prices, rankings and invented quiz
content. No private quiz-bank content, credentials or live database operations
are involved. The test browser is Microsoft Edge on Windows. Widths are 390px
(844px viewport height) and 1440px (1000px viewport height).

| Screen                | Mobile                                                                         | Desktop                                                                          |
| --------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Home                  | [3 assets](home-mobile-3.png), [30 assets](home-mobile-30.png)                 | [3 assets](home-desktop-3.png), [30 assets](home-desktop-30.png)                 |
| Home end (viewport)   | [Mobile](home-end-mobile-3.png)                                                | [Desktop](home-end-desktop-3.png)                                                |
| Quiz                  | [3 assets](quiz-mobile-3.png), [30 assets](quiz-mobile-30.png)                 | [3 assets](quiz-desktop-3.png), [30 assets](quiz-desktop-30.png)                 |
| Higher or Lower       | [3 assets](higher-lower-mobile-3.png), [30 assets](higher-lower-mobile-30.png) | [3 assets](higher-lower-desktop-3.png), [30 assets](higher-lower-desktop-30.png) |
| Pending prediction    | [Mobile](prediction-pending-mobile-3.png)                                      | [Desktop](prediction-pending-desktop-3.png)                                      |
| Empty run tab         | [Mobile](empty-run-mobile-3.png)                                               | [Desktop](empty-run-desktop-3.png)                                               |
| Markets               | [3 assets](markets-mobile-3.png), [30 assets](markets-mobile-30.png)           | [3 assets](markets-desktop-3.png), [30 assets](markets-desktop-30.png)           |
| Legal dialog          | [Mobile](legal-mobile-3.png)                                                   | [Desktop](legal-desktop-3.png)                                                   |
| Flyer waiting screen  | [Mobile](flyer-soon-mobile-3.png)                                              | [Desktop](flyer-soon-desktop-3.png)                                              |
| Invite waiting screen | [Mobile](invite-soon-mobile-3.png)                                             | [Desktop](invite-soon-desktop-3.png)                                             |

Full-page captures retain the fixed header/navigation at their actual viewport
positions. The page scrolls behind them, with bottom padding keeping the last
controls reachable. Browser tests also check clicking the footer legal control at
desktop widths, including when it requires scrolling.

Validation covers internal hash navigation/reload, preserved platform launch
parameters, Telegram native BackButton cleanup, real Discord SDK messages against
a synthetic parent frame, browser preview and production-browser restrictions.
Existing quiz/deadline, prediction/settlement display, maintenance, closed-market
pool display, ranking, authentication-error and retry tests remain in the suite.
Enabled controls have at least 44px targets; Up/Down are at least 64px high.
Keyboard run tabs and the approved text/background token combinations are checked
for focus behavior and contrast of at least 4.5:1.

Regenerate these captures with a web build, then:

```powershell
$env:PLAYWRIGHT_CHANNEL = "msedge"
$env:T33_REVIEW_CAPTURES = "1"
pnpm exec playwright test --config apps/web/playwright.config.ts home-screens.spec.ts
```

Flyer and Invite cards remain disabled with Soon; only their waiting screens are
present. T34 implements referrals; T27 implements and activates Flyer. T31 is integrated via PR #27; its RewardProfile, API/schema, operator guide and reward tests are preserved in this synchronized branch. No API/schema/rules or
dependency changes belong to T33. Real Discord/Telegram device validation follows
operator-approved deployment; simulated checks do not claim a live rollout.

Review follow-up: redundant run counters/date/progress removed from the active card; Start a run is rendered only inside the selected empty tab. Regression checks start three independent pending runs through their empty tabs. Home bottom clearance equals the fixed navigation height plus safe-area inset, measured at 0/24px simulated insets for both viewport widths and catalog sizes.
