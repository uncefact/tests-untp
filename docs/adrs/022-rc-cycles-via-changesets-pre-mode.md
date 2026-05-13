# ADR: Release candidate cycles via Changesets pre mode

- **Date:** 2026-05-12
- **Status:** proposed

## Context

Major spec transitions (e.g., UNTP 0.7 → 0.8) and major version bumps of the reference implementation are non-trivial and benefit from an RC cycle. Implementers and pre-prod environments need a way to test the upcoming release before it ships to stable. The team needs an environment to validate behavior before declaring the release final.

The previous architecture handled this with a `next` branch (rejected in favor of trunk-based development), or required hand-rolled pre-release versioning. Neither serves the actual need cleanly.

Changesets has built-in support for pre-release cycles via `pre enter` and `pre exit` modes, which produces RC-style version numbers and publishes to non-default registry channels.

## Decision

We use Changesets pre mode for RC cycles:

**Entering a pre-release cycle:**

```bash
pnpm changeset pre enter rc
# commits .changeset/pre.json marker file
```

This puts the repository in pre-release mode. Normal PR flow continues — feature/fix PRs land with changesets — but the Version Packages PR now produces pre-release versions:

- `services: 1.2.0 → 1.3.0-rc.0 → 1.3.0-rc.1 → 1.3.0-rc.2`
- `reference-implementation: 2.3.0 → 2.4.0-rc.0 → 2.4.0-rc.1`

Each Version Packages PR merge during a pre-release cycle:
- Publishes npm packages under the **`rc` dist-tag** (not `latest`).
- Builds Docker images with **`:X.Y.Z-rc.N`** exact tags and **`:rc`** rolling tag.
- **Does not move stable rolling tags** (`:latest`, `:X.Y`, `:X`).

**Exiting the pre-release cycle:**

```bash
pnpm changeset pre exit
# removes .changeset/pre.json
```

The next Version Packages PR produces stable versions:
- `1.3.0-rc.2 → 1.3.0`
- `2.4.0-rc.1 → 2.4.0`

Stable release rolling tags resume moving.

**npm dist-tag behavior:**
- Default `npm install @untp/services` continues to get `latest` (the last stable).
- Opt-in to RC: `npm install @untp/services@rc`.
- Pin specifically: `npm install @untp/services@1.3.0-rc.2`.

**Docker tag behavior** during RC cycles:
- `:X.Y.Z-rc.N` — exact, immutable.
- `:rc` — moves to point at the latest RC across all packages in the pre-release cycle.
- `:sha-abc1234` — commit traceability.
- Stable rolling tags (`:latest`, `:X.Y`, `:X`) stay frozen until `pre exit`.

**Staging environment** auto-deploys `:rc` during RC cycles (separate ADR on deployment tiers). RC validation happens in staging with the same telemetry and observability as prod.

**Stage C E2E** (separate ADR on testing stages) runs against staging after each RC publish and acts as the RC quality gate.

When to use pre-release mode: deliberately, for big spec implementations (UNTP minor or major spec bumps), major version bumps of the apps, or anything where you want early adopters and the team to validate before declaring stable. **Not for every release** — the overhead of entering/exiting pre-release mode isn't worth it for normal feature work, which goes straight to stable via the normal release flow.

We chose this design because Changesets' pre mode is the standard mechanism, it integrates cleanly with the rest of the release infrastructure (npm dist-tags, conditional Docker tags), and it doesn't require a separate branch.

## Consequences

**What becomes easier:**
- RC cycles are a first-class part of the release flow, with explicit enter/exit semantics.
- Consumers who want bleeding edge can opt in via `@rc` dist-tag without affecting consumers who pin to `latest`.
- Staging environment continuously runs the current RC during a cycle, exercising the release before promotion.
- No `next` branch needed; trunk-based development is preserved.

**What becomes harder:**
- Entering/exiting pre-release mode is a deliberate maintainer action with implications across npm and Docker publishing. Worth documenting clearly so it isn't done casually.
- During an RC cycle, the team must distinguish "RC behavior" from "what's about to ship as stable" — they're the same artifacts but the framing matters.
- Pre-release mode persists across PR merges via the `pre.json` marker file. Forgetting to exit means subsequent releases continue as RCs. The Version Packages PR description signals this clearly but vigilance is needed.
- Tag-selection logic in the Docker publish workflow must correctly distinguish pre-release versions from stable versions and apply the right tag set. A bug here could pollute stable channels with RC builds (mitigated by explicit conditional logic and review).

## Alternatives Considered

### Separate `next` branch for RCs

Rejected. Returns to the dual-branch model that trunk-based development specifically removed. RCs are a temporal property of releases (this release is an RC), not a structural property (this branch holds RCs).

### Manual pre-release version numbering without Changesets pre mode

Rejected because the tooling to produce pre-release versions correctly across multiple packages with cross-deps is exactly what Changesets pre mode provides. Hand-rolling this is error-prone for no benefit.

### No RC cycles; ship every release directly to stable

Rejected for major releases where validation against a deployed environment matters. For minor feature releases this is fine and is the default — pre-release mode is opt-in for releases that need it.

### RC cycle automatically gated on every release

Rejected because the overhead (mode switching, staging validation cycle) isn't worth it for minor feature work. RCs should be reserved for changes where validation provides real value.

## References

- ADR: Trunk-based development on `main`
- ADR: Changesets for version management and publishing
- ADR: Docker image tagging strategy
- ADR: Three deployment tiers (dev, staging, prod)
- ADR: Four-stage testing strategy
