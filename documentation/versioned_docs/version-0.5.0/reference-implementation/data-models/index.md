---
sidebar_position: 1
title: Data Model Bridges
---

# Data Model Bridges

The UNTP specification defines several credential types — Digital Product Passport, Digital Conformity Credential, Digital Facility Record, and others. Each has its own semantic structure that evolves across specification versions. But the Reference Implementation's internal entities — organisations, facilities, products, and conformity vocabulary profiles — are stable. A tenant's organisation record doesn't change just because a new UNTP version is released.

This creates a mapping problem. A product identifier might sit at a different path in version `0.6.1` than it did in `0.6.0`. A new version might restructure how facility data is nested. **Data model bridges** solve this by providing a two-way mapping between stable internal entities and evolving credential structures.

## What bridges do

Each UNTP core data model type and version has a corresponding bridge that exposes four operations:

| Method | Direction | Purpose |
|--------|-----------|---------|
| `buildSubject` | Entities → Credential subject | Populates a credential payload from entity data |
| `extractRefs` | Credential subject → Refs | Pulls entity identifiers out of a credential for database linking and IDR publishing |
| `extractConformityClaim` | Credential subject → Conformity claim | Extracts the conformity claim for CVC validation. Returns `null` for credential types that carry no conformity claim |
| `extractConformityClaimWithProvenance` | Credential subject → Conformity claim + source map | Same as `extractConformityClaim`, plus a map from each claim value back to the subject path it came from, so a validation warning can point at the submitted credential |

These are synchronous, stateless functions — they receive data in and return data out, with no configuration or side effects.

### Population

When a user issues a credential through the web UI, they select entities (organisation, facility, product) from their master data. The bridge's `buildSubject` method takes those entities and maps them into the correct positions within the credential subject for that type and version. This means users define their entity data once and the bridge handles the structural mapping — no manual re-entry for each credential.

Population is UI-driven: the frontend calls the build endpoint during form submission, and the bridge produces the credential subject body. The consumer then wraps it with the appropriate `@context` and credential `type` arrays using the separate `buildContextAndTypes` utility.

:::tip[Frontend not yet built]
The web UI for entity-driven credential issuance is not yet implemented. The bridge infrastructure and API endpoints are in place, but the frontend that presents entity pickers and calls `buildSubject` during form submission is planned for a future iteration. Currently, credentials are issued by providing a pre-built `credentialPayload` directly to the credentials API.
:::

### Extraction

The bridge's `extractRefs` method reads the credential subject and extracts identifiers for the entities it references. The bridge's `extractConformityClaim` and `extractConformityClaimWithProvenance` methods run separately, projecting the credential subject's conformity data into a `ConformityClaim`. Extraction happens once during credential issuance and the results are used for multiple purposes:

- **CVC validation** — the extracted conformity claim (scheme, profile, criteria) is compared against the available conformity vocabulary profiles to verify that all required criteria are present in the credential's attestations. This produces advisory warnings, never blocking errors.
- **Database linking** — the entity identifiers `extractRefs` returns (organisation, facility, product) are matched against existing database records, creating relationships between the credential and the entities it describes
- **IDR publishing** — the entity identifiers `extractRefs` returns are used to publish links via the [identity resolver service](../services/identity-resolver-service/index.md), making the credential discoverable by the entity's identifier

Extraction is API-driven: it happens automatically during the issuance flow, not through user interaction.

### Validation

For credential types that include conformity data (DCC, DPP, DFR), bridges extract conformity references that can be validated against the available conformity vocabulary profiles (system-provisioned or tenant-imported). For Digital Conformity Credentials specifically, the system can verify that a credential's attestations cover all required criteria for a given conformity profile. See [Conformity Handling](./conformity-handling) for details on how this works.

## How extensions inherit bridges

[Extensions](../api/data-models#untp-core-data-models-and-extensions) are custom variants that build on top of a UNTP core data model. Because extensions are expected to retain the core properties defined by the parent — they add fields but should not remove them — the same bridge that works for the core data model can also be applied to any extension of that type and version on a best-effort basis.

This means an extension automatically gets population, extraction, and validation capabilities for its core properties without needing its own bridge. The bridge extracts what it can find — if an optional core property is absent from the extension's payload, the bridge simply skips it.

## Further reading

- [Bridge Architecture](./bridge-architecture) — the technical implementation: interfaces, the delta pattern, version composition, and the registry
- [Conformity Handling](./conformity-handling) — how conformity data flows through different credential types and how CVC validation works
- [Conformity Vocabulary Catalogue](./conformity-vocabulary-catalogue) — where conformity schemes come from, how they refresh, and what a tenant can see
- [Adding a Bridge](./adding-a-bridge) — step-by-step guide for adding support for a new UNTP version or credential type
