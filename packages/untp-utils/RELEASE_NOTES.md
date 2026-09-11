# `@uncefact/untp-utils` release notes

User-facing release notes for `@uncefact/untp-utils`. Each entry frames what
the release lets you do, not how it does it. For a technical, per-change
record see [CHANGELOG.md](./CHANGELOG.md).

## 0.3.0 - 2026-09-11

0.2.0 made this package the shared toolkit the UNTP projects build on, and put
every remote fetch behind an SSRF guard. 0.3.0 is about what happens when the
network does not cooperate, and about giving the guard a second mode for the
cases where a private destination is the point.

The headline change is that the UNTP schemas and contexts now travel inside the
package. For 0.6.0 and 0.6.1, the bundle carries the five core credential
schemas: Digital Product Passport, Digital Conformity Credential, Digital
Facility Record, Digital Identity Anchor and Digital Traceability Event, with
their per-type contexts. For 0.7.0 it carries those five schemas plus the
Conformity Scheme and Identity Resolver link set schemas, with the unified
context. The W3C Verifiable Credentials Data Model v2 context and schema are
included too. Extension schemas and contexts hosted elsewhere are not bundled.
When a covered host-delivery failure occurs, validation serves the bundled copy
by default, so a UNTP host outage stops taking your credential validation down
with it. An optional `onBundledFallback` callback reports a substitution when it
is performed. Cache hits do not invoke the callback, and the returned document
has no fallback marker. The guard also gained an opt-in relaxed mode for callers
that legitimately fetch private addresses, it pins connections to every address
it validated rather than only the first, and its IPv6 classifier now denies by
default instead of trusting a library fallback. For tests and diagnostics, a
caller can now supply its own hostname lookup, typed as `PublicUrlLookup` and
exported from `./node`, to `validatePublicUrl`, `resolveDocument` and
`createJsonLdDocumentLoader` (which accepts it through the same options
inheritance that already carries `allowPrivateAddresses`); the guard still
checks every address that lookup returns.

- Package: [@uncefact/untp-utils on npm](https://www.npmjs.com/package/@uncefact/untp-utils) (`npm install @uncefact/untp-utils@0.3.0`)

### Upgrading from 0.2.0

No import path changes, and no exported name was removed or renamed. Seven
changes can need attention, listed below.

**1. `describeJsonLdFailure(...).kind` has a third value, and descriptions can
change.** `JsonLdFailureDescription` is now a union, and an exhaustive `switch`
gains a case:

```ts
switch (describeJsonLdFailure(error).kind) {
  case 'context-fetch':
    return retryLater();
  case 'context-invalid': // new in 0.3.0
    return inspectContextFailure();
  case 'document':
    return rejectPayload();
}
```

`context-invalid` means the processor rejected the context content or could not
use a scoped context. It does not by itself prove that a remote context was
fetched. `jsonld.ContextUrlError`, including context-chain overflow, is now
described as `context-fetch` rather than `document`. Syntax-error `detail` no
longer carries the original error message. It uses the recognised code or a
generic sentence instead. Consumers branching on the existing kinds or
matching the old `detail` text need to update.

`JsonLdFailureDescription` cannot be extended with an interface. Intersect
instead, or narrow on `kind` and extend one branch:

```ts
// 0.2.0
interface MyFailure extends JsonLdFailureDescription {
  requestId: string;
}

// 0.3.0
type MyFailure = JsonLdFailureDescription & { requestId: string };
```

**2. `ValidateJsonLdOptions` is a union too.** Either you hand in a
`documentLoader`, or you hand in the settings used to build one. Object literals
using the previously supported option keys still type-check, but an unrelated
property that collides with a newly reserved name such as `documentLoader` can
now fail. Extending the type no longer works, and the same intersection fixes
it:

```ts
// 0.2.0
interface MyOptions extends ValidateJsonLdOptions {
  tenantId: string;
}

// 0.3.0
type MyOptions = ValidateJsonLdOptions & { tenantId: string };
```

**3. A parseable URL with no hostname whose scheme you admit through
`allowedSchemes` now throws `InvalidUrlError`.** Scheme rejection still precedes
the hostname check, so this case requires a caller-supplied scheme
that produces an empty host:

```ts
// 0.2.0
try {
  await validatePublicUrl('file:///tmp/example', { allowedSchemes: ['file'] });
} catch (error) {
  error instanceof PrivateHostnameError; // true
}

// 0.3.0
try {
  await validatePublicUrl('file:///tmp/example', { allowedSchemes: ['file'] });
} catch (error) {
  error instanceof InvalidUrlError; // true
}
```

Catching the shared base class covers both releases:

```ts
catch (error) {
  if (error instanceof UrlValidationError) return refuse(error);
}
```

**4. Resolver timeout classification is narrower.** An abort-shaped transport
rejection at the fetch or body-read boundary that arrives before this request's
own deadline is now reported as `ResolverNetworkError`; the previous name-only
classifier reported `ResolverTimedOutError`. Body-read failures outside that
case and post-deadline aborts retain their previous classifications when they
are `Error` instances; abort-shaped non-null objects, including plain-object
rejections, are now recognised too. The
`totalTimeoutMs` setting also bounds the DNS wait, so a slow lookup now raises
`ResolverTimedOutError` at the deadline rather than blocking past it. A defect
inside `resolveDocument` now propagates as thrown rather than being wrapped as
`ResolverNetworkError`; a guard rejection remains a guard error.

**5. Bundled fallback changes the result for covered URLs.** Loading a bundled
UNTP or VCDM URL now succeeds through the fallback when a covered host-delivery
failure occurs, and validation continues. A document that failed in 0.2.0 for
want of the artefact now gets an ordinary validation result, pass or fail.
Switch that off per loader if you need the old behaviour:

```ts
const loader = createJsonLdDocumentLoader({ bundledFallback: false });
await validateJsonLd(credential, { bundledFallback: false });
```

The optional `onBundledFallback` callback runs only when a bundled substitution
is performed. Cache hits do not invoke it, and the returned document carries no
fallback marker.

**6. Conformity parser strings are trimmed.** Required fields and optional
fields read through `asNonEmptyString` by `parseConformityScheme` and
`parseConformityCatalogue` are now trimmed. In 0.2.0, a required `id` or `name`
of `"   "` parsed successfully and returned the whitespace. In 0.3.0 it throws
`ConformitySchemeParseError` or
`ConformityCatalogueParseError` with a
`conformity-scheme.missing-required-field` or
`conformity-catalogue.missing-required-field` failure. A value such as
`"  Scheme  "` now parses to `"Scheme"`.

**7. IPv6 default-deny refuses some destinations that 0.2.0 admitted.** Fetches
to IPv6 addresses outside `2000::/3`, other than IPv4-mapped `::ffff:` addresses
that remain accepted and are checked as IPv4, and to `3ffe::/16` are now
refused. The dotted IPv4-compatible spelling is rejected by a textual check
before parsing, while `::127.0.0.1` was already private at 0.2.0.

### The UNTP artefacts travel with the package

A validator that fetches its schemas at validation time is only as available as
the host publishing them. UNTP artefacts are immutable once released, so there
is no reason to depend on that.

For 0.6.0 and 0.6.1, the bundle carries the five core credential schemas:
Digital Product Passport, Digital Conformity Credential, Digital Facility
Record, Digital Identity Anchor and Digital Traceability Event, with their
per-type contexts. For 0.7.0 it carries those five schemas plus the Conformity
Scheme and Identity Resolver link set schemas, with the unified context. It
also carries the VCDM v2 context and schema. The set is listed in
`artefacts/manifest.json` with a source and a sha256 per file. Extension schemas
and contexts hosted elsewhere are not bundled.
`createSchemaLoader` and `createJsonLdDocumentLoader` reach for the bundled
copy when the host cannot deliver the URL: its name does not resolve, it cannot
be reached, it answers a non-2xx status, it returns a body that is not JSON, or
it exceeds the resolver's size, redirect or time bounds. The copy is cached like
a fetched one. Supply the optional `onBundledFallback` callback to observe a
substitution when it is performed. Cache hits do not invoke it, and the returned
document carries no fallback marker.

Two kinds of failure are deliberately not covered, and surface exactly as
before. A URL the SSRF guard refused stays refused, because a UNTP host
resolving to a private address is something an operator needs to see, not
something to paper over. And an error that is not a typed resolver failure
stays an error, because a bug in the fetch path must not read as an outage.
`isHostDeliveryFailure` is that split, exported, if you want to apply the same
rule yourself. `bundledFallback: false` turns the whole thing off.

You can also read the bundle directly, with no network at all:

```ts
import { findBundledArtefact } from '@uncefact/untp-utils/bundled-artefacts';

const schema = await findBundledArtefact('https://untp.unece.org/artefacts/schema/v0.7.0/idr/LinksetSchema.json');
```

The `./bundled-artefacts` subpath also exports `normaliseArtefactUrl`,
`loadBundledArtefacts`, `bundledUntpVersions`, `bundledSchema`, `bundledContext`,
`bundledLinkSetSchema`, `bundledVcdmContext`, `bundledVcdmSchema`,
`isHostDeliveryFailure`, and the `BundledFallbackEvent` and
`BundledFallbackOptions` types. It exports `findBundledArtefact` as the direct
lookup used above. The `./validation` and `./loaders` subpaths re-export the
`BundledFallbackEvent` and `BundledFallbackOptions` types; `./loaders` also
re-exports `isHostDeliveryFailure`, which `./bundled-artefacts` exports too.

### The guard has a relaxed mode, and pins every address it checked

Some callers fetch private addresses on purpose: a credential URL a user
supplied, pointing at a service inside their own network. Until now the only
way to allow that was not to use the guard, which also gave up scheme checking
and address pinning.

`validatePublicUrl` and the resolvers now take `allowPrivateAddresses`. Set it
to `true` and private, loopback and reserved destinations are permitted while
every other rule stays active: the scheme is still checked, resolver records
are still parsed and cross-checked against their claimed family, and the
connection is still pinned to an address that was validated. The default is
unchanged strict rejection, so nothing changes unless you ask for it. The
JSON-LD document loader accepts the option too, because its options extend the
resolver's; the schema loader does not take it.

Pinning also got more honest. A hostname can resolve to several addresses, and
only some of them may have a listener; `localhost` resolving to both `::1` and
`127.0.0.1` is the everyday case. `validatePublicUrl` now returns every
validated record in resolver order as `addresses`, and the resolvers offer all
of them to the connector. `address` and `family` still repeat the first entry,
so a caller that can use only one target keeps working unchanged.

### IPv6 is classified by denial, not by a library fallback

`ipaddr.js` reports `'unicast'` both for genuine public addresses and, as a
fallback, for space it has no name for. Treating that as public let
unallocated and IANA-reserved addresses through: `4000::1`, `fe00::1`,
`101::1` and the decommissioned 6bone block `3ffe::/16`. The IPv4-compatible
form `::127.0.0.1` was already private at 0.2.0.

An address now counts as public only when it sits inside the allocated
`2000::/3` Global Unicast block and matches none of the named special-purpose
ranges nested in it. IPv4-mapped addresses such as `::ffff:1.1.1.1` remain
accepted when the embedded IPv4 is public and are checked as IPv4. The dotted
IPv4-compatible spelling is rejected by a textual check before parsing, while
the byte layout classifies both embedded-IPv4 forms. If you were fetching a
host that resolves to one of the newly denied addresses, the guard now refuses
it. That was the bug.

### JSON-LD expansion, and failures that say which kind of failure

`expandJsonLd` joins `validateJsonLd`, returning the expanded node array
through the same guarded document loader and the same options.

You can now also hand either function your own `documentLoader`, for a caller
that already has one built and cached. The option shape became a union to
express that the two arrangements are alternatives: supply a loader, or supply
the settings used to build one, not both.

`describeJsonLdFailure` distinguishes a remote context fetch failure from a
context the processor rejected or could not use as a scoped context, so `kind`
now carries `'context-invalid'` alongside `'context-fetch'` and `'document'`.
`context-invalid` does not by itself prove that the remote context was fetched.
`jsonld.ContextUrlError`, including context-chain overflow, is now described as
`'context-fetch'` rather than `'document'`. Syntax-error `detail` uses the
recognised code or a generic sentence instead of the original error message.
The described failure also carries the jsonld.js code, the `@context` URL when
one is named, whether the cause was a syntax error or a safe-mode event, and the
allowlisted identifier fields. `SAFE_EVENT_FIELDS` is that allowlist, exported,
so you can see exactly which jsonld.js detail fields may ever be echoed to a
caller.
Shape validation failures also carry `code: 'invalid document shape'`, so a
consumer can branch on that code.

### Resolver failures are classified at the transport, and nowhere else

At the fetch and body-read boundaries, an abort-shaped transport rejection that
arrives before this request's own deadline is now a `ResolverNetworkError`; the
previous name-only classifier produced `ResolverTimedOutError`. Body-read
failures outside that case and post-deadline aborts retain their previous
classifications when they are `Error` instances; abort-shaped non-null objects,
including plain-object rejections, are now recognised too. A guard rejection remains a guard error, and a defect inside
the resolver now propagates rather than being wrapped as `ResolverNetworkError`.

A failed resolution also names the URL that produced it. `ResolverHttpError` and
`ResolverInvalidJsonError` carry `url`, the final hop after redirect chasing,
and `ResolverTooManyRedirectsError` may carry `lastHopUrl` when the resolver can
name the hop that answered the redirect which exhausted the budget.

### Smaller changes

- **`./common` is a new sub-entry.** `asDateTime` and `asNonEmptyString` are small readers that return a usable value or `undefined`. `makeRequireString` is a factory that returns a reader which appends a structured failure to the caller's array before returning `undefined`. `asDateTime` is new; the other two were already in the package with no way to import them.
- **`./common` also gains `evaluateValidityWindow`.** It judges a credential's `validFrom` and `validUntil` claims against `now` as points on a timeline, per VCDM 2.0 section 4.9. A credential inside its window, or with no bound at all, passes. One outside its window fails as `expired` or `not_yet_valid`. A bound that is present but cannot be read as a `dateTimeStamp` fails as `unreadable_bound` rather than being normalised, so a malformed date such as 30 February is reported, not silently corrected to 2 March, and the `24:00:00` end-of-day form falls outside the supported profile.
- **Conformity parsing trims.** Required fields and optional fields read through `asNonEmptyString` by `parseConformityScheme` and `parseConformityCatalogue` are now returned trimmed. A whitespace-only optional value reads as absent, while a whitespace-only required value produces a `missing-required-field` failure.
- **`./artefacts` builds the link set schema URL.** `buildLinkSetSchemaUrl(version)` for the Identity Resolver link set schema, published from UNTP 0.7.0.
- **Request headers are copied in both `withUserAgent` branches.** The default-header branch already copied your object in 0.2.0. The explicit-`User-Agent` branch now copies it too, so a throwing getter in that caller-owned object is evaluated outside transport error classification.
- **Every subpath resolves types on old TypeScript resolution.** `artefacts`, `common` and `bundled-artefacts` were missing from `typesVersions`.

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
