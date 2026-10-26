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
The build-only heap argument defaults to 512MiB; temporary V8 allocations use a
4MiB semispace and size-oriented compilation. Service runtime limits are unchanged.

The first Linux probe still exceeded the target (API 444.16MiB, worker 456.90MiB),
despite the bounded image passing. The remaining broad viem imports are narrowed:
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
is gated below 400 MB per sequential compiler. The measured report is recorded
here after CI execution; local Windows diagnostics are not substituted for Linux.

The separate uncached image build uses a dedicated BuildKit container capped at
1GiB RAM and 3GiB RAM+swap, verifies effective limits, and ensures the runner has
at least 2GiB swap. Existing container isolation/PGlite smoke checks remain.
See DEPLOY.md for reproduction and the emergency heap build-arg.

Local validation: 634 unit/integration tests passed, eight POSIX-only checks skip
on Windows. Full typecheck and strict production typechecks passed. No new library
version was introduced: game-core declares the existing Zod version for its
server-only loader. No `.env`, secret or private quiz content was accessed.
