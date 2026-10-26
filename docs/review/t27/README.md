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
repository. A course needs primary snapshots in all ten time buckets of its last
24 hours; incomplete assets are skipped, with no pool or invented-price fallback.

Hadukem should verify real Discord/Telegram play, held-input release, results,
points, rankings and admin maintenance/void controls on the deployed version.
This PR performs no merge, deployment or real database operation.
