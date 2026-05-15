# Changelog

All notable changes to `@uncefact/untp-utils` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/) and the version
numbers follow semantic versioning. The package ships via the
`untp-utils-v<X.Y.Z>` tag-triggered publish workflow described in
[ADR 031](../../docs/adrs/031-per-package-tag-triggered-npm-release.md).

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
