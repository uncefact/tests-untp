# ADR: Turborepo for build orchestration and caching

- **Date:** 2026-05-12
- **Status:** accepted

## Context

CI build and test times are a current pain point. The PR check workflow currently serialises build, lint, format, test, and the full root `e2e/` suite into a single GitHub Actions job. A trivial change to one package, for example the recently added `utils` package, still triggers a full reference-implementation build and the entire Cypress E2E run. Wall-clock times are routinely tens of minutes.

The repository has cross-package dependencies (`reference-implementation` and `untp-playground` depend on `services` and `components`; `untp-test-suite` depends on `services`; the new `utils` package is intended to be consumed by these and by external repositories). Yarn workspaces alone does not understand the dep graph for task execution, so it cannot answer "what packages are affected by this PR" or "what order should I build in to maximise parallelism".

We need:

- Dep-graph-aware task execution (build deps before dependents, parallelise where possible).
- Affected-package filtering: only run tasks for packages whose source changed transitively.
- Task result caching to skip work that has not changed.
- Remote caching to share cache across CI runs and contributors (planned follow-up).

## Decision

We adopt Turborepo for build orchestration and caching.

- A `turbo.json` at the repository root declares task pipelines, dep graphs (`dependsOn: ["^build"]`), and outputs per task.
- The PR check workflow uses `yarn turbo run <task>` in place of the previous single-job `yarn build` plus `lerna exec -- yarn jest`. Root scripts that still rely on `lerna exec` (`test`, `test:coverage`) and `lerna version` are unchanged in this chunk; converting them to Turbo is a follow-up.
- The combined filter syntax `--filter=${{ matrix.package }}...[origin/next]` is used in the PR-check workflow (see ADR 014): each matrix job runs tasks for its package only if that package or something it depends on changed since `next`. Unaffected packages exit in seconds.
- Local cache only for the initial adoption. Remote caching (Vercel free tier or self-hosted) is planned as a follow-up once the matrix is proven; the marginal value of remote cache is small until contributor coordination patterns warrant it.

We chose this because the affected-package filtering directly addresses the CI time problem, the dep-graph awareness reduces build ordering bugs, and Turborepo is the standard tool for this shape of monorepo with minimal cognitive overhead.

## Adoption notes

This ADR records the decision to adopt Turborepo. The initial implementation ships as part of the "Bundle B" CI restructure and runs on Yarn 1 workspaces against `[origin/next]`. A planned pnpm migration will update `yarn turbo` invocations to `pnpm turbo`, and a planned trunk-based migration will update the filter base from `[origin/next]` to `[origin/main]`. Remote cache adoption is similarly deferred.

## Consequences

**What becomes easier:**

- CI time drops dramatically for typical single-package PRs. Unaffected packages skip their tasks rather than running them.
- Local builds are fast on warm cache. Turbo replays cached output instantly when inputs have not changed.
- Build ordering bugs ("X built before Y but X depends on Y") are caught by the dep graph rather than discovered at runtime.
- Future: cross-contributor cache sharing via remote cache means a colleague's CI build can warm your local cache.

**What becomes harder:**

- One more tool in the stack with its own config, mental model, and failure modes.
- `turbo.json` must be kept correct. Wrong `dependsOn` or `outputs` declarations produce subtle bugs (incorrect cache invalidation, missing cache hits).
- Cache invalidation issues, when they happen, are confusing to debug. Standard advice ("delete `.turbo`, try again") helps but is a real cost.
- When the planned pnpm migration lands, `turbo.json` script references and workflow file commands need updating from `yarn` to `pnpm`. The cost is small (a handful of lines) and is the deliberately accepted trade-off of not bundling the pnpm migration into this chunk.

## Alternatives Considered

### No build orchestrator, keep `lerna exec -- yarn <task>`

Rejected because it does not address the CI time problem. Build times scale linearly with package count; affected-package filtering requires dep-graph awareness that Yarn workspaces does not provide.

### Nx instead of Turborepo

Considered. Nx is more powerful (generators, project graphs, code mods) but also more opinionated and heavier. For a monorepo of this size and complexity, Turborepo's smaller surface area is a better fit. Nx's advantages mostly accrue at larger scale.

### Custom build scripts

Rejected. Building a custom affected-package detection plus parallel task execution plus caching is significant work that reinvents Turborepo. The maintenance cost would dwarf Turborepo's adoption cost.

### Defer Turborepo until the planned pnpm migration completes

Rejected. The CI pain is real today, the pnpm migration is its own substantial chunk that is not yet scheduled, and the cost of adopting Turbo on yarn now and updating to pnpm later is bounded (a handful of workflow file lines).

## References

- ADR 008: Script naming convention
- ADR 014: PR checks workflow with static matrix and combined filter
- ADR 025: E2E test architecture per package (will populate per-app `test:e2e` tasks)
- ADR 030: pnpm workspaces as the package manager (will update commands to `pnpm turbo`)
- Planned: trunk-based development on `main` (will update filter base to `[origin/main]`)
- @see https://turborepo.com/docs Turborepo documentation
