---
sidebar_position: 4
title: Adding a Bridge
---

# Adding a Bridge

This guide walks through adding a data model bridge for a new version of a UNTP core data model. The process follows the same [delta pattern](./bridge-architecture#the-delta-pattern) used by the existing bridges.


## When you need a new bridge

You need to add a bridge when a new version of the UNTP specification is released.

## When you don't need one

If a new UNTP version has **no structural changes** for a given credential type — the fields are in the same positions with the same names — you don't need new builder or extractor logic. Instead, create a version directory with a single file that re-exports the previous version. This is a single line of code with no duplication and no new tests needed for the bridge logic itself — only a registry entry.

## Where things live

Each credential type has a directory under `data-models/`, and each version has its own subdirectory containing its builder, extractor, and version spec:

```
packages/services/src/data-model-bridges/
├── primitives/                     # Shared building blocks
└── data-models/
    └── dpp/
        └── versions/
            ├── v060/
            │   ├── builder.ts      # Builds credential subject
            │   ├── builder.test.ts
            │   ├── extractor.ts    # Extracts entity + conformity refs
            │   ├── extractor.test.ts
            │   └── index.ts        # Pairs builder + extractor
            ├── v061/
            │   └── index.ts        # Re-exports v060 (identical)
            └── v070/               # ← new version goes here
                ├── builder.ts
                ├── extractor.ts
                └── index.ts
```

## Steps

### 1. Create the version directory

Under the credential type's `versions/` directory, create a new directory for the version (e.g., `v070/`).

### 2. Write the builder

The builder is a function that receives entity data (organisation, facility, product, conformity selections) and returns a credential subject in the correct structure for that version. Follow the existing builders as reference:

- Use the shared primitives from `primitives/` for common structures (party objects, identifier schemes, locations, addresses)
- Only use the entity fields relevant to the credential type — silently ignore the rest
- For conformity data, route each input to the correct location within the credential subject (see [Conformity Handling](./conformity-handling#how-conformity-data-is-routed))

If the builder logic hasn't changed from the previous version, import and reuse it directly — no need to duplicate.

### 3. Write the extractor

The extractor is a function that receives a credential subject and returns the entity identifiers and conformity references it contains. Follow the existing extractors as reference:

- Return only the fields that could be successfully extracted
- Handle missing or undefined fields gracefully — return an empty result if nothing can be extracted, never throw
- For conformity data, extract from the same locations the builder writes to

If the extractor logic hasn't changed from the previous version, import and reuse it directly.

### 4. Create the version spec

The version spec pairs the builder and extractor together. Create an `index.ts` in the version directory that imports both functions and exports a named spec constant.

If reusing functions from a previous version, the delta pattern makes this straightforward — import the previous version's functions and override only what changed.

### 5. Register in the bridge registry

Add the new version spec to `bridge-registry.ts`. The registry maps credential type and version strings to bridge instances. Add an entry for the new version alongside the existing ones.

### 6. Add tests

Builder and extractor tests are parameterised across all supported versions. Add the new version to the existing test parameterisation so it runs against the same test cases.

If the new version introduces structural changes, add test cases that cover the differences. Both builders and extractors are pure functions — no mocking required.

### 7. Update form configuration (if needed)

If the new version changes which entities a credential type requires (e.g., a credential type now requires a facility where it previously didn't), update the entity requirements in the form-config route handler.

## Adding a new UNTP core data model

If the UNTP specification introduces an entirely new core data model type:

1. Create a new directory under `data-models/` (e.g., `data-models/new-type/`)
2. Create the first version directory with builder, extractor, and version spec
3. Add the new type to the registry in `bridge-registry.ts`
4. Add entity requirements to the form-config route handler
5. Write comprehensive builder and extractor tests

## Reference

The existing bridges in the [services package](https://github.com/uncefact/tests-untp/tree/next/packages/services/src/data-model-bridges) serve as the best reference for implementation patterns.
