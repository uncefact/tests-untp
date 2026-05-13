# ADR: Docker image tagging strategy

- **Date:** 2026-05-12
- **Status:** accepted
- **Update (2026-05-13):** `docker-ri.yml` and `docker-playground.yml` currently trigger on `push: branches: next` with path filters, not on semver tags. The semver-tag-trigger design described in PR #611 is proposed but not yet merged. The pnpm migration on this branch rewrote both Dockerfiles internally without changing image names or tag formats; the decisions in this ADR are unchanged.

## Context

The repository publishes Docker images for `reference-implementation` and `playground` to GitHub Container Registry (ghcr.io). Image tags serve multiple audiences with different needs:

- **Production operators** want immutable, exact identity for safe deploys and reliable rollbacks.
- **Dev environments** want a moving pointer to the latest main build.
- **Release candidate testers** want a moving pointer to the current RC.
- **Casual consumers** want `:latest` for "give me the current stable."
- **Audit and debugging** wants traceability from image back to source commit.

Conflating these into too few tags forces tradeoffs (mutability vs identity). Adding too many creates clutter.

## Decision

We use the following tag set, with conditional logic determining which tags are pushed per release type:

**Stable releases** push per app:
- `:X.Y.Z` — exact, immutable. The canonical pin for production.
- `:X.Y` — latest patch within minor, rolling. Auto-updates for non-breaking fixes.
- `:X` — latest within major, rolling. Auto-updates within a major line.
- `:latest` — current stable, rolling. Generic discovery.
- `:sha-abc1234` — commit traceability. Maps image to source commit unambiguously.

**RC releases** push:
- `:X.Y.Z-rc.N` — exact, immutable. Pinnable RC identity.
- `:rc` — latest RC, rolling. Discovery for the current RC.
- `:sha-abc1234` — commit traceability.
- Stable rolling tags (`:latest`, `:X.Y`, `:X`) do **not** move during RC cycles. Production stays on the last stable.

**Dev builds** (every push to `main`) push:
- `:dev` — latest main, rolling. Dev environment auto-pulls this.
- `:dev-<sha>` — commit traceability for dev builds.

**OCI labels on every image:**
- `org.opencontainers.image.source` — source repository URL.
- `org.opencontainers.image.version` — exact version string.
- `org.opencontainers.image.revision` — commit SHA.
- `org.untp.spec-version` — UNTP spec version this image implements (separate ADR).

**Multi-arch:** every image is built for `linux/amd64` and `linux/arm64` via Buildx + QEMU emulation. Build time roughly doubles but is acceptable given release frequency.

There is **no** `:untp-X.Y` rolling tag (see separate ADR on UNTP spec compatibility tracking — that concern is handled by image labels and the release manifest, not by rolling tags).

We chose this tag set because each tag serves a clear audience: exact versions for production pinning, rolling tags for casual consumers and dev environments, SHA tags for audit, and OCI labels for metadata that should travel with the immutable image.

## Consequences

**What becomes easier:**
- Production pins to `:X.Y.Z` and is never surprised by an upgrade.
- Dev environments auto-update via `:dev`. Watchtower or similar polling tools work cleanly.
- RC cycles don't pollute stable channels — `:latest` and stable rolling tags stay frozen until `pre exit`.
- Audit ("what commit is this image from?") is a single `docker inspect` away.
- Multi-arch support means contributors on Apple Silicon and Linux x86 both pull native images.

**What becomes harder:**
- More tags to push per release — six on stable, three on RC, two on dev. CI logic must select the right set per release type.
- Multi-arch builds via QEMU emulation roughly double build times. Acceptable but real.
- Discipline required to never let RC builds push stable rolling tags. A bug in tag-selection logic could pollute `:latest` with an RC. Mitigated by explicit conditional logic and review.
- Rolling tags (`:X.Y`, `:X`, `:latest`) are mutable. Consumers who pin to them get auto-updates which they may not want; production should pin to `:X.Y.Z` and override the default.

## Alternatives Considered

### Only exact tags (`:X.Y.Z`), no rolling tags

Rejected because rolling tags serve real discovery and dev-environment needs. Forcing every consumer to look up the latest exact version is poor UX.

### Single `:latest` + exact versions, no `:X.Y` or `:X` rolling tags

Considered. Rejected because intermediate rolling tags (`:X.Y` for patch auto-update within minor) are useful for environments that want bugfixes but not features. The cost of pushing them is trivial.

### Date-based tags (`:2026-05-11`)

Rejected as a primary scheme because dates don't convey semantic version information. Useful as a supplementary tag for the docs site (which has no semver), but not for the apps.

### Rolling `:untp-X.Y` tag for spec compatibility discovery

Rejected — see separate ADR on UNTP spec compatibility tracking. Rolling tags for spec discovery contradict the immutable-pinning intent of versioned releases. Release manifest serves discovery without that contradiction.

## References

- ADR: Independent versioning across release streams
- ADR: UNTP spec compatibility tracking
- ADR: Release workflow correctness measures
