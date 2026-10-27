# T37 follow-up review

Synthetic Discord SDK and Telegram fixtures; no real users, prices or database.

- `start-{telegram,discord}-{360,390,1440}.png`: title area contains no stock
  buildings or company badges. Decorative lower buildings, bird and coins remain.
- `play-{telegram,discord}-{360,390,1440}.png`: the exit button is inside the
  visible canvas, including desktop letterboxing. New flyer-3b trails appear
  every 3–4 buildings, with 1–3 coins per trail.

Viewports: 360×640, 390×844 and 1440×900. The desktop fixtures use 30 stocks;
phone fixtures use 3. Pixel checks inspect the upper title background, and
geometry checks compare the actual button and canvas bounds. The mock server
replays the real flap log before returning a score.

## Compatibility

`flyer-3` coin coordinates/replay remain unchanged, covered by a recorded
synthetic fixture. Only `flyer-3b` selects the denser seeded schedule. Its flap
physics, collision radius, per-coin score, daily-best delta, 50-point cap and
referral reason remain unchanged. Nearby coin lookup is bounded in both versions.

Migration `0017_flyer-3b` only expands the JSON check to permit both protocols.
Migration tests preserve old frozen courses, open session references and ledger
rows; mutation/truncation protection remains active. The API keeps an already
frozen v3 day unchanged and starts v3b for the next new daily course.

Publish the compatible web client before the matching API, after the operator
applies the migration through the normal release process. No merge, deployment
or real database operation was performed by Codex.

Local checks: lint, format, full typecheck/build and 662 tests passed (8 POSIX-only
tests skipped on Windows). Six host/viewport e2e scenarios passed. CI repeats
all tests on Linux and the full browser suite before merge.
