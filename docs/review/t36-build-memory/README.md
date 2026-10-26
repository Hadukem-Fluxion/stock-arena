# T36 — Lightsail compiler memory follow-up

Production remains at healthy `551d55d`, as reported by Hadukem. This correction
does not deploy, merge or access a real database. It preserves the catalog contents
and version `sp500-xstocks-2026-10-26-1b08d904fbe7`, game rules and historical data.

The previous catalog already had a `ReferenceCatalog` annotation, so the fix does
not claim that adding the same annotation solves the failure. Its entire data
literal is replaced by JSON read through a Node-only subpath and validated by Zod.
It is absent from the browser/core barrel and from TypeScript's object inference.
The generator remains byte-reproducible offline.

Docker checks API and worker strictly and sequentially with production configs
excluding test files. Full source/test typechecking remains in the normal CI job.
The build-only heap argument defaults to 280MiB; temporary V8 allocations use a
1MiB semispace and size-oriented compilation. Service runtime limits are unchanged.
The smaller default is checked in the same 1GiB instance envelope, with explicit emergency
override still available through both Docker and Compose/deploy.sh.

Broad viem imports are also narrowed:
the API loads the same checksum function through a Zod-validated one-function
runtime contract; the oracle keeps only the pinned Mantle chain definition with
an explicit `Chain` annotation. Equivalence tests compare both with viem 2.57.7.
No checksum, pool address, chain behavior or game rule changes.

## Reproducible Linux measurements

`scripts/lightsail/measure-typecheck.mjs` measures each compiler directly with
`/usr/bin/time -v`, Node from `.nvmrc` and the Docker profile of each revision.
The `typecheck-memory` CI job uploads raw `.time`, compiler logs and before/after
JSON, and publishes peak RSS in the workflow summary. Old heap failures are
recorded as failures, never converted into successful typechecks. The new profile
is gated below 400 MB per sequential compiler. Local Windows diagnostics are not
substituted for Linux.

### Measured before/after

[Linux CI run](https://github.com/Hadukem-Fluxion/stock-arena/actions/runs/40376403244),
Node v24.19.0, GNU time peak RSS, sequential API then worker on the same runner:

| Compiler | Before RSS MB | After RSS MB | Before KiB | After KiB |
| -------- | ------------: | -----------: | ---------: | --------: |
| API      |        723.72 |   **391.70** |     706756 |    382520 |
| Worker   |        597.88 |   **389.77** |     583872 |    380636 |

MB is decimal (`KiB × 1024 / 1,000,000`); the gate is strictly below 400,000,000
bytes. Heap sizes are MiB and are not interchangeable with total process RSS.
Both measured compilers exited successfully; the unrestricted runner did not
reproduce Hadukem's server OOM, so no failed execution is presented as a success.

- Before: merged T36 `ff080ab78fb690b89f09fdd37a8a788ace2cb089`, original full
  `tsconfig.json` Docker commands and 512MiB heap. This is not production `551d55d`.
- After: `75eb7a58e435d7e758396120aebd831d975cecbe`, strict production configs,
  validated JSON, narrow dependency boundaries, 280MiB heap and 1MiB semispace.
  Complete source/test checking remains a separate CI requirement.
- Raw numeric reports: [before.json](before.json), [after.json](after.json).
  Original GNU time/compiler logs are in that run's `typecheck-memory` artifact.
  Subsequent documentation commits do not change the measured compiler profile.

The separate uncached image build uses a dedicated BuildKit container capped at
1GiB RAM and 3GiB RAM+swap, verifies effective limits, and ensures the runner has
at least 2GiB swap. Existing container isolation/PGlite smoke checks remain.
See DEPLOY.md for reproduction and the emergency heap build-arg.

Local validation: 634 unit/integration tests passed, eight POSIX-only checks skip
on Windows. Full typecheck and strict production typechecks passed. No new library
version was introduced: game-core declares the existing Zod version for its
server-only loader. No `.env`, secret or private quiz content was accessed.
