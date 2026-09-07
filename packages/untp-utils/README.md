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
| `@uncefact/untp-utils/bundled-artefacts`     | The bundled UNTP and VCDM schemas and contexts, keyed by published URL.                       |
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

## Bundled UNTP artefacts

The JSON Schemas and JSON-LD contexts for every UNTP release from 0.6.0 onwards (0.6.0, 0.6.1 and 0.7.0 today; core credential types, plus the 0.7.0 conformity scheme and identity resolver link set schemas), together with the W3C Verifiable Credentials Data Model v2 context and schema, ship inside the package under `artefacts/`, listed in `artefacts/manifest.json`. `createSchemaLoader` and `createJsonLdDocumentLoader` serve the bundled copy when the host cannot deliver one of those URLs (its name does not resolve, it cannot be reached, it answers a non-2xx status, it returns a body that is not JSON, or it exceeds the resolver's size, redirect or time bounds), and tell the consumer through `onBundledFallback` so it can log the outage. Two failures are deliberately not covered and surface exactly as before: a URL the SSRF guard refused (`url.private-address`, `url.private-hostname`, `url.unsupported-scheme` or `url.invalid` anywhere on the cause chain), because a UNTP host resolving to a private address is a signal the operator must see, and any error that is not a typed resolver or resolution failure, because a bug in the fetch path must not read as an outage. The 0.6.x contexts are indexed under both URLs the host publishes them at (`.../dpp/0.6.1/`, which the schemas declare, and `.../dpp/0.6.1/context/`). `isHostDeliveryFailure` is the rule, exported for consumers that want the same split. Pass `bundledFallback: false` to switch the fallback off. URLs the bundle does not carry fail exactly as before.

Consumers can also read the bundle directly through `@uncefact/untp-utils/bundled-artefacts`, keyed by the published URL, for example to validate against a schema with no network at all:

```ts
import { findBundledArtefact, loadBundledArtefacts } from '@uncefact/untp-utils/bundled-artefacts';

const linksetSchema = await findBundledArtefact(
  'https://untp.unece.org/artefacts/schema/v0.7.0/idr/LinksetSchema.json',
);
const everything = await loadBundledArtefacts(); // ReadonlyMap<url, artefact>
```

The raw JSON files and `artefacts/manifest.json` (URL, file, source and sha256 per artefact) ship in the package too.

Published artefacts are immutable once released, so the bundle only grows when a new UNTP version is released. `scripts/refresh-artefacts.mjs` fetches every artefact from its source of truth (the specification repository at the release tag for 0.7.0 and later, the publishing host for earlier versions), writes any it does not have yet, refuses to overwrite a bundled copy that differs from the published one, and regenerates the `src/bundle/` modules the loaders import.

```bash
pnpm --filter @uncefact/untp-utils artefacts:check     # dry run: compare the bundle with what is published; fails on any difference
pnpm --filter @uncefact/untp-utils artefacts:refresh   # add newly listed artefacts to the bundle
```

To add a version, add its entries to `ARTEFACTS` in the script and run `artefacts:refresh`. A bundled copy that differs from the published one is overwritten only with `node scripts/refresh-artefacts.mjs --force`, after the difference has been understood.
