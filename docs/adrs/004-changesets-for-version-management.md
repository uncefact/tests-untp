# ADR: Changesets for version management and publishing

- **Date:** 2026-05-12
- **Status:** accepted

## Context

With independent versioning across four release streams (separate ADR), we need a tool that handles:

- Per-PR declarations of which packages bump and how (major/minor/patch).
- Aggregation of pending changes into a single release event.
- Automatic version bumping, changelog generation, and publishing.
- Cross-package workspace dep updates (when `services@1.2.0` becomes `1.3.0`, `reference-implementation`'s manifest needs to reflect that on publish).
- Pre-release / release-candidate cycles for spec transitions.
- Compatibility with trunk-based development on `main`.

The existing release process is ad-hoc and version-sync-based. It does not scale to independent versioning.

## Decision

We adopt Changesets (`@changesets/cli`) as the version management and publishing tool.

The flow:

1. Every PR that affects a releasable package includes a changeset file in `.changeset/<name>.md`, declaring which packages bump and how, with a free-text summary.
2. On every push to `main`, a Changesets GitHub Action runs. It either updates a long-lived "Version Packages" PR aggregating pending changesets, or — if no changesets are pending — runs the publish step.
3. Maintainers review the Version Packages PR, which previews all pending releases across all packages.
4. Merging the Version Packages PR is the release event. The next workflow run executes `changeset publish`, which:
   - Reads each bumped package's `package.json`.
   - Publishes any package with a version not yet on the registry.
   - Tags git with `@scope/package@version` per package.
   - Creates GitHub releases with auto-generated changelogs.
5. Pre-release / RC cycles use `changeset pre enter <tag>` and `changeset pre exit` — temporary modes that produce pre-release versions and publish to a non-default npm dist-tag.

`components` is `private: true` and is skipped by Changesets automatically.

Docker apps are also `private: true` so Changesets does not attempt to publish them to npm. Their version bumps and git tags still happen — Docker image building is handled separately, triggered by the same release event (see CI/CD ADR).

We chose Changesets because it is the de-facto standard for TypeScript monorepos with independent versioning, it handles cross-package workspace dep rewrites correctly, and its single-long-lived-release-PR pattern fits trunk-based development with no additional branching.

## Adoption notes

The walking-skeleton implementation of this ADR ships across two PRs.

**Stage 1 — tooling and baseline (#610):**

- `@changesets/cli` added as a root devDependency.
- `.changeset/config.json` configured with `access: "public"`, `baseBranch: "next"` (the project's release line; differs from this ADR's "main" framing — `next` is the equivalent here), `updateInternalDependencies: "patch"`, and an `ignore` list covering every workspace that should not produce npm releases: `@reference-implementation/components`, `@reference-implementation/core`, `@uncefact/untp-playground`, and both e2e suites.
- Publishable packages aligned at `0.1.0` baseline: `@uncefact/untp-utils`, `@uncefact/untp-test-suite`, `@uncefact/untp-ri-services`. The RI's workspace dependency on `@uncefact/untp-ri-services` was bumped to match.
- `pnpm changeset` exposed in root scripts for contributor discoverability.

**Stage 2 — release workflow (#611, in flight):**

- `.github/workflows/release.yml` rewritten around `changesets/action@v1` and triggered on push to `next`.
- npm publish uses OIDC Trusted Publishing rather than a long-lived `NPM_TOKEN`; the job carries `id-token: write` and pairs it with `--provenance` via `NPM_CONFIG_PROVENANCE`.
- The Docker apps' release event is tied to the same flow via the `reference-implementation-v*` / `untp-playground-v*` git-tag triggers in their respective Docker workflows.

**Deferred:**

- Changeset enforcement (ADR 005) — no PR-level required-changeset check yet.
- RC pre-mode (ADR 022) — `changeset pre enter` / `pre exit` not yet wired into release workflow.

## Consequences

**What becomes easier:**
- Per-PR version decisions are explicit and reviewable rather than inferred at release time.
- Cross-package dep updates happen automatically (workspace dep rewrites on publish).
- Pre-release cycles are a built-in mode rather than a custom branching dance.
- Changelogs are generated automatically and stay in sync with versions.
- The single Version Packages PR provides a clear "this is what's about to ship" preview that maintainers review before release.

**What becomes harder:**
- Contributors must remember to write changeset files. Enforcement is needed (separate ADR on changeset enforcement layers).
- A PR that touches multiple packages may need to write a changeset that declares bumps for all of them — judgment about bump levels is now contributor-side, not maintainer-side at release time.
- Wrong bump levels (e.g., declaring `patch` for a breaking change) are caught only in code review. There is no automatic detection.

## Alternatives Considered

### Lerna

Rejected because Lerna is in maintenance mode under Nx ownership. Every job Lerna does has been superseded by purpose-built tools — Changesets for versioning and publishing, Turborepo or Nx for task orchestration. Adopting Lerna in 2026 would mean adopting a tool whose function has been redistributed.

### Manual versioning and publishing scripts

Rejected because hand-rolling the cross-package dep rewrite logic, changelog generation, npm publishing with provenance, and git tagging is significant work that produces a worse result than Changesets does for free.

### `npm version` per package with manual coordination

Rejected because it does not handle the workspace dep rewrite case (when `services` bumps, consumers' published `package.json` needs to reflect the new version, not `workspace:*`). Changesets handles this transparently.

### Semantic-release

Rejected because semantic-release infers bumps from commit messages (Angular convention) rather than explicit per-PR declaration. This works for single-package repositories but is harder to apply correctly across a monorepo where one PR may affect multiple packages with different bump levels. Changesets' explicit per-PR file is more honest for this shape.

## References

- ADR: Trunk-based development on `main`
- ADR: Independent versioning across release streams
- ADR: Changeset enforcement via three layers
- ADR: Release workflow correctness measures (single workflow, SHA pinning)
