# `@uncefact/untp-utils` release notes

User-facing release notes for `@uncefact/untp-utils`. Each entry frames what
the release lets you do, not how it does it. For a technical, per-change
record see [CHANGELOG.md](./CHANGELOG.md).

## 0.2.0 - 2026-08-17

0.1.0 published one class, for content digests. 0.2.0 is the release where this package becomes the shared toolkit the UNTP projects actually build on, carrying the pieces that were previously duplicated in the reference implementation and the services package.

The headline changes: every remote document this package fetches now goes through an SSRF guard that resolves the hostname, checks it against private and reserved ranges, and pins the connection to the address it checked. Validation of JSON-LD and JSON Schema moved here, and reports failures precisely enough to tell a caller which field broke which rule. Conformity schemes and catalogues can be parsed and claims validated against them. And every sub-entry now signals failure by throwing a typed error class rather than returning an outcome object, which is the one change that touches code written against 0.1.0.

- Package: [@uncefact/untp-utils on npm](https://www.npmjs.com/package/@uncefact/untp-utils) (`npm install @uncefact/untp-utils@0.2.0`)
- Upgrading from 0.1.0: one import path changes. `MultibaseDigest` is no longer re-exported from the package root, so `import { MultibaseDigest } from '@uncefact/untp-utils'` becomes `import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest'`. Nothing else that 0.1.0 published moved.
- Install footprint: the package now declares six runtime dependencies where 0.1.0 declared one. `multiformats` is joined by `ajv`, `ajv-formats`, `jsonld`, `ipaddr.js` and `undici`, and npm installs all of them whichever subpath you import. The package is still ESM only.

### The root entry carries the error base class, not the digest

0.1.0's root entry existed to re-export `MultibaseDigest`, so `@uncefact/untp-utils` and `@uncefact/untp-utils/multibase-digest` were interchangeable. With nine sub-entries now in the package, a root barrel that re-exported them all would pull `ajv`, `jsonld` and `undici` into a consumer who only wanted a digest.

The root now exports `StructuredError` and its companion types, the base class every sub-entry throws from, and nothing else. `MultibaseDigest` is reached through its own subpath, where it has always also been available, with the same class, the same factory methods, and the same exported types it had at 0.1.0. It gained two new factories, `fromText` and `fromHex`.

### Remote documents are fetched through a guard

A library that fetches a URL a credential handed it is a library that can be pointed at the network it is running inside. Anything in this package that fetches a remote document now goes through a single guarded path. The hostname is resolved first and checked against private and reserved ranges, and the connection is pinned to the address that was checked, so neither a redirect nor a DNS change between the check and the connect can reach an internal address.

That covers JSON-LD `@context` fetches and JSON Schema fetches made on your behalf during validation, and anything fetched directly through `@uncefact/untp-utils/resolvers`, which also carries a conditional-fetch skip chain so an unchanged document costs a `304` rather than a download. Fetches send a `User-Agent`, overridable per call or by environment. `@uncefact/untp-utils/node` exposes the check on its own as `validatePublicUrl` for a URL you want to vet without fetching.

### Validation failures say what failed and where

`@uncefact/untp-utils/validation` validates a payload against JSON Schema and expands it as JSON-LD. Both were previously inside the services package, where nothing else could reach them.

A failure throws an error carrying a code, the value it received, what it expected, and a JSON pointer to the part of the document at fault. That is enough to put the field and the reason into your own response rather than a stack trace. Where the underlying JSON-LD processor buries the real cause in its own proprietary error shape, it is rehydrated onto the native `cause` chain, so an SSRF rejection during expansion is reachable by walking `error.cause` like any other error. `describeJsonLdFailure` reduces one of those to a single plain sentence.

### Conformity schemes and catalogues parse into typed results

`@uncefact/untp-utils/conformity-vocabulary` parses a UNTP conformity scheme or a catalogue of them, and validates a conformity claim against the parsed result, reporting every criterion and topic that does not line up. Topic validation checks every topic a criterion declares rather than the first, and v0.7.0 DCC extraction follows the published spec artefacts rather than the v0.6 shape.

### Failure is thrown, not returned

At 0.1.0 there was nothing here to fail. As the package grew, its sub-entries returned outcome objects that every caller had to unpack and translate before it could act, and the same three lines appeared at every call site.

Every sub-entry now throws a typed error class instead. Catch a concrete class to handle one case, a sub-entry's base class to handle a family, or `StructuredError` for anything this package reports. The structured payload is preserved on the thrown class, so nothing is lost in the change. The reasoning is recorded in ADR 035.

### Smaller changes

- **The in-memory cache takes a size bound.** `createInMemoryTtlCache` accepts an optional `maxEntries` and evicts expired entries first, then the least recently used, so a long-running process caching contexts has a ceiling.
- **`./artefacts` builds UNTP URLs.** Schema, context and specification-page URLs for a given UNTP version, rather than string-concatenating them at each call site. `detectVersionFromContext` moved here from the root entry.
- **`./schema-loaders` was renamed to `./loaders`,** and its `make*` factories to `create*`. Neither name appeared in a published release, so no import that ever shipped is affected.

## 0.1.0 — 2026-05-15

First public release.

### Self-describing content digests, in one place

UNTP credentials use multibase-encoded multihash digests
(`digestMultibase`) to assert the integrity of content they link to —
render templates, attestations, etc. Up to now,
every UNTP project that needed to produce or verify one of those digests
had its own short, hand-rolled implementation. This release factors that
into a single library so the reference implementation, the playground,
and any third-party integration verify against the same code path.

### A small, focused API

One class, three factory methods, and a `.verify()`. You can:

- Hash bytes and get a digest (`MultibaseDigest.fromData`).
- Wrap a digest you already have (`MultibaseDigest.fromDigest`).
- Parse a digest that arrived as a string from somewhere else
  (`MultibaseDigest.fromString`).
- Re-encode between `base58btc` and `base64` without re-hashing
  (`.toString('base64')`).
- Verify content against an existing digest (`.verify(bytes)`) without
  having to remember which hash algorithm was used — the multihash
  prefix tells the library, so callers don't.

The algorithms covered today are `sha2-256` and `sha2-512`; the
encodings are `base58btc` (the `z…` form most common in UNTP credentials)
and `base64` (the `m…` form). New algorithms or encodings are additive
and don't change existing call sites.

### Designed to be the one true implementation

If you produce a digest with this library and someone else verifies it
with this library, you don't need to coordinate the algorithm or
encoding ahead of time — the multihash prefix on the digest carries
that information. That's the property that lets us replace the
hand-rolled implementations across the repo with one shared library
and stop worrying about producer/verifier drift.

### Where to install

```bash
npm install @uncefact/untp-utils
```

### Where to learn more

- API documentation: see `CHANGELOG.md` for the full public surface of
  this release.
- Multibase specification: <https://github.com/multiformats/multibase>
- Multihash specification: <https://github.com/multiformats/multihash>
