# T36 — Daylight Market review

Reference: [Hadukem-approved artboard B](https://claude.ai/artifact/SnR71PUz9Amb8XUtNqmJgd).
A and C are not used. The scene is drawn with Canvas, without generated bitmap
art or changes to the supplied official Fluxion symbol. All players, game prices,
sessions and platform credentials in these review captures are synthetic.
The separately versioned constituent/availability/color inputs are public data.
No production database, quiz bank, local secret file or deployment was accessed.

## Evidence

- `daylight-{telegram,discord}-{390,1440}.png`: live course, company buildings,
  Fluxion bird, score, mute and HUD in each host/viewport.
- `result-{telegram,discord}-{390,1440}.png`: verified score and passed movers.
- `daylight-flight.webm`: short held-input flight, countdown and verified result.
- `performance.json`: 16-second 390×844/DPR2/fourfold CPU-throttled Edge Chromium
  emulation with 468 synthetic assets. Measures mean simulation/drawing work;
  does not certify FPS on a physical phone or real Discord/Telegram webviews.

The e2e matrix exercises 3 and 30 assets at 390/1440px in Telegram and the actual
Discord Embedded SDK inside a simulated parent frame. Submitted input logs use
the shared deterministic replay. It checks results, mute, Telegram-only haptics,
reduced-motion suppression and the shell refresh during a full-catalog flight.
Existing browser-preview, release-outside-canvas, legacy v1, maintenance, friendly
chart-retry, admin and other-game e2e coverage remains in the full suite.

## Implementation checks

628 unit/integration tests passed locally; eight POSIX-only checks skip on Windows
and are covered by Linux CI. All 108 browser tests, lint, format check, typecheck
and workspace build passed. The 468-stock phone emulation measured about 1.46ms
mean work per frame against a 16.67ms budget. New coverage includes the reproducible no-ETF
intersection, automatic color/fallback, bounded 468-stock polling/rate resets,
26h reference retention and closed-session carry, v2 deterministic replay/clamps,
immutable shared daily courses, compact per-session references, restart/retention,
daily rollover, single awards and open v1 compatibility. Migration 0015 is tested
from the old schema with preserved legacy sessions and ledger rows.

New development-only dependencies: `pngjs@7.0.0` and `@types/pngjs@6.0.5`, used by
the offline public-logo color generator/tests. Existing dependency versions are
unchanged. Neither PNG decoding nor remote pixel analysis runs in the worker or
browser. Core seven assets, their 15s polling, points, limits and referrals are
unchanged.

Offline regeneration is byte-identical. The redacted staged Gitleaks scan has no
secret findings after a narrow local path+line exception for generated public
`token: "0x…"` contract addresses. The unfiltered generic-key rule flags those
462 public contract declarations; every flagged line was verified against that
exact shape, without suppressing any other file or credential pattern.

## After review/merge — operator only

See DEPLOY.md for migration 0015, v1/v2-compatible web-before-API rollout, private
Flyer limits and extended collection knobs. A new catalog needs real 24h reference
history; only ready summaries join the next immutable UTC daily course. No data
means a friendly retry state, never invented prices or a consumed session. Once
v2 sessions exist, keep a protocol-compatible API when rolling back visuals.
Hadukem should verify real-device controls, sound/haptics, FPS, memory, rewards
and admin voids after the reviewed release. Codex performs no live operation.
