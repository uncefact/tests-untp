# ADR-048: Playground documentation is its own independently versioned docs instance

- **Date:** 2026-08-20
- **Status:** accepted

## Context

[ADR-012](./012-multi-instance-docusaurus-for-docs.md) proposed a multi-instance Docusaurus layout with an independently versioned instance per component; it has sat `proposed` with no instance built. The link set card now gained a documentation link (#811): the UI explains how UNTP credential links are identified by pointing at a docs page, which forced the first concrete instance decision. That page is about the Playground's behaviour, and it must stay true for the Playground version a user is running. The documentation site had one versioned docs instance, whose versions (0.1.0 through 0.4.0) follow the reference implementation's releases. The Playground releases on its own cadence (its package version is independent, and its release notes are its own), so a Playground behaviour page inside the reference implementation's version tree would be versioned by the wrong product: cutting an RI docs version would snapshot Playground pages mid-change, and a Playground release could not snapshot its docs without cutting an RI version.

## Decision

**Playground documentation lives in a second `@docusaurus/plugin-content-docs` instance** (`id: 'playground'`, content in `documentation/docs-playground/`, served under `/playground/docs`), on the same documentation site as the reference implementation docs. This puts the playground slice of ADR-012's proposed layout in force; the test-suite instance and the optional guides instance remain proposed there. Docusaurus versions each docs instance separately, so a Playground release can cut a docs version without touching the reference implementation's version tree and the reverse. One site keeps one deployment, one theme, and one navigation home for everything in this repository; separate instances keep the two products' version lifecycles independent, which is the requirement the single shared instance could not meet.

## Consequences

- Playground pages are linked from the app by full URL (`NEXT_PUBLIC_CREDENTIAL_LINKS_DOCS_URL`, falling back to the page in the repository), so the app can point at the docs version matching its own release.
- The playground instance starts unversioned (current docs only); its first version is cut when the Playground next releases.
- Two sidebars and two version dropdown scopes exist on the one site; navigation between the instances is by links, not a shared sidebar.

## Alternatives Considered

- **A section inside the existing docs instance** (`docs/untp-playground/...`). Rejected: the existing instance's versions follow reference implementation releases, so Playground pages would be snapshotted and published on another product's cadence, which is the mismatch that motivated the decision.
- **A separate documentation site for the Playground.** Rejected: a second site duplicates deployment, theming, and navigation for no independence the second instance does not already provide.

## References

- [ADR-012](./012-multi-instance-docusaurus-for-docs.md) (the multi-instance proposal this partially implements)
- #811 (the docs link on the link set card)
- [Docusaurus multi-instance docs](https://docusaurus.io/docs/docs-multi-instance) (each instance versions independently)
