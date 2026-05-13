# ADR: UNTP spec compatibility tracking via metadata and release manifest

- **Date:** 2026-05-12
- **Status:** proposed

## Context

The repository implements the UN Transparency Protocol (UNTP), a specification with its own version line. Both `reference-implementation` and `playground` apps are implementations of this spec, but they evolve on independent timelines and may be on different spec versions during a transition period (e.g., reference-implementation supports UNTP 0.8 while playground still supports 0.7).

Implementers of UNTP — SaaS vendors, government pilots — need to know:

- "Which version of the reference implementation implements UNTP 0.7?"
- "Which combination of components is certified to work together for UNTP 0.7?"

Encoding spec version into the app version (e.g., `2.3.1-untp0.7`) conflates two orthogonal axes — the app's product version and the spec it implements — and breaks semver tooling.

A previously-considered approach of rolling Docker tags (`:untp-0.7` always pointing at the latest 0.7-supporting image) was rejected because rolling tags undermine the entire point of immutable, pinnable version identity. An implementer pinning to `:untp-0.7` does not know what they are actually running today versus next week.

## Decision

We treat UNTP spec compatibility as **metadata** and **discoverable through a release manifest**, never as part of any version number.

**Per-app spec version declaration:**

Each app declares its supported UNTP spec version in a per-app `.untp-version` file (e.g., `packages/reference-implementation/.untp-version` containing `0.7.1`). CI reads this at build time.

**OCI label on Docker images:**

CI sets `org.untp.spec-version=0.7.1` as an OCI label on the Docker image. Implementers can `docker inspect` an image to see its spec version. The label travels with the immutable image — no rolling tags involved.

**No `:untp-X.Y` Docker tags.** Images are tagged with their product version (`:2.3.1`) plus standard rolling tags (`:2.3`, `:2`, `:latest`). Spec compatibility is metadata on the image, not a tag pointing at the image.

**Release manifest in the repository:**

JSON files committed to `release-manifests/untp-X.Y.json` (e.g., `release-manifests/untp-0.7.json`) list certified component versions for each UNTP spec minor. Example shape:

```json
{
  "untp_spec_version": "0.7",
  "last_updated": "2026-05-11",
  "certified_components": {
    "reference_implementation": {
      "version_range": ">=2.3.0 <2.4.0",
      "latest": "2.3.5",
      "docker_image": "ghcr.io/uncefact/reference-implementation:2.3.5"
    },
    "playground": { "...": "..." },
    "services": { "...": "..." },
    "test_suite": { "...": "..." }
  }
}
```

Updated by CI step or manual PR when a component releases a new version that targets a particular UNTP spec version. The manifest is the authoritative "what works with what" lookup.

We chose this design because spec compatibility and product version are genuinely orthogonal — an app can ship many product versions while implementing the same spec version, and vice versa. Treating spec as metadata (image labels, manifest file) preserves immutable version identity while still giving implementers a queryable compatibility lookup.

## Consequences

**What becomes easier:**
- Implementers can `docker inspect ghcr.io/.../reference-implementation:2.3.1` and see exactly which spec version they are running. No tag indirection.
- The release manifest is committed to the repo alongside the code, version-controlled, reviewable in PRs, and discoverable.
- Apps can move to a new spec version independently — playground can stay on UNTP 0.7 while reference-implementation moves to 0.8, and both states are accurately reflected in their respective manifests.
- Semver tooling works correctly — no awkward suffixes or non-standard version strings.

**What becomes harder:**
- Discovery is two-step: implementers look at the manifest first, then pin to specific versions. Not a single-command pull like `docker pull image:untp-0.7` would have been.
- The manifest must be kept up to date. CI automation helps but the file is hand-edited for nuance (version ranges, deprecation notes).
- An implementer who wants "the latest for spec X.Y" cannot simply pull a rolling tag — they must read the manifest. This is a feature for correctness but a UX cost for casual discovery.

## Alternatives Considered

### Encode spec version in product version string (e.g., `2.3.1-untp0.7`)

Rejected because it conflates orthogonal axes and breaks semver tooling. Pre-release suffixes are meant for RCs and pre-releases, not for metadata about implementation scope.

### Rolling `:untp-X.Y` Docker tag

Rejected because rolling tags undermine immutable version identity. An implementer pinning to `:untp-0.7` does not actually know what they are running, which contradicts the entire reason for independently versioning the apps. Useful only as a discovery aid, but at the cost of correctness — the release manifest serves the discovery purpose without the correctness cost.

### Single shared UNTP spec version across the repository

Rejected because it forces both apps to march in lockstep on spec adoption, which is unrealistic. Reference-implementation typically moves first (it's where conformance lives); playground catches up later.

### No formal compatibility tracking; rely on release notes

Rejected because for an open standard with external implementers, "read every release note across multiple component repos to figure out compatibility" is a poor experience and error-prone. The manifest is cheap to publish and significantly improves discoverability.

## References

- ADR: Independent versioning across release streams
- ADR: Docker image tagging strategy
- `release-manifests/` directory in the repository
