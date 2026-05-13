# ADR: PR checks workflow with static matrix and combined Turbo filter

- **Date:** 2026-05-12
- **Status:** accepted

## Context

The current PR check workflow (`.github/workflows/build_test.yml`) runs install, build, test, and the root `e2e/` Cypress suite in a single GitHub Actions job. Specific concerns:

- **Resource pressure on a single runner.** The reference-implementation has a multi-service Docker Compose stack. Running everything in the same runner causes resource contention and slow E2E.
- **No affected-package filtering.** A PR that changes one line in one package, for example the recently added `utils` package, runs the full QA suite for every package and the full E2E suite.
- **Lack of parallelism.** Single-job execution cannot take advantage of multiple runners.

The fix needs to handle three concerns:

1. Each package's QA can run on its own runner, bounding resource pressure per package.
2. Unaffected packages exit fast rather than running full QA.
3. The required-status-check pattern for branch protection remains simple and stable.

## Decision

We split PR checks into three concerns running as parallel jobs:

**1. `quality` (single job, repo-wide):**

- `yarn format:check` (Prettier check mode)
- `yarn lint:check` (ESLint check mode)
- Fast, covers root config files and all package code with one Prettier/ESLint invocation each.

**2. `qa` (matrix job, per-package):**

- A **static matrix** lists all real workspace packages explicitly: `[services, components, reference-implementation, untp-playground, untp-test-suite, untp-test-suite-mocha, vc-test-suite, utils]`.
- Each matrix entry runs on its own runner.
- Each matrix job runs build and test via Turborepo with a **combined filter**: `yarn turbo run <task> --filter=${{ matrix.package }}...[origin/next]`.
- The combined filter means each job runs full QA for its package **only if** that package or something it depends on changed since `next`. Otherwise the job exits in a couple of minutes (runner startup and dep install).

**3. `e2e` (single job, conditional on reference-implementation changes):**

- Runs the existing root `e2e/` Cypress suite against the reference-implementation Docker Compose stack.
- Triggered when `reference-implementation` or its transitive deps change, gated by the same Turbo filter pattern.

Branch protection requires the new check names: `quality`, `e2e`, and one entry per matrix package. All checks are stable in name (the matrix is static) so branch protection configuration is straightforward.

Concurrency: `concurrency: { group: pr-${{ github.event.pull_request.number }}, cancel-in-progress: true }`. New pushes to a PR cancel older runs for that PR; PRs do not compete with each other.

We chose this design because it solves the resource-pressure problem (one runner per package) while keeping the required-status-check configuration simple (static matrix = stable check names). The combined filter syntax means we get most of the benefit of dynamic affected-package detection without the complexity of computing affected sets upfront, and we eliminate the risk of false negatives in affected-detection logic.

## Adoption notes

This ADR records the target design. The initial implementation lands as part of the "Bundle B" CI restructure with these scoped deviations from the broader architecture target:

- **Yarn workspaces, not pnpm.** Commands use `yarn turbo`; the planned pnpm migration will update them.
- **`[origin/next]` filter base, not `[origin/main]`.** The repo uses `next` as the integration branch; the planned trunk-based migration will move this to `main`.
- **Single root `e2e/` job instead of per-app E2E.** The planned per-package E2E architecture will split this into per-app matrix entries; today the single E2E job covers the existing root `e2e/` Cypress suite.
- **No `changeset-check` job yet.** Changesets are not adopted in this chunk; the job is planned for the Changesets adoption work.

## Consequences

**What becomes easier:**

- Single-package PRs complete in a fraction of the previous time. The `utils` change motivating this work no longer triggers a reference-implementation build or the full E2E suite.
- Multi-package PRs still parallelise across runners, bounded by the slowest single package.
- Branch protection setup is straightforward: list specific check names. No aggregator job needed.
- No false negatives. Turbo's filter semantics are well-tested. Either a package is affected and runs, or it is not and skips correctly.
- Adding a new package later means adding one matrix entry and one branch-protection rule. Minimal change.

**What becomes harder:**

- Multiple matrix runners per PR (plus quality and e2e) is more CI minutes than a single-runner pre-Turbo run. Mitigated by Turbo's local cache (cache hits exit in seconds) and by the time savings on actual development feedback. Further mitigated by remote cache when adopted.
- The matrix is hardcoded. Adding or removing a package requires updating both the matrix list and the branch-protection configuration.
- Test isolation between matrix runners requires each app's stack to spin up from scratch. Slower first run than a shared-stack design, faster overall.

## Alternatives Considered

### Single runner, sequential QA per package

Rejected. This is the current state. Resource contention on E2E and lack of parallelism cause the present pain.

### Dynamic matrix (detect-affected job computes matrix from Turbo dry-run)

Considered. Rejected because:

1. False-negative risk: a bug in affected-detection logic could let broken code merge silently because its tests did not run. Static matrix cannot have this failure mode.
2. Required-status-check pattern is more complex (needs aggregator job with `if: always()` to provide a stable check name).
3. The win is small with Turbo's filter semantics. Unaffected packages exit in seconds anyway.
4. More moving parts to debug.

### Pure static matrix without `--filter=...[origin/next]`

Rejected because it runs full QA for every package on every PR, including E2E. This does not fix the time problem.

### Per-package E2E in a shared `e2e/` workspace package with sub-suites

Considered as the target state but deferred. Turbo's filter-by-package mechanism works most cleanly when each app's tests live in its own package. The single root E2E job is the staged compromise until the per-package E2E architecture lands.

## References

- ADR 007: Turborepo for build orchestration and caching
- ADR 008: Script naming convention
- ADR 025: E2E test architecture per package (will split the single `e2e` job into per-app matrix entries)
- ADR 030: pnpm workspaces as the package manager (will update commands to `pnpm turbo`)
- Planned: trunk-based development on `main` (will change filter base to `[origin/main]`)
