---
sidebar_position: 9
title: Bundled UNTP Artefacts
---

# Bundled UNTP Artefacts

Issuing a credential validates its payload against the UNTP JSON Schema and JSON-LD context for the version it declares. Those artefacts are published on the UNTP hosts (`untp.unece.org` from 0.7.0, `test.uncefact.org` and `vocabulary.uncefact.org` for earlier versions and the unified context) and, for the Verifiable Credentials Data Model, on `www.w3.org` (context) and `w3c.github.io` (schema), and the service fetches them on demand. An outage at one of those hosts used to fail every issuance with `SCHEMA_FETCH_FAILED` or `JSONLD_CONTEXT_FETCH_FAILED` until the host came back, even though the artefacts had not changed.

Published artefacts are immutable once released, so a copy of each one ships inside the service and stands in when the host cannot deliver it. This is on by default and needs no configuration.

## What is bundled

Every UNTP release from 0.6.0 onwards (0.6.0, 0.6.1 and 0.7.0 today):

- The core credential schemas (Digital Product Passport, Digital Conformity Credential, Digital Facility Record, Digital Identity Anchor, Digital Traceability Event), with the per-type JSON-LD contexts for 0.6.x (under both URLs the host publishes them at, `.../dpp/0.6.1/` as the schemas declare and `.../dpp/0.6.1/context/`) and the single unified context for 0.7.0.
- The 0.7.0 Conformity Scheme schema and the 0.7.0 Identity Resolver link set schema.
- The W3C Verifiable Credentials Data Model v2 context (`https://www.w3.org/ns/credentials/v2`), which every credential declares, and its JSON Schema.

Extension schemas and contexts hosted elsewhere (for example a sector's own credential type) are not bundled. A fetch failure for one of those still fails the request as before.

## What happens during an outage

When the host cannot deliver a bundled artefact (its name does not resolve, it cannot be reached, it times out, it answers an error status, it returns a body that is not JSON, or it exceeds the fetch's size or redirect bounds), the bundled copy is used instead and the request continues. Two failures are deliberately not covered, so they still fail the request as before: a URL the guard refused (a private address or hostname, an unsupported scheme, an unparseable URL), because a UNTP host resolving to a private address is something an operator must see, and an unexpected error inside the fetch itself. The copy is cached for the same period as a fetched one, so the host is retried once the cache entry expires.

Each time this happens the service logs a warning so the outage is visible (abridged; the real line also carries the usual `time`, `pid` and `hostname` fields and the error's stack):

```json
{"level":40,"module":"schema-loader","url":"https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json","err":{"type":"ResolverHttpError","message":"https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json returned status 403."},"msg":"Served the bundled copy of a UNTP artefact because its fetch failed (snapshot listed in @uncefact/untp-utils artefacts/manifest.json; BUNDLED_ARTEFACTS_FALLBACK=false disables this)"}
```

`url` is the artefact that could not be fetched and `err` is the fetch's own failure, so the line tells an unreachable host apart from a host answering an error. The line is logged under `module: "schema-loader"` for a `@context` fallback as well as a schema one; the `url` says which.

With the fallback on, a `SCHEMA_FETCH_FAILED` or `JSONLD_CONTEXT_FETCH_FAILED` response for a bundled URL is therefore not a host outage: it means the URL was refused by the guard, the fetch hit an unexpected error, or (for `SCHEMA_FETCH_FAILED`) the schema could not be compiled. A response with those codes for any other URL means that host could not be used.

## Turning the fallback off

Set `BUNDLED_ARTEFACTS_FALLBACK=false` to report every fetch failure to the caller as before, for example while diagnosing a host problem. Unset or blank means on; `true` and `false` are accepted in any case with surrounding whitespace; any other value fails startup with a message naming the variable, so a typo cannot leave the fallback in an unintended state.

## Keeping the bundle current

The bundle changes only when a new UNTP version is released. It is maintained in the `@uncefact/untp-utils` package, whose `artefacts/manifest.json` lists every bundled artefact with its published URL, the source it was fetched from (the UNTP specification repository at the release tag for 0.7.0 and later, the publishing hosts for earlier versions and for the Verifiable Credentials Data Model) and its content hash. The package's refresh script refuses to overwrite a bundled copy that differs from the published one. A new service release carries the new version; there is nothing to run in a deployed container.
