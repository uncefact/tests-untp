# ADR: Per-package tag-triggered npm release

- **Date:** 2026-05-15
- **Status:** accepted
- **Supersedes:** [004](./004-changesets-for-version-management.md), [005](./005-changeset-enforcement-via-three-layers.md), [013](./013-release-workflow-correctness-measures.md), [022](./022-rc-cycles-via-changesets-pre-mode.md), [026](./026-release-runbook-for-failure-recovery.md)

## Context

ADR 004 adopted Changesets for version management and publishing across the publishable npm surface (`@uncefact/untp-ri-services` and `@uncefact/untp-utils`). ADRs 005, 013, 022 and 026 build on that decision (per-PR enforcement, single-workflow correctness measures, RC cycles via pre mode, and the failure-recovery runbook respectively).

In practice the Changesets model couples release cadence across packages. Each merge to `next` accumulates pending changesets into a single "Version Packages" PR; merging that PR fires `changeset publish` and ships every accumulated bump in lock-step. The per-package hold mechanism added in #611 papered over the symptom, but the root issue is the shared release event itself: shipping any single package requires either holding back the others or accepting that they ship at the same time.

The reference implementation and the playground already solve the cadence problem in a different way. Each Docker image is built from a per-app tag (`reference-implementation-v<X.Y.Z>`, `untp-playground-v<X.Y.Z>`); the tag push is the release event; the workflow is scoped to that one artefact. The pattern is well-understood, easy to reason about, and lines up with how publishing actually feels (open a release, push a tag, ship a thing).

This ADR brings the npm-publishable packages onto the same pattern.

## Decision

Each publishable npm package owns its own tag prefix and its own publish workflow. Release cycles decouple completely; one package ships when its maintainer pushes its tag.

**Tag pattern.** Short package name (no `@uncefact/` scope) plus `-v<X.Y.Z>`:

| Package | Tag prefix | Example tag |
|---|---|---|
| `@uncefact/untp-ri-services` | `untp-ri-services-v` | `untp-ri-services-v1.2.3` |
| `@uncefact/untp-utils` | `untp-utils-v` | `untp-utils-v0.5.0-rc.1` |

Pre-release tags carry an SemVer suffix (`-rc.N`, `-alpha.N`, `-beta.N`, `-pre.N`). Stable tags carry only `X.Y.Z`.

**Workflow per package.** Two workflows are added, one per publishable package:

- `.github/workflows/publish-untp-utils.yml`
- `.github/workflows/publish-untp-ri-services.yml`

Each workflow:

1. Triggers on `push` of a tag matching its prefix.
2. Checks out the tagged commit with `ref: ${{ github.sha }}` and a verification step that fails the workflow if the checked-out HEAD does not match (carrying forward the SHA-pin practice from ADR 013).
3. Reads the package's `package.json`. Refuses to publish if the version in `package.json` does not match the version in the tag. This prevents the "tag says 1.2.3, package says 1.2.2" class of mismatch.
4. Builds the package (and the workspace dependencies it transitively requires).
5. Publishes to npm with `--provenance`. Stable tags publish with `--tag latest`; pre-release tags publish with `--tag rc`. Consumers that want pre-releases must opt in explicitly via `npm install @uncefact/<pkg>@rc`; `npm install @uncefact/<pkg>` always resolves to the latest stable.
6. Authenticates with npm via OIDC Trusted Publishing (`id-token: write`, no long-lived `NPM_TOKEN`). Each package must be configured as a Trusted Publisher on npmjs.com under the `@uncefact` org, pointed at its specific workflow filename.

**Rollback / archive workflow.** A single `workflow_dispatch`-only workflow (`unpublish-or-deprecate.yml`) handles withdrawal:

- Inputs: `package` (dropdown of publishable packages), `version` (string), `action` (`unpublish` | `deprecate`), `message` (string).
- `unpublish` runs `npm unpublish <pkg>@<version>`. npm only permits unpublish within 72 hours of the version's first publish (and only when no other versions depend on it). Outside that window the command fails loudly; that failure is the prompt to fall back to `deprecate`.
- `deprecate` runs `npm deprecate <pkg>@<version> "<message>"`. The version remains installable but `npm install` emits a warning and the version is hidden from typical version listings. This is the long-term archive path for broken releases that cannot be unpublished.

The same workflow authenticates via OIDC Trusted Publishing — no separate token surface for the rollback path.

**Correctness measures inherited from ADR 013.** The portable practices stay in place:

- Explicit SHA checkout with a verification step.
- Per-package `concurrency` group with `cancel-in-progress: false` (a half-published release would be worse than a queued release).
- npm `--provenance` and `id-token: write`.
- `actions/setup-node` reads `.nvmrc`.

The "single workflow" choice from ADR 013 is reversed. ADR 013 rejected the multi-workflow alternative on the grounds that a `GITHUB_TOKEN` cannot trigger downstream workflows. That concern only applied to workflow-created tags (the Changesets action creating tags from the release workflow). Under this ADR the tag push is a deliberate human action, and tag-triggered workflows fire from human pushes without restriction.

**Changesets footprint removed.** The implementation PR that follows this ADR deletes `.changeset/`, `scripts/release.mjs`, `.github/workflows/release.yml`, the `@changesets/cli` devDep, and the `changeset` / `release` scripts from the root `package.json`.

## Consequences

**What becomes easier**

- Releases decouple. Shipping `@uncefact/untp-utils@0.5.1` does not block on the state of `@uncefact/untp-ri-services`. The release cadence per package is no longer the slowest sibling's cadence.
- The mental model is uniform across the four release surfaces (services, utils, reference implementation, playground). All four shape: bump version → push tag → workflow does the rest.
- No PR-time changeset authoring burden. Version bumps happen at release time on a maintainer's machine (or via a small "bump and tag" GitHub UI flow), not on every merging PR.
- Pre-releases are first-class. A tag of the form `<prefix>-v0.6.0-rc.1` publishes to `rc` without ceremony; promotion to stable is just another tag push with the suffix removed.
- Rollback has a single documented path with two outcomes (unpublish vs deprecate), both wired into the same workflow.

**What becomes harder**

- No centralised release-notes aggregation across packages. Each package's release notes live in its own `CHANGELOG.md` and (where the package warrants one) `RELEASE_NOTES.md`. Maintainers write these by hand before tagging, the same way the playground does today.
- Version bumps move from PR-time to release-time. The "did I forget a changeset?" check no longer exists; instead the workflow's `package.json` ↔ tag-version match check catches forgotten bumps at tag push.
- Maintainers must remember the per-package tag prefixes. A `docs/RELEASES.md` runbook (added in the implementation PR) documents them.

## Alternatives Considered

### Keep Changesets, expand the per-package hold mechanism

Rejected. The hold labels (PR #611) skip publishing for specific packages on a given release event, but the release event itself is still shared across the publishable surface. The cadence-coupling stays. The hold mechanism is a workaround for the symptom, not the cause.

### Move to release-please

Rejected. release-please solves a similar problem (per-package release PRs) and would technically be a fit, but it duplicates the operational model the repository already runs for the playground and reference implementation. Adopting the same pattern across all four release surfaces is simpler than running two release tools side by side.

### Per-package "Version Packages" PRs via Changesets `fixed`/`linked` groups

Rejected. Changesets supports grouping packages so that a single bump in one package automatically bumps the others. This is the opposite of the decoupling goal: it forces version lock-step. The Changesets config knobs that would help (one Version Packages PR per package) don't exist as first-class features and would need to be hacked in via multiple instances of Changesets at different paths, which is more complexity than the per-package workflow approach.

### Single shared parameterised publish workflow

Rejected. A parameterised workflow that detects the package from the tag prefix would reduce duplication but would push tag-pattern matching into workflow logic, making it harder to see at a glance which package each workflow ships. With only two publishable packages, the duplication is contained. Adopt the parameterised pattern only if the publishable surface grows to a point where duplication becomes painful.

## References

- ADR 011: Independent versioning across four release streams (the framing this ADR builds on)
- npm Trusted Publishing: https://docs.npmjs.com/trusted-publishers
- npm unpublish policy: https://docs.npmjs.com/policies/unpublish
- npm deprecate: https://docs.npmjs.com/cli/v10/commands/npm-deprecate
- PR #611: Changesets npm publish wiring (the implementation now being superseded)
