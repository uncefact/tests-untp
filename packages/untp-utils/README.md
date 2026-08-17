# @uncefact/untp-utils

Shared utility primitives for UNTP packages and consumers.

## Installation

```bash
npm install @uncefact/untp-utils
```

## Sub-entries

The package root exports only `StructuredError`, the base class every
sub-entry throws from. Each capability is imported from its own subpath so a
consumer only pulls in the dependencies it needs.

| Subpath                                      | Provides                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@uncefact/untp-utils/multibase-digest`      | `MultibaseDigest`: encode, decode and verify multibase-encoded multihashes.                   |
| `@uncefact/untp-utils/artefacts`             | UNTP schema, context and docs URL helpers, and `detectVersionFromContext`.                    |
| `@uncefact/untp-utils/conformity-vocabulary` | Parses a UNTP conformity scheme or catalogue and validates a conformity claim against it.     |
| `@uncefact/untp-utils/validation`            | Validates a payload against JSON Schema and expands it as JSON-LD, both guarded against SSRF. |
| `@uncefact/untp-utils/loaders`               | The schema and JSON-LD document loaders `validation` runs on.                                 |
| `@uncefact/untp-utils/resolvers`             | IP-pinned document fetching with a conditional-fetch skip chain.                              |
| `@uncefact/untp-utils/node`                  | `validatePublicUrl`, the SSRF guard the other sub-entries fetch through.                      |
| `@uncefact/untp-utils/cache`                 | `createInMemoryTtlCache`, a bounded in-memory TTL cache.                                      |
| `@uncefact/untp-utils/http-headers`          | HTTP header parsing, and the default `User-Agent` guarded fetches send.                       |

Every sub-entry throws a typed error class on failure rather than returning
an outcome object. See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for what each
release changes and [CHANGELOG.md](./CHANGELOG.md) for the full history.

## MultibaseDigest

Encode, decode and verify multibase-encoded multihashes.

```ts
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';

// Hash some data, wrap as a multihash, encode as a multibase string.
const digest = await MultibaseDigest.fromData(new TextEncoder().encode('hello'), {
  algorithm: 'sha2-256',
  base: 'base58btc',
});

digest.toString(); // e.g. "zQmYwAPJzv5..." (base58btc)
digest.toString('base64'); // e.g. "mEiBL..."        (re-encoded, no rehash)

// Parse a multibase string. Algorithm and encoding are read from the string.
const parsed = MultibaseDigest.fromString(digest.toString());
parsed.algorithm; // "sha2-256"
parsed.base; // "base58btc"

// Verify against original data.
await parsed.verify(new TextEncoder().encode('hello')); // true | false
```

Supported algorithms: `sha2-256`, `sha2-512`.

Supported multibase encodings: `base58btc`, `base64`.
