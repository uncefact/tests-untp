# Changelog

All notable changes to `@uncefact/untp-utils` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/) and the version
numbers follow semantic versioning. The package ships via the
`untp-utils-v<X.Y.Z>` tag-triggered publish workflow described in
[ADR 031](../../docs/adrs/031-per-package-tag-triggered-npm-release.md).

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
