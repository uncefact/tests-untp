# Changelog

All notable changes to `@uncefact/untp-utils` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/) and the version
numbers follow semantic versioning. The package ships via the
`untp-utils-v<X.Y.Z>` tag-triggered publish workflow described in
[ADR 031](../../docs/adrs/031-per-package-tag-triggered-npm-release.md).

## [0.3.0](https://github.com/uncefact/tests-untp/compare/untp-utils-v0.2.0...untp-utils-v0.3.0) (2026-09-11)

### ⚠ BREAKING CHANGES

- **validation:** `JsonLdFailureDescription` is now a union of `JsonLdContextFailure` and `JsonLdDocumentFailure`, and `kind` carries the third value `'context-invalid'`. `context-invalid` means the processor rejected the context content or could not use a scoped context; it does not by itself prove that a remote context was fetched. `jsonld.ContextUrlError`, including context-chain overflow, is now described as `'context-fetch'` rather than `'document'`, and syntax-error `detail` uses the recognised code or a generic sentence instead of the original error message. An exhaustive `switch` over `kind` gains an unhandled case, and the type can no longer be extended with `interface X extends JsonLdFailureDescription` ([#1014](https://github.com/uncefact/tests-untp/pull/1014)) ([3ee4397e8](https://github.com/uncefact/tests-untp/commit/3ee4397e8))
- **validation:** `ValidateJsonLdOptions` is now a union of a build-a-loader branch and a caller-supplied-`documentLoader` branch rather than an interface. Object literals using the previously supported option keys still type-check, but an unrelated property that collides with a newly reserved name such as `documentLoader` can now fail. Extending the type with `interface X extends ValidateJsonLdOptions` does not work ([#1014](https://github.com/uncefact/tests-untp/pull/1014)) ([3ee4397e8](https://github.com/uncefact/tests-untp/commit/3ee4397e8))
- **node:** a parseable URL with no hostname whose scheme the caller admitted through `allowedSchemes`, such as `validatePublicUrl('file:///tmp/example', { allowedSchemes: ['file'] })`, now throws `InvalidUrlError` rather than `PrivateHostnameError`; scheme rejection still precedes the hostname check ([#1034](https://github.com/uncefact/tests-untp/pull/1034)) ([59c952bb3](https://github.com/uncefact/tests-untp/commit/59c952bb3))
- **resolvers:** an abort-shaped transport rejection at the fetch or body-read boundary that arrives before this request's own deadline is now a `ResolverNetworkError`; the previous name-only classifier produced `ResolverTimedOutError`. Body-read failures outside that case and post-deadline aborts retain their previous classifications when they are `Error` instances; abort-shaped non-null objects, including plain-object rejections, are now recognised too. A defect inside `resolveDocument` now propagates as thrown rather than being wrapped as `ResolverNetworkError`; guard rejections already propagated unwrapped at 0.2.0. The total timeout also bounds the DNS wait ([#1034](https://github.com/uncefact/tests-untp/pull/1034)) ([59c952bb3](https://github.com/uncefact/tests-untp/commit/59c952bb3))
- **loaders:** loading a bundled UNTP or VCDM URL now succeeds through the fallback when a covered host-delivery failure occurs, and validation continues; a document that failed in 0.2.0 for want of the artefact now gets an ordinary validation result, pass or fail. Pass `bundledFallback: false` to restore the old behaviour. The optional `onBundledFallback` callback runs only when a bundled substitution is performed, not on cache hits, and the returned document carries no fallback marker ([#1013](https://github.com/uncefact/tests-untp/pull/1013)) ([73a8ac337](https://github.com/uncefact/tests-untp/commit/73a8ac337))
- **conformity-vocabulary:** required fields and optional fields read through `asNonEmptyString` by the scheme and catalogue parsers are now trimmed. A whitespace-only required `id` or `name` now throws `ConformitySchemeParseError` or `ConformityCatalogueParseError` with a `conformity-scheme.missing-required-field` or `conformity-catalogue.missing-required-field` failure, where 0.2.0 parsed and returned the whitespace. A value such as `"  Scheme  "` now parses to `"Scheme"` ([#980](https://github.com/uncefact/tests-untp/pull/980)) ([d269f9505](https://github.com/uncefact/tests-untp/commit/d269f9505))
- **node:** fetches to IPv6 addresses outside `2000::/3`, other than IPv4-mapped `::ffff:` addresses that remain accepted and are checked as IPv4, and to `3ffe::/16` are now refused where 0.2.0 admitted them. The dotted IPv4-compatible spelling is rejected by a textual check before parsing, while `::127.0.0.1` was already private at 0.2.0 ([#966](https://github.com/uncefact/tests-untp/pull/966)) ([8fba512fc](https://github.com/uncefact/tests-untp/commit/8fba512fc))

### Features

- **bundled-artefacts:** add the `./bundled-artefacts` sub-entry. It carries the five core credential schemas: Digital Product Passport, Digital Conformity Credential, Digital Facility Record, Digital Identity Anchor and Digital Traceability Event, with their per-type contexts for 0.6.0 and 0.6.1. For 0.7.0 it adds the Conformity Scheme and Identity Resolver link set schemas and the unified context. The W3C VCDM v2 context and schema are included too; extension schemas and contexts hosted elsewhere are not bundled. The sub-entry exports `findBundledArtefact`, `normaliseArtefactUrl`, `loadBundledArtefacts`, `bundledUntpVersions`, `bundledSchema`, `bundledContext`, `bundledLinkSetSchema`, `bundledVcdmContext`, `bundledVcdmSchema`, `isHostDeliveryFailure`, and the `BundledFallbackEvent` and `BundledFallbackOptions` types. `./validation` and `./loaders` re-export the `BundledFallbackEvent` and `BundledFallbackOptions` types; `./loaders` also re-exports `isHostDeliveryFailure`, which is exported from `./bundled-artefacts` too ([#1013](https://github.com/uncefact/tests-untp/pull/1013)) ([73a8ac337](https://github.com/uncefact/tests-untp/commit/73a8ac337))
- **loaders:** serve the bundled copy when a covered host-delivery failure occurs, cache it as if fetched, and invoke the optional `onBundledFallback` callback when a substitution is performed. Cache hits do not invoke it, and returned documents carry no fallback marker. A URL the SSRF guard refused, an untyped error, and any URL the bundle does not carry fail exactly as before ([#1013](https://github.com/uncefact/tests-untp/pull/1013)) ([73a8ac337](https://github.com/uncefact/tests-untp/commit/73a8ac337))
- **loaders:** `createSchemaLoader` takes a second `BundledFallbackOptions` parameter, and `JsonLdDocumentLoaderOptions` extends it ([#1013](https://github.com/uncefact/tests-untp/pull/1013)) ([73a8ac337](https://github.com/uncefact/tests-untp/commit/73a8ac337))
- **validation:** add `expandJsonLd`, returning the expanded node array, alongside `validateJsonLd` ([#1014](https://github.com/uncefact/tests-untp/pull/1014)) ([3ee4397e8](https://github.com/uncefact/tests-untp/commit/3ee4397e8))
- **validation:** accept a caller-supplied `documentLoader`, and export the `JsonLdDocumentLoader` type it must satisfy ([#1014](https://github.com/uncefact/tests-untp/pull/1014)) ([3ee4397e8](https://github.com/uncefact/tests-untp/commit/3ee4397e8))
- **validation:** export `SAFE_EVENT_FIELDS` and `SafeJsonLdFields`, the allowlist of jsonld.js detail fields a failure description may echo, and carry `source`, `fields`, `code` and `url` on the described failure ([#1014](https://github.com/uncefact/tests-untp/pull/1014)) ([3ee4397e8](https://github.com/uncefact/tests-untp/commit/3ee4397e8))
- **validation:** set `code: 'invalid document shape'` on the `document`-kind failure for a JSON-LD document that fails shape validation before expansion, so consumers can branch on the code ([#1044](https://github.com/uncefact/tests-untp/pull/1044)) ([78efe76aa](https://github.com/uncefact/tests-untp/commit/78efe76aa))
- **node:** add `allowPrivateAddresses` to `ValidatePublicUrlOptions`, permitting private and reserved destinations while scheme checking, record parsing and address pinning stay active ([#1034](https://github.com/uncefact/tests-untp/pull/1034)) ([59c952bb3](https://github.com/uncefact/tests-untp/commit/59c952bb3))
- **node:** `validatePublicUrl` returns `ValidatedAddresses`, which extends `ResolvedAddress` with every validated record in resolver order ([#1034](https://github.com/uncefact/tests-untp/pull/1034)) ([59c952bb3](https://github.com/uncefact/tests-untp/commit/59c952bb3))
- **node, resolvers:** accept an optional `lookup` for hostname resolution on `validatePublicUrl` and `resolveDocument`, and also on `createJsonLdDocumentLoader` through the same options inheritance that already carries `allowPrivateAddresses`. The type is exported as `PublicUrlLookup` from `./node`; a supplied lookup's answers still pass the address guard ([#1053](https://github.com/uncefact/tests-untp/pull/1053)) ([224f02056](https://github.com/uncefact/tests-untp/commit/224f02056))
- **resolvers:** add `allowPrivateAddresses` to `ResolveDocumentOptions`, which `JsonLdDocumentLoaderOptions` extends, so the JSON-LD document loader accepts it too. `createSchemaLoader` does not. `ResolverTooManyRedirectsError` also gains an optional `lastHopUrl` ([#1034](https://github.com/uncefact/tests-untp/pull/1034)) ([59c952bb3](https://github.com/uncefact/tests-untp/commit/59c952bb3))
- **resolvers:** expose `url` on `ResolverHttpError` and `ResolverInvalidJsonError` so a caller can report the final URL of a failed resolution ([#969](https://github.com/uncefact/tests-untp/pull/969)) ([dc939f66a](https://github.com/uncefact/tests-untp/commit/dc939f66a))
- **common:** add the `./common` sub-entry with `asDateTime`, `asNonEmptyString` and `makeRequireString`. `asDateTime` is new; the other two existed in the package but were unreachable from any subpath ([#980](https://github.com/uncefact/tests-untp/pull/980)) ([d269f9505](https://github.com/uncefact/tests-untp/commit/d269f9505))
- **common:** add `evaluateValidityWindow` and the `ValidityWindowOutcome` type, judging a credential's VCDM 2.0 `validFrom` and `validUntil` claims against a point in time and reporting `pass` or a `fail` reason of `expired`, `not_yet_valid` or `unreadable_bound` ([#1055](https://github.com/uncefact/tests-untp/pull/1055)) ([95956608f](https://github.com/uncefact/tests-untp/commit/95956608f))
- **artefacts:** add `buildLinkSetSchemaUrl`, the published Identity Resolver link set schema URL for a UNTP version ([#1019](https://github.com/uncefact/tests-untp/pull/1019)) ([9a64cda83](https://github.com/uncefact/tests-untp/commit/9a64cda83))

### Bug Fixes

- **node:** classify IPv6 default-deny. An address counts as public only inside the allocated `2000::/3` block and outside `ipaddr.js`'s named special ranges; `3ffe::/16` is denied explicitly. IPv4-mapped `::ffff:a.b.c.d` addresses are checked as IPv4 and remain public when the embedded IPv4 is public. The dotted IPv4-compatible spelling is rejected by a textual check before parsing, and the byte layout covers both embedded-IPv4 forms. `::127.0.0.1` was already private at 0.2.0 ([#966](https://github.com/uncefact/tests-untp/pull/966)) ([8fba512fc](https://github.com/uncefact/tests-untp/commit/8fba512fc))
- **node:** derive each resolver record's address family from the address string and reject a record that is unparseable or contradicts the family the resolver claimed, as `ResolutionFailedError`, rather than reconciling it ([#966](https://github.com/uncefact/tests-untp/pull/966)) ([8fba512fc](https://github.com/uncefact/tests-untp/commit/8fba512fc))
- **resolvers:** pin the connector to every validated address rather than the first, so a name resolving to both `::1` and `127.0.0.1` no longer refuses a connection an unpinned request would have made ([#1034](https://github.com/uncefact/tests-untp/pull/1034)) ([59c952bb3](https://github.com/uncefact/tests-untp/commit/59c952bb3))
- **resolvers:** copy the caller's headers in both `withUserAgent` branches, including when an explicit `User-Agent` is supplied. A throwing getter in that caller-owned object is now evaluated outside transport error classification ([#1034](https://github.com/uncefact/tests-untp/pull/1034)) ([59c952bb3](https://github.com/uncefact/tests-untp/commit/59c952bb3))
- **resolvers:** classify an abort-shaped transport rejection at the fetch or body-read boundary that arrives before this request's own deadline as `ResolverNetworkError` rather than the previous name-only `ResolverTimedOutError`. Body-read failures outside that case and post-deadline aborts retain their previous classifications when they are `Error` instances; abort-shaped non-null objects, including plain-object rejections, are now recognised too. A defect inside `resolveDocument` now propagates as thrown rather than being wrapped as `ResolverNetworkError`; guard rejections already propagated unwrapped at 0.2.0. Request-construction rejections from undici, such as a redirect hop carrying userinfo, still arrive as `ResolverNetworkError` ([#1034](https://github.com/uncefact/tests-untp/pull/1034)) ([59c952bb3](https://github.com/uncefact/tests-untp/commit/59c952bb3))
- **conformity-vocabulary:** trim required fields and optional fields read through `asNonEmptyString` by the scheme and catalogue parsers. A whitespace-only optional value is reported as absent, while a whitespace-only required value produces a `missing-required-field` failure instead of returning the whitespace ([#980](https://github.com/uncefact/tests-untp/pull/980)) ([d269f9505](https://github.com/uncefact/tests-untp/commit/d269f9505))
- add the missing `typesVersions` entries so every subpath resolves types under `moduleResolution: node10`: `common` ([#980](https://github.com/uncefact/tests-untp/pull/980)) ([d269f9505](https://github.com/uncefact/tests-untp/commit/d269f9505)), `bundled-artefacts` ([#1013](https://github.com/uncefact/tests-untp/pull/1013)) ([73a8ac337](https://github.com/uncefact/tests-untp/commit/73a8ac337)) and `artefacts` ([#1019](https://github.com/uncefact/tests-untp/pull/1019)) ([9a64cda83](https://github.com/uncefact/tests-untp/commit/9a64cda83))

### Miscellaneous

- add `artefacts:check` and `artefacts:refresh` scripts, which compare the bundle with what the hosts publish and add newly listed artefacts ([#1013](https://github.com/uncefact/tests-untp/pull/1013)) ([73a8ac337](https://github.com/uncefact/tests-untp/commit/73a8ac337))
- use the repository's package manager in the package README ([#947](https://github.com/uncefact/tests-untp/pull/947)) ([6c43342df](https://github.com/uncefact/tests-untp/commit/6c43342df))

## [0.2.0](https://github.com/uncefact/tests-untp/compare/untp-utils-v0.1.0...untp-utils-v0.2.0) (2026-08-17)

### ⚠ BREAKING CHANGES

- **root entry:** the package root no longer re-exports `MultibaseDigest`. Import it from `@uncefact/untp-utils/multibase-digest` instead. The subpath, the class and its exported types are unchanged; only the root barrel dropped the re-export ([#682](https://github.com/uncefact/tests-untp/pull/682)) ([c8e67e968](https://github.com/uncefact/tests-untp/commit/c8e67e968))

### Features

- **artefacts:** add the `./artefacts` sub-entry with UNTP schema, context and docs URL helpers, and move `detectVersionFromContext` into it ([#693](https://github.com/uncefact/tests-untp/pull/693)) ([0cb93b76e](https://github.com/uncefact/tests-untp/commit/0cb93b76e))
- **cache:** bound `createInMemoryTtlCache` with an optional `maxEntries`, evicting expired entries first then least-recently-used ([#891](https://github.com/uncefact/tests-untp/pull/891)) ([0d7bfc42f](https://github.com/uncefact/tests-untp/commit/0d7bfc42f))
- **conformity-vocabulary:** add the sub-entry with a scheme parser and claim validator ([#667](https://github.com/uncefact/tests-untp/pull/667)) ([d94ac72ac](https://github.com/uncefact/tests-untp/commit/d94ac72ac))
- **conformity-vocabulary:** add `parseConformityCatalogue` and extract shared parser helpers ([#684](https://github.com/uncefact/tests-untp/pull/684)) ([779e0ecf4](https://github.com/uncefact/tests-untp/commit/779e0ecf4))
- **conformity-vocabulary:** throw `ConformityVocabularyError` subclasses instead of returning coded outcomes (ADR-035) ([#683](https://github.com/uncefact/tests-untp/pull/683)) ([711090e55](https://github.com/uncefact/tests-untp/commit/711090e55))
- **http-headers:** add the `./http-headers` sub-entry and send a `User-Agent` on every guarded fetch, overridable per call or by environment ([#891](https://github.com/uncefact/tests-untp/pull/891)) ([0d7bfc42f](https://github.com/uncefact/tests-untp/commit/0d7bfc42f))
- **multibase-digest:** add the `fromText` and `fromHex` static factories ([#655](https://github.com/uncefact/tests-untp/pull/655)) ([8c04d01cb](https://github.com/uncefact/tests-untp/commit/8c04d01cb))
- **node:** add the `./node` sub-entry with the `validatePublicUrl` SSRF guard ([#674](https://github.com/uncefact/tests-untp/pull/674)) ([d0fb379e9](https://github.com/uncefact/tests-untp/commit/d0fb379e9))
- **node:** throw `UrlValidationError` subclasses instead of returning an outcome (ADR-035) ([#680](https://github.com/uncefact/tests-untp/pull/680)) ([9499fe54a](https://github.com/uncefact/tests-untp/commit/9499fe54a))
- **resolvers:** add the `./resolvers` sub-entry with IP-pinned fetch and a conditional-fetch skip chain ([#675](https://github.com/uncefact/tests-untp/pull/675)) ([ecdb546c3](https://github.com/uncefact/tests-untp/commit/ecdb546c3))
- **root:** add the `StructuredError` base class for the ADR-035 rollout ([#679](https://github.com/uncefact/tests-untp/pull/679)) ([b0f577078](https://github.com/uncefact/tests-untp/commit/b0f577078))
- **validation:** add the `./validation` and `./loaders` sub-entries, migrating the JSON-LD and JSON Schema primitives out of the services package ([#668](https://github.com/uncefact/tests-untp/pull/668)) ([6f144a7f5](https://github.com/uncefact/tests-untp/commit/6f144a7f5))
- **validation:** throw `JsonLdValidationError` and `SchemaValidationError` subclasses instead of returning coded outcomes, and add the `./cache` sub-entry (ADR-035) ([#681](https://github.com/uncefact/tests-untp/pull/681)) ([eeeae718b](https://github.com/uncefact/tests-untp/commit/eeeae718b))
- **validation:** add `describeJsonLdFailure`, which turns a JSON-LD expansion error into one plain sentence naming what failed ([#898](https://github.com/uncefact/tests-untp/pull/898)) ([3d915ea98](https://github.com/uncefact/tests-untp/commit/3d915ea98))

### Bug Fixes

- **conformity-vocabulary:** validate every conformity topic each criterion declares ([#700](https://github.com/uncefact/tests-untp/pull/700)) ([e6a5b8c33](https://github.com/uncefact/tests-untp/commit/e6a5b8c33))
- **conformity-vocabulary:** align v0.7.0 DCC conformity topic extraction and validation with the published spec artefacts ([#752](https://github.com/uncefact/tests-untp/pull/752)) ([c16b87235](https://github.com/uncefact/tests-untp/commit/c16b87235))
- **validation:** guard JSON-LD `@context` and JSON Schema fetches against SSRF ([#733](https://github.com/uncefact/tests-untp/pull/733)) ([479065749](https://github.com/uncefact/tests-untp/commit/479065749))
- **validation:** surface SSRF rejections from JSON-LD expansion on the native error cause chain ([#838](https://github.com/uncefact/tests-untp/pull/838)) ([a76c30ebd](https://github.com/uncefact/tests-untp/commit/a76c30ebd))

### Miscellaneous

- document that `validateConformityClaim`'s warning pointers are relative to the claim, so a consumer that synthesises the claim rather than taking it as a sub-document maps each field to its own source path instead of assuming a prefix ([#919](https://github.com/uncefact/tests-untp/pull/919)) ([c978d8443](https://github.com/uncefact/tests-untp/commit/c978d8443))
- rename the `./schema-loaders` subpath to `./loaders`, and the `make*` factories to `create*`. Neither name shipped in a release, so no published import path changes ([227049ff7](https://github.com/uncefact/tests-untp/commit/227049ff7))

### Notes

- The dependency footprint grew from one runtime dependency to six. `multiformats` is joined by `ajv`, `ajv-formats`, `jsonld`, `ipaddr.js` and `undici`, installed for every consumer regardless of which subpath they import.
- Still ESM only, and still no `engines` constraint.

## [0.1.0] - 2026-05-15

Initial public release.

### Public surface

Entry point (`@uncefact/untp-utils`) re-exports everything from
`@uncefact/untp-utils/multibase-digest`. The package today contains a single
module; the dedicated subpath export exists so future additions can be
imported independently without expanding the top-level barrel.

`@uncefact/untp-utils/multibase-digest`

- `MultibaseDigest` class — immutable value object wrapping a multibase-
  encoded multihash digest.
  - `static async fromData(data: Uint8Array, opts: MultibaseDigestOptions): Promise<MultibaseDigest>` hashes the input bytes with the chosen algorithm and returns the digest.
  - `static fromDigest(digest: Uint8Array, opts: MultibaseDigestOptions): MultibaseDigest` wraps an already-computed raw digest.
  - `static fromString(encoded: string): MultibaseDigest` parses a multibase-encoded multihash string. Accepts both `base58btc` (`z…`) and `base64` (`m…`) prefixes; rejects malformed inputs and unsupported algorithms.
  - `toString(base?: MultibaseEncoding): string` re-encodes without re-hashing. Defaults to the encoding the instance was constructed with.
  - `async verify(data: Uint8Array): Promise<boolean>` re-hashes the supplied bytes with the digest's algorithm and compares.
- `HashAlgorithm` type alias — `'sha2-256' | 'sha2-512'`.
- `MultibaseEncoding` type alias — `'base58btc' | 'base64'`.
- `MultibaseDigestOptions` type alias — `{ algorithm: HashAlgorithm; base: MultibaseEncoding }`.

### Notes

- Built on `multiformats@^13`. The library exists primarily to give other
  UNTP packages (reference implementation, services, playground) a single
  canonical implementation of multibase + multihash, so the same code
  produces and verifies digests on both sides of any integrity check.
- Built as ESM only. The package's `"type": "module"` declaration applies;
  CJS-mode consumers should either import via dynamic `import()` or run a
  bundler with ESM interop.

[0.1.0]: https://github.com/uncefact/tests-untp/releases/tag/untp-utils-v0.1.0
[0.2.0]: https://github.com/uncefact/tests-untp/releases/tag/untp-utils-v0.2.0
[0.3.0]: https://github.com/uncefact/tests-untp/releases/tag/untp-utils-v0.3.0
