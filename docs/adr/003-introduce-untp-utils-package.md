# ADR: Introduce @uncefact/untp-utils as a separate package for shared utility primitives

- **Date:** 2026-05-12
- **Status:** accepted

## Context

Multiple downstream products (RI credentials per #497, project-storage-service consumers, and the upcoming UNTP v0.7 work) need shared, low-level utility primitives such as multibase-encoded multihash digest handling. There is no existing home for these primitives in the monorepo.

The two obvious places to put them are:

1. `@uncefact/untp-ri-services`, the existing externally-published package whose remit is UNTP-specific business logic (DID management, credential issuance and verification, EPCIS event handling, encryption, storage adapters).
2. A new, dedicated package containing pure utility primitives with no UNTP-specific semantics.

The first option is cheaper in the short term (no new package configuration, publishing pipeline, or workspace registration). The second is more disciplined but adds setup cost.

A decision is needed because the answer determines the dependency graph for the three known consumers and any future ones: do they pull `@uncefact/untp-ri-services` (and its transitive dependencies and version churn) for a single small primitive, or do they depend on a focused utility package?

## Decision

We introduce a new workspace package `@uncefact/untp-utils` (`packages/utils`) as the home for pure utility primitives that are useful across multiple UNTP products and have no UNTP-specific business logic.

The package enforces a scope rule:

- **In scope:** Pure, framework-agnostic primitives. Examples: encoding and decoding utilities, generic data-format helpers, value-object classes with no UNTP semantics baked in.
- **Out of scope:** Anything that knows about UNTP credentials, EPCIS events, DIDs, storage adapters, or any other domain-specific concept. Those continue to live in `@uncefact/untp-ri-services`.

The package mirrors the `@uncefact/untp-ri-services` build and test conventions (ESM-first, Lerna-managed, ts-jest, ESNext target) so that contributors moving between the two packages do not face a culture clash. It uses `testEnvironment: 'node'` rather than `'jsdom'` because pure utilities have no DOM dependency.

The first utility shipped is `MultibaseDigest` (see #551).

## Consequences

**What becomes easier:**

- Downstream products that need only a utility primitive depend on a small, focused package rather than the heavier services graph. This reduces dependency weight and decouples version churn between business logic and primitives.
- The boundary creates a clear answer to "where does this go?" for future shared code: if it has UNTP semantics, it goes in services; if it does not, it goes in utils.
- The utility package can release independently from services. A patch to a credential adapter does not force a utils consumer to bump, and vice versa.

**What becomes more difficult:**

- There is now an additional package to maintain, publish, and version. The build chain, lockfile, and any future release tooling need to remain aware of it.
- Contributors must consciously decide which package a new primitive belongs in. Without the scope rule above being followed, the boundary will erode over time.
- If a utility primitive needs to evolve in a way that depends on UNTP-specific knowledge, it has to be moved (or split) rather than incrementally accommodated in place.

## Alternatives Considered

### Add the primitives to `@uncefact/untp-ri-services`

Rejected. Services exists for UNTP-specific business logic and adapter wiring; adding pure encoding primitives muddies its identity. Consumers that want only a small utility would still pull the full services transitive graph and be subject to its version churn, which is the opposite of the goal. The "do it later, lift out when a second consumer appears" deferral does not apply because three consumers are already waiting.

### Publish each utility as its own package (`@uncefact/untp-multibase-digest`)

Rejected for now. Single-purpose packages are clean but multiply the per-package setup cost (build, publish, versioning) for primitives that are otherwise unrelated. With only one utility today and more anticipated, a disciplined utils package is a better fit than a constellation of micro-packages. If a single utility later grows large enough to justify its own release cadence, it can be lifted out without affecting the API on its callers.

### Use the existing `@reference-implementation/` scope rather than `@uncefact/`

Rejected. Utils is intended for external consumption by multiple products outside this repository, so it matches the externally-published `@uncefact/` convention used by `@uncefact/untp-ri-services` rather than the `@reference-implementation/` scope used elsewhere in this monorepo for RI-aligned packages.

## References

- #551 (Add MultibaseDigest utility in a new @uncefact/untp-utils package)
- #497 (downstream consumer for MultibaseDigest)
- `packages/utils/README.md`
