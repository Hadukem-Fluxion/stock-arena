# T27 — mStocks Flyer review

All players, sessions, chart prices and staff records in these captures are
synthetic. No production database, platform credentials or private quiz bank was
used. The supplied official Fluxion symbol is copied unchanged to the public brand
directory. No dependency version changed.

Local validation: lint, format check, TypeScript and workspace builds passed;
590 unit/integration tests passed (eight POSIX-only checks skip on Windows),
and all 94 browser tests passed. The emulated phone recorded approximately
0.74 ms mean simulation/drawing work per frame against a 16.67 ms budget.

## Visual evidence

- `flyer-390-3.png` / `flyer-result-390-3.png`: mobile flight and verified result.
- `flyer-390-30.png` / `flyer-result-390-30.png`: mobile with a 30-asset catalog.
- `flyer-1440-3.png` / `flyer-result-1440-3.png`: desktop flight and result.
- `flyer-1440-30.png` / `flyer-result-1440-30.png`: desktop with 30 assets.
- `flyer-landscape.png`: landscape canvas and outside-canvas release.
- `flyer-admin-owner.png` / `flyer-admin-support.png`: permission-aware session review.
- `flyer-flight.webm`: short held-input flight through a synthetic price course.
- `performance.json`: 16-second Chromium phone emulation, 390×844, DPR 2,
  fourfold CPU slowdown and 30 assets. Measures mean simulation/drawing work
  against the 16.67 ms frame budget; this is not a physical-phone certification
  or a measurement of end-to-end platform frame rate.

Browser tests exercise the actual shared simulation and replay their submitted
logs, with synthetic API/platform adapters. They cover Discord SDK framing,
Telegram, browser preview, Space/touch/pointer release, landscape, navigation,
maintenance and the shell's 15-second refresh during flight. A local PGlite suite
separately checks real API transactions, tampered/time-inconsistent logs, expiry,
reuse, quota, daily best deltas/cap, UTC rollover, restart, ledger failure rollback,
referral qualification and audited role-restricted voids.

## Operator acceptance after review and merge

Apply migration `0014` before the matching API, then configure the two private
API operational limits listed in `docs/DEPLOY.md`. No values are included in this
repository. A course needs at least ten distinct primary observations, bounded
by one configured polling day's sample count. Closed-market gaps consume no
samples; incomplete assets are skipped, with no pool or invented-price fallback.

Hadukem should verify real Discord/Telegram play, held-input release, results,
points, rankings and admin maintenance/void controls on the deployed version.
This PR performs no merge, deployment or real database operation.

## Closed-market follow-up

PR #35 is integrated. The follow-up changes only course history selection and its
label; scoring, replay, input, limits and existing frozen sessions stay compatible.
There is no new migration. Each ticker uses its latest N distinct primary
observations at/before server now, N = ceil(24h / configured poll interval), with
ntile(10) by position and preserved first/last prices. This approved sample-count
alternative spans closed-market gaps and remains usable after hourly retention;
it does not require 24 consecutive wall-clock hours after reopening. Fewer than
ten observations skips the ticker. History ending more than the existing
120-second freshness tolerance ago displays "Last session".

New synthetic API cases cover Friday-to-Sunday history after retention, a holiday,
different last observations per ticker, insufficient data, ignored pools/future
samples and intraday normalization. The urgent scheduled 26/10 correction also
covers Saturday, Monday 01:00 UTC with Friday + one hour of new data, a midweek
holiday, deduplicated timestamps and the one-day sample budget. Browser evidence:

- `flyer-last-session-390.png` and `flyer-last-session-result-390.png`.
- `flyer-last-session-1440.png` and `flyer-last-session-result-1440.png`.
- `flyer-getting-charts-390.png` and `flyer-getting-charts-1440.png`: friendly
  preparation state; the test retries the start request successfully and checks
  that the Home card remains usable.

Scheduled correction validation: 597 unit/integration tests passed (eight
POSIX-only checks skip on Windows), all 98 browser tests passed, plus lint,
format check, TypeScript and workspace build. Real deployment/database operations
remain outside this delivery.
