# T28 review captures

Synthetic users and audit events only; no production data or credentials.

The Playwright admin suite captures Overview, Team and Audit at 360 × 800 and
1440 × 1000 viewports. Images are full-page and use the shipped dark-theme tokens.
The mobile Team and Audit tables become stacked rows without page overflow.

Run on Windows with the installed Edge browser:

```powershell
$env:PLAYWRIGHT_CHANNEL = "msedge"
$env:ADMIN_REVIEW_CAPTURES = "1"
pnpm --filter @stock-arena/web build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/admin.spec.ts
```

`ADMIN_REVIEW_CAPTURES` only controls optional screenshot output in the test suite;
it is not an application environment setting. Normal CI stores its captures in
ignored test-results, without rewriting the committed review images.

Browser interactions use mocked API responses. API tests independently exercise
the real routes, authorization, CSRF, OAuth state, team transactions, revocation
and migrations through PGlite. Real Discord web sign-in remains a post-deploy check.
