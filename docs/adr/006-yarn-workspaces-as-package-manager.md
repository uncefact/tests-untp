# ADR: Yarn workspaces as the package manager

## Status

superseded

Superseded by: ADR 030 (pnpm workspaces as the package manager).

This ADR's original recommendation was to defer pnpm migration on the grounds that "migrating package managers during a structural restructure adds unrelated risk for no functional benefit." On further consideration, the reasoning was overcautious: because the restructure is already touching every `package.json`, CI workflow, Dockerfile, and Husky config, doing the pnpm migration now is less work in aggregate than doing it later (which would require re-touching all the same files). The new direction is captured in ADR 030.

The original content is retained below for historical context.

---

## Context

The repository is currently using Yarn workspaces. With the broader restructure (independent versioning, Changesets, Turborepo, etc.), it is worth explicitly confirming the package manager choice rather than migrating as part of unrelated work.

The architectural decisions in this restructure do not depend on a specific package manager — npm workspaces, Yarn, and pnpm all support workspace-style monorepos and integrate with Changesets. The choice is about ergonomics and migration risk, not capability.

## Decision

We continue using Yarn workspaces. We do not migrate package managers as part of this restructure.

- Existing Yarn installation, lockfile, and workspace configuration are retained.
- Changesets, Turborepo, and CI workflows are configured to work with Yarn.
- `node-version-file: '.nvmrc'` in `actions/setup-node` ensures Yarn runs against the correct Node version across local and CI.

We chose this because Yarn already works for the repository, Changesets and Turborepo support Yarn workspaces natively, and migrating package managers during a structural restructure adds unrelated risk for no functional benefit.

## Consequences

**What becomes easier:**
- No migration work — existing lockfile, scripts, and workspace config continue to work.
- No retraining for contributors already using Yarn.
- CI cache configuration (`cache: 'yarn'` in `actions/setup-node`) is straightforward.

**What becomes harder:**
- Yarn 1.x (classic) is in maintenance mode — security fixes only, no new features. If the project later wants modern features (zero-installs, PnP, constraints), a migration to Yarn 3/4 (berry) or pnpm would be a separate project.
- Install speed and disk efficiency are worse than pnpm's content-addressable model. For a repository with ~5 packages, this is unlikely to cause real pain.

## Alternatives Considered

### Migrate to pnpm

Rejected as part of this restructure because the restructure is already large and migrating package managers is unrelated risk. pnpm is faster and stricter, and may be worth a future migration if install times or phantom-dep issues become problems. Not now.

### Migrate to npm workspaces

Rejected because it offers no advantage over current Yarn and would still require migration. npm workspaces is fine for new repositories but moving from one working setup to another working setup is wasted effort.

### Migrate to Yarn 3/4 (berry)

Rejected as part of this restructure for the same reason — adds risk and effort for benefits (zero-installs, plugin system) that are not load-bearing for any architectural decision. Worth reconsidering later if specific berry features become valuable.

## References

- ADR: Turborepo for build orchestration and caching
- ADR: Changesets for version management and publishing
