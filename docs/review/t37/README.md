# T37 — Flyer v3 review

All captures use synthetic prices, identities, scores and host bridges. No real
database, deployed service or private quiz bank was used.

## Visual evidence

- `start-{telegram,discord}-{360,390,1440}.png`: scene lobby, official Fluxion
  white mark, record/daily-point cards and large Play button.
- `play-{telegram,discord}-{360,390,1440}.png`: full-height canonical world,
  rendering-only crop on narrow phones and side letterbox on desktop; no app
  header/bottom navigation/card or page scroll.
- `result-{telegram,discord}-{360,390,1440}.png`: score/buildings/coins, earned
  points, accessible frozen charts, gainers/decliners and replay/navigation.
- `flyer-v3-flight.webm`: short synthetic Telegram flight, including result.

Viewport sizes: 360×640, 390×844 and 1440×900. Both host matrices cover catalogs
of 3 and 30 stocks; the Discord fixture uses an actual SDK iframe handshake.
Browser preview cannot start a session or submit points.

## Decisions and compatibility

- V3 records ordered flap ticks. Original v1/v2 hold physics/replays remain
  available for already-open sessions. Coins are computed exclusively by shared
  integer simulation and server replay: score = buildings + collected coins.
- One to three optional coins per ten-building group, not per stock. Difficulty
  depends on buildings, independently of coin count. Daily-best delta and the
  50-point campaign cap are unchanged; verified Flyer awards count for referrals.
- End flight or loss of focus/visibility **finishes**, rather than pauses, the
  flight. The server still validates ±15% elapsed time. Exiting before the first
  flap cancels without points. Failed verification never awards client scores.
- Migration `0016_flyer-v3` adds separate immutable courses/results, preserving
  historical courses, sessions and ledger rows. Apply it through the operator's
  normal release process; Codex did not run it against a real database. For a
  rolling release, ship the compatible web client before enabling new API starts.
- Charts contain ten frozen primary samples, downsampled in SQL and stored once
  per day. Missing retained history shows an explicit placeholder; it does not
  invent a chart or disable an otherwise valid summary-based course.
- PNGs are the unmodified transparent white/black marks supplied by Hadukem;
  only the white mark is used for v3. Vector body/visor/beak/wings are cosmetic.
  The circular physics hitbox stays at radius 12 canonical pixels.

## Verification limits

Local verification: 655 tests passed; 8 POSIX-only tests skipped on Windows.
Lint, formatting, full typecheck and build passed. The new 16-scenario Flyer v3
suite and six home/navigation scenarios passed; existing v1/v2 browser/replay
regressions remain covered. GitHub CI repeats the complete browser suite and
Linux checks before merge.

`performance.json` records the full 468-stock v3 course at 390×844 with 4× CPU
throttling over 16 seconds. This measures mean simulation/drawing work against a
16.67ms frame budget, rather than claiming physical-device FPS.

Automated host tests mock Telegram fullscreen/swipes/haptics and Discord commands.
Frame measurements are desktop Chromium emulation, not a physical phone FPS claim.
Real-device fit, sound, safe areas and difficulty calibration remain manual review
checks before deployment. No merge or deployment is performed by Codex.
