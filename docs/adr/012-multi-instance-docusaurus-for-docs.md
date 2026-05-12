# ADR: Multi-instance Docusaurus for component-versioned documentation

## Status

accepted

## Context

The documentation site (Docusaurus-based) covers multiple components — `reference-implementation`, `playground`, and `test-suite` — each on its own release cadence and own version line under the independent-versioning model. Previously, all docs were versioned together using the synchronised monorepo version, but that approach no longer fits.

Docusaurus's built-in versioning model is single-axis: one `versioned_docs/` directory, one `versions.json`, one version dropdown. If we pick one component's version as the canonical version, the others appear to track it inappropriately. If we keep using a synchronised version, we re-create the lockstep problem we just removed.

The documentation site does **not** document the UNTP specification itself (that lives elsewhere). It documents the reference-implementation app, the playground app, and the test-suite library.

`services` is intentionally excluded — it gets README + TSDoc only, with no Docusaurus instance, on the principle that a library with external consumers needs a clear README more than a separate documentation site initially. If demand emerges, an instance can be added.

## Decision

We adopt a multi-instance Docusaurus setup with three independent documentation instances, each versioned to its own component:

- `reference-implementation` instance — versioned to ref-impl version line
- `playground` instance — versioned to playground version line
- `test-suite` instance — versioned to test-suite version line
- Optional unversioned `guides` instance for cross-cutting content (architecture overview, getting started, ecosystem context) — to be added if needed

Each instance has its own `versioned_docs/`, `versions.json`, sidebar, and version dropdown. Snapshotting is per-component, triggered on the component's minor releases (not patches — patches edit the latest minor's docs in place).

The docs site itself deploys continuously on every merge to `main` with path-filtered triggers. It has no semver; its deployable identity is "latest content as of $commit." Docker images for the docs site are tagged with `:latest` and `:sha-<commit>` (and optionally a date tag), but not semver.

Legacy versioned snapshots from the previous lockstep system are either dropped or archived as a separate read-only instance, depending on whether anyone is actively reading them.

We chose this design because each component's docs genuinely want their own version axis — a playground 1.8 user cares about the playground 1.8 docs, not whichever monorepo-wide version happens to align. Multi-instance Docusaurus is the standard way to achieve per-section versioning within a single site.

## Consequences

**What becomes easier:**
- Component docs are versioned to their actual component, not to an arbitrary aggregate. User experience is correct.
- Each instance evolves on its component's cadence — a playground docs change doesn't churn ref-impl docs versions.
- Adding cross-cutting content (the `guides` instance, unversioned) is a clean addition that doesn't require fitting cross-cutting content into a versioned section.
- Stable URLs per component version (`/reference-implementation/2.3/...`) serve external implementers well.

**What becomes harder:**
- More configuration overhead in `docusaurus.config.js` — each instance is a plugin entry with its own paths and conventions.
- Three sets of `versioned_docs-<id>/` directories to keep tidy. File-system layout is more verbose.
- Snapshotting is per-component — a release of one component triggers a docs version freeze for that instance, not all of them. Requires a manual or workflow_dispatch-triggered snapshot action.
- Search across instances is configurable but each instance is a separate index by default. Multi-instance search may need additional setup (Algolia or local search with custom configuration).
- Migration cost: existing versioned snapshots from the old lockstep model must be renamed, reorganised, or dropped.

## Alternatives Considered

### Pick one component as the canonical version axis

Rejected because every other component's docs would then look like they track the canonical one inappropriately. A playground docs reader doesn't want to see "version 2.3" if 2.3 is the ref-impl version.

### Keep lockstep docs versions tied to a synchronised monorepo version

Rejected because the monorepo no longer has a synchronised version (separate ADR on independent versioning). The lockstep docs versioning was always a workaround for a problem the new architecture solves directly.

### No versioned docs — only `latest`

Rejected because external implementers value stable URLs and historical references. A spec implementer linking to documentation for the version they're integrating against needs that link to remain valid even after a release.

### Single Docusaurus instance with per-component subsections that are individually versioned

Not supported by Docusaurus's plugin model. Multi-instance is the standard mechanism.

### Defer the migration; keep current versioning

Rejected because the inconsistency between the new versioning architecture and the old docs versioning will cause confusion if left in place.

## References

- ADR: Independent versioning across release streams
- Docusaurus multi-instance docs documentation
