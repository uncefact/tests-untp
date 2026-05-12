# ADR: pnpm workspaces as the package manager

## Status

proposed

When implemented, this ADR will supersede ADR 006 (Yarn workspaces as the package manager). Until then, ADR 006's decision (yarn) remains in effect.

## Context

ADR 006 recommended staying on Yarn 1 workspaces for this restructure, on the grounds that migrating package managers mid-restructure added unrelated risk. On reflection, that reasoning was overcautious.

The restructure already touches every file that a package-manager migration would touch:

- Every `package.json` is being modified for script naming convention changes (ADR 008).
- Every CI workflow is being rewritten for the new PR check / release / deploy structure (ADRs 014, 023).
- Every Dockerfile is being updated for multi-arch builds with explicit SHA checkout (ADRs 011, 013).
- Husky and lint-staged configs are being updated for the new pre-commit role (ADR 009).
- Changesets is being introduced (ADR 004), which writes commands against whichever package manager is in use.

Migrating the package manager later means doing this work twice. Doing it now means doing it once. The "unrelated risk" framing in ADR 006 was therefore inverted — the lower-risk path is to migrate now.

Independently, the substantive case for pnpm has strengthened:

- **Yarn 1 is in maintenance mode.** Security fixes only, no new features. Long-term stagnation.
- **pnpm's strict `node_modules` layout catches phantom dependencies.** Yarn 1's flat hoisting lets a package import something it didn't declare in its own `package.json` (because it happens to be in `node_modules` at the root). This is a class of latent bug. pnpm's symlinked structure prevents it — a package can only resolve what it declared. Surfacing this class of bug *during* the restructure (when the team has context on every package) is better than discovering it later in production.
- **CI install speed.** pnpm's content-addressable store and parallel resolution are meaningfully faster than Yarn 1, especially for cold installs which dominate CI runtime.
- **Disk efficiency.** pnpm shares packages across projects via hardlinks/symlinks; multiple checkouts of the repo cost much less disk than Yarn does.

## Decision

We migrate to **pnpm workspaces** as one of the **first** steps in the restructure (after dropping the `next` branch, before Changesets adoption and the rest of the work).

**Configuration:**

- `pnpm-workspace.yaml` at the repository root declares workspace package globs.
- Root `package.json` includes a `packageManager` field pinning the pnpm version (e.g., `"packageManager": "pnpm@9.x.y"`). This pin is the source of truth for `corepack` in both local dev and CI.
- `.npmrc` at the repository root configures:
  - `auto-install-peers=true` — pnpm installs peer dependencies automatically (matches Yarn 1's behaviour).
  - `strict-peer-dependencies=false` initially — relaxed to ease migration. Flip to `true` once the migration has stabilised and peer-dependency hygiene has been audited.
  - `node-linker=isolated` (the default) — full pnpm symlink semantics. Do NOT use `hoisted` mode; that re-creates the flat-hoisting class of bugs the migration is trying to eliminate.
- `workspace:*` protocol for internal cross-package deps (works identically to Yarn).
- `private: true` on `components` and the two Docker apps (unchanged from earlier ADRs).

**Sequencing within the migration:**

The pnpm migration is step 2 of the migration sequence (after dropping the `next` branch, before Changesets adoption). This ordering is deliberate:

- Doing it first means subsequent migration steps (Changesets, Turborepo, CI workflows, Dockerfiles) are written for pnpm from the start. No second pass.
- Phantom-dep failures surface in a clean state rather than entangled with other restructure work.
- The agent executing the migration has a clear "stop and ask" trigger if pnpm install fails for non-obvious reasons.

**Docker build pattern:**

Naïve substitution of `yarn install` → `pnpm install` in existing Dockerfiles produces working but slow builds. The pnpm-idiomatic pattern is:

```dockerfile
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/<app>/package.json packages/<app>/
# Optionally copy other workspace package.jsons for monorepo-aware fetch
RUN pnpm fetch --filter <app>...
RUN pnpm install --frozen-lockfile --offline --filter <app>...
```

`pnpm fetch` populates the store from the lockfile; `pnpm install --offline` then installs against the prefetched store. This gives Docker layer caching exactly the right granularity — code changes don't bust the dep-install layer.

**CI invocation:**

- `actions/setup-node` with `node-version-file: '.nvmrc'`.
- `pnpm/action-setup@v3` (or current) reads the `packageManager` field for the pnpm version.
- `pnpm/action-setup` with `run_install: false`, followed by an explicit `pnpm install --frozen-lockfile` in workflow steps for clearer caching control.
- Cache key includes `pnpm-lock.yaml` hash.

**Tool compatibility verification:**

Some tools are sensitive to pnpm's symlinked `node_modules`. Verify during migration:

- **Cypress** — typically works but binary resolution can be quirky. Test the existing E2E suite before declaring migration complete.
- **Native modules** (Prisma, OpenTelemetry's native exporters, anything with `node-gyp`) — generally fine but worth a clean install verification.
- **Bundlers in Docker apps** (whatever's used in reference-implementation and playground builds) — must resolve workspace deps correctly. If externalising rather than bundling, verify `workspace:*` is rewritten correctly at publish time (Changesets handles this for libraries; bundlers handle it for apps).
- **Husky** — works with pnpm; install hook is `pnpm prepare`.
- **Turborepo** — first-class pnpm support.
- **Changesets** — first-class pnpm support.

**Migration steps within step 2:**

1. Add `pnpm-workspace.yaml`, `.npmrc`, and `packageManager` field.
2. Delete `yarn.lock`. Run `pnpm install` to generate `pnpm-lock.yaml`.
3. Fix any peer-dependency warnings or strict-resolution errors that surface.
4. Update all `package.json` scripts that hardcode `yarn` (if any) to use `pnpm`.
5. Update CI workflows to use `pnpm/action-setup` and `pnpm install --frozen-lockfile`.
6. Update Dockerfiles to use the pnpm pattern above.
7. Update `CLAUDE.md` and any other contributor docs.
8. Verify the existing test suite, build, and any local dev workflows still work.
9. Audit for phantom-dep failures — packages that import things they didn't declare. Fix each by adding the missing dep to that package's `package.json`.

## Consequences

**What becomes easier:**
- Phantom-dep bugs are caught structurally rather than at runtime.
- CI cold-install times drop noticeably.
- Disk usage drops, especially for contributors with multiple checkouts.
- Locked into a maintained, actively developed package manager rather than a maintenance-mode one.
- Subsequent migration steps (Changesets, Turbo, CI) are written for pnpm from the start.

**What becomes harder:**
- Strict resolution surfaces phantom-dep bugs that previously worked silently. Each one needs fixing (adding the missing dep declaration). Expected during migration; uncommon afterwards.
- Some legacy or poorly-maintained tools assume flat `node_modules` and break under pnpm's symlinked structure. Verification is part of the migration; if a critical tool breaks, the fallback `node-linker=hoisted` exists but defeats the main benefit and should be avoided.
- Docker build pattern is different — copy-paste of Yarn Dockerfile patterns won't be optimal. Need to use `pnpm fetch` for proper layer caching.
- Contributors familiar with Yarn need a short orientation. Most commands are direct equivalents (`pnpm install`, `pnpm add`, `pnpm run X`, `pnpm exec`), but a few differ.
- The Claude Code agent executing the migration needs explicit guidance on pnpm-specific patterns (this ADR provides it).

## Alternatives Considered

### Stay on Yarn 1 (the position from ADR 006)

Rejected. Reasoning given in Context: doing the migration now is less work in aggregate than doing it later, and Yarn 1's maintenance-mode status will force a migration eventually anyway. Better to do it once, deliberately, while the rest of the repo is being touched.

### Migrate to Yarn 3/4 (berry)

Considered. Rejected because:
- Yarn berry's Plug'n'Play mode is a stricter departure from `node_modules` semantics than pnpm's symlink approach and has historically had worse tool compatibility.
- Yarn berry without PnP (using `nodeLinker: node-modules`) is closer to Yarn 1 and loses much of berry's value proposition.
- pnpm's strict-resolution model is the cleaner middle ground — real `node_modules` semantics (most tools work), strict declaration enforcement (catches phantom deps).
- Adoption momentum favours pnpm for monorepos at this scale.

### Migrate to npm workspaces

Rejected. npm workspaces work but offer no advantage over pnpm — slower, no content-addressable store, no strict resolution. Migrating from one working setup to a strictly inferior working setup is wasted effort.

### Defer to a later separate migration (the ADR 006 position)

Reconsidered and rejected. The argument that "the restructure is already large, don't add unrelated risk" inverts when you notice the restructure is already touching every file the migration would touch. Doing it later means doing the same work twice.

### Bun

Considered briefly. Rejected for this repository because Bun's package management is less mature than pnpm's for monorepos at this scale, and the ecosystem (Changesets, Turborepo, GitHub Actions integration) is more battle-tested with pnpm.

## References

- ADR 006 (superseded by this ADR)
- ADR 004: Changesets for version management and publishing
- ADR 007: Turborepo for build orchestration and caching
- ADR 008: Script naming convention
- ADR 009: Husky and lint-staged for pre-commit hooks
- pnpm workspaces documentation
- pnpm Docker best-practices documentation
