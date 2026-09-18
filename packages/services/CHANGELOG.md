# Changelog

All notable changes to `@uncefact/untp-ri-services` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
version numbers follow semantic versioning. The package ships via the
`untp-ri-services-v<X.Y.Z>` tag-triggered publish workflow described in
[ADR 031](../../docs/adrs/031-per-package-tag-triggered-npm-release.md).

## [Unreleased]

### ⚠ BREAKING CHANGES

- **verifiable-credential:** `CredentialStatus` now admits one entry or an
  ordered collection of entries. The VCKit adapter emits a single object when
  one status purpose is minted and an array only when several purposes are
  minted. Issued credentials carry `statusListIndex`
  as an integer to match the published UNTP v0.7.0 schemas, although the W3C
  Bitstring Status List specification requires a string in base 10. Parsing,
  capture and stored `CredentialStatusEntry` rows retain the canonical decimal-string
  index. Revert the issued value to a string when the UNTP schema is corrected
  upstream.
  `statusPurpose` is an open string rather than the literal `revocation`,
  because the specification leaves the value open and each provider decides
  what it can mint. A consumer that read the index as a number, or narrowed the
  purpose to `revocation`, must be updated.

### Added

- **cvc:** the scheme-document ingest input accepts `allowPrivateAddresses` and forwards it to the guarded fetch.
- **data-model-bridges:** the v0.7.0 DCC extractor projects `profileScore` and per-assessment `assessedScores` only when present, with source-map entries for each score code.
- **verifiable-credential:** `sign` takes an optional second `SignOptions`
  argument. `statusPurposes` names the status purposes to mint and the order
  they appear in, an empty array asks for no entries, and omitting the option
  keeps the adapter's own default. `serialise` receives an opaque key naming
  the status list the adapter is about to rewrite, so a caller can serialise
  concurrent mints against that list; without it there is no serialisation.
  `signal` aborts the call.
- **verifiable-credential:** `IVerifiableCredentialService` gains
  `setCredentialStatus` and `getCredentialStatus`. Every throw from
  `setCredentialStatus` other than `VcStatusSetError` is pre-flight and
  applied nothing, and `VcStatusSetError.mayHaveApplied` is the only signal
  that the outcome is unknown. `getCredentialStatus` returns an observation
  of one entry's bit.
- **verifiable-credential:** `canonicalStatusListIndex`,
  `parseCredentialStatus` and `parseCredentialStatusEntry` parse and
  canonicalise Bitstring Status List entries. Each requires `options.source`,
  so a caller states whether malformed data is its own input or a provider
  response, which decides the error raised.
- **verifiable-credential:** the status error classes `VcStatusReadError`,
  `VcStatusSetError`, `VcStatusResponseInvalidError`,
  `VcStatusListNotFoundError` and `VcStatusEntryUnsupportedError`, and the
  types `CredentialStatusEntry`, `CanonicalCredentialStatusEntry`,
  `StatusMessage`, `SignOptions`, `SetCredentialStatusInput`,
  `GetCredentialStatusInput` and `CredentialStatusObservation`.
- **logging:** `LoggerConfig` now accepts an optional `traceContextProvider`
  for adding active trace identifiers to structured log entries.
- **encryption:** `decryptCredential` and `decryptCredentialToBytes` accept an
  optional logger as a second argument, so callers can supply a logger that
  carries request and trace context. Omitting it keeps the module-scoped
  logger.

### Changed

- **verifiable-credential:** `credentialStatus` on
  `UNTPVerifiableCredential` is optional, because a credential can be issued
  with no status entries. A consumer that assumed it was always present must
  handle its absence.
- **logging:** the mixin reads request context directly from its request-context
  store and takes trace context only through the optional
  `traceContextProvider` on `LoggerConfig`. Mixin fields now win over fields
  passed at the log call, so active trace and request fields remain authoritative.

- **storage:** the Uncefact adapter now keeps a named reason and complete
  serialised response evidence on the log line when it refuses a 2xx response.
  Invalid JSON carries the full response text, a missing digest carries the
  fields that were present, and a missing, empty, or non-string decryption key
  carries only its type and length. The offending value never enters the thrown
  error, and the success lines for `store` and `storeBinary` no longer carry the
  returned `uri` and now carry the `bucket`.

  A refusal by the storage service itself is unchanged: the service's own
  `message` still reaches the thrown error and the log line, falling back to
  the status text and then to `Unknown error`, because it is the only
  statement of why the write was refused that this deployment gets. No other
  field of that body is carried.

### Removed

- **logging:** `registerRequestContextProvider` and the logging barrel's
  automatic request-context registration side effect. Consumers should delete
  the call and pass `traceContextProvider` through `createLogger` when trace
  fields are required.
