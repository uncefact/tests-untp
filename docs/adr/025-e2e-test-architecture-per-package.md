# ADR: E2E test architecture per package with parameterizable target

## Status

accepted

## Context

E2E tests run at four different points in the lifecycle (separate ADR on testing stages): PR-level local containerized, post-dev-deploy against deployed dev, post-staging-deploy against deployed staging, post-prod-deploy smoke against prod. Each stage exercises the apps in a different environment.

The architectural questions:

- Where do E2E tests live in the repository?
- How are tests parameterized to target different environments?
- How are cross-package or cross-app integration tests handled (if at all)?
- What testing framework is used?

## Decision

**E2E tests live per app in `packages/<package>/e2e/`.**

- `packages/reference-implementation/e2e/` — tests that exercise the reference implementation app.
- `packages/playground/e2e/` — tests that exercise the playground app.
- Library packages (`services`, `test-suite`, `components`) have unit and integration tests only — no E2E tests.

**Cypress** is the testing framework. The repository already uses Cypress, and it integrates well with both local containerized stacks (Stage A) and deployed environments (Stages B/C).

**E2E suites are parameterizable by target URL.** Tests read a base URL from an environment variable:

```typescript
const baseUrl = Cypress.env('UNTP_E2E_BASE_URL') || 'http://localhost:3000';
```

Same tests run against:
- `http://localhost:<port>` for Stage A (local Docker Compose stack).
- `https://dev.untp.example.org` for Stage B.
- `https://staging.untp.example.org` for Stage C.

**Stage D smoke tests are a separate subset**, not the full E2E suite. They live in `packages/<package>/e2e/smoke/` (or equivalent) and are explicitly designed to be read-only and idempotent, suitable for running against prod.

**Test invariants:**

- **Idempotent.** Running the suite twice in sequence produces the same result. No accumulating state that affects subsequent runs.
- **Parallel-safe.** Two concurrent runs against the same target environment don't conflict (e.g., use unique IDs per run, scoped test data).
- **No hardcoded URLs.** All URLs derived from configuration.
- **Self-cleanup or accept persistence.** Either tests clean up after themselves or document that the environment accumulates test data (and how it's reset).

**Cross-package integration tests are deferred.** If future need arises for tests that exercise reference-implementation and playground together (or other cross-app scenarios), a dedicated `packages/e2e-integration/` package would be added. For the initial migration, foundation-first: per-app E2E only.

We chose this design because per-app E2E maps cleanly to the per-package matrix in PR checks (separate ADR), tests are parameterizable so the same suite covers all four stages, and the deferred cross-package tests avoid premature complexity.

## Adoption notes

The walking-skeleton implementation of this ADR ships in two stages, both retaining the same per-app E2E layout.

**Stage 1, playground (#579):**

- The playground Cypress specs and the playground-specific support commands moved from the root `e2e/` workspace to `packages/untp-playground/e2e/`.
- `packages/untp-playground/e2e/cypress.config.ts` is a minimal config. It accepts `E2E_PLAYGROUND_BASE_URL` (process env, set by CI) and exposes it as `PLAYGROUND_BASE_URL` for spec consumption via `Cypress.env('PLAYGROUND_BASE_URL')`.
- The CI `e2e-playground` job invokes Cypress against the playground stack started via `docker compose --profile playground`.

**Stage 2, reference implementation (#582):**

- The reference-implementation Cypress specs, fixtures, support helpers, and the heavier `cypress.config.ts` (DB seed and cleanup, IDR clearing, UNTP conformance runner) moved from the root `e2e/` workspace to `packages/reference-implementation/e2e/`.
- The root `e2e/` workspace is removed; both apps now own their tests under `packages/<app>/e2e/`.
- The `e2e-ri` CI job becomes a matrix over `[open, closed]` tenant modes, with each entry consuming the `e2e:open` / `e2e:closed` workspace scripts in `packages/reference-implementation/e2e/`.
- A new `build-e2e-images` upstream CI job pre-builds both `app:e2e` and `untp-playground:e2e` images using `docker buildx` with the GHA cache backend (`cache_to: type=gha,mode=max`). Downstream E2E jobs (`e2e-ri` open, `e2e-ri` closed, `e2e-playground`) pull from the same cache via `cache_from: type=gha`, so the matrix sees a cache hit instead of three independent rebuilds.

## Consequences

**What becomes easier:**
- Each app's tests live with the app's code, owned by the app's contributors.
- Same Cypress suite covers four testing stages, with only target URL differing.
- Per-app E2E maps to per-runner matrix in Stage A, avoiding resource contention.
- Adding a new test is a local concern in the relevant app's `e2e/` directory.

**What becomes harder:**
- Cross-app integration scenarios cannot be tested initially. If reference-implementation and playground need to interact in a tested way, a future `e2e-integration` package is needed.
- Test idempotency and parallel-safety require contributor discipline. The first violations (flaky tests, state leakage between runs) surface only when concurrency hits.
- Stage D smoke tests being a subset of the same suite requires clear marking (tag-based, directory-based, or annotation-based) so the smoke run doesn't accidentally include mutating tests.
- Local Cypress setup per app requires each app's Docker Compose to expose appropriate ports and seed data.

## Alternatives Considered

### Single `e2e/` workspace package at the monorepo root

Rejected because it doesn't map cleanly to the per-package matrix in PR checks. Turbo's affected-package filtering works most cleanly when each app's tests are in its own package. A central `e2e` package would either run for every change (defeating the filter) or require complex sub-suite selection logic.

### E2E tests inside `test-suite` package

Rejected because `test-suite` has a different purpose — it's the UNTP conformance test suite consumed by external implementers. Conflating internal app E2E with the external conformance suite would create confusion about what `test-suite` is.

### Use Playwright instead of Cypress

Considered. Playwright has some advantages (multi-browser support, better parallel execution). Rejected because Cypress is already in the repository and migrating is unrelated risk during this restructure. If a future Playwright migration is desired, it can happen separately.

### Skip Stage A E2E (rely on unit/integration tests for PR-level coverage)

Rejected because E2E catches integration bugs that unit tests miss. The matrix architecture makes Stage A E2E tractable; skipping it would hide bugs until Stage B or later.

### Cross-app integration tests as part of the initial migration

Rejected because the foundation is large enough already. Cross-app testing can be added later when there's concrete need; deferring keeps the migration scope manageable.

## References

- ADR: Four-stage testing strategy (A through D)
- ADR: PR checks workflow with static matrix and combined filter
- ADR: Prod deploy and rollback mechanism (Stage D smoke tests)
- ADR 029: Test layer taxonomy and decision rules (defines what belongs in E2E vs lower layers; this ADR defines where E2E tests live)
- Cypress documentation
