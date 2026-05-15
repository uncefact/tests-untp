# `@uncefact/untp-utils` release notes

User-facing release notes for `@uncefact/untp-utils`. Each entry frames what
the release lets you do, not how it does it. For a technical, per-change
record see [CHANGELOG.md](./CHANGELOG.md).

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
