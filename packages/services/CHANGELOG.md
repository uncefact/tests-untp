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

- **http:** `httpFetch` retries a refused request with exponential backoff and
  full jitter, at most four attempts. A `429` is retried for every call, and a
  `503` or an attempt that outlives `retry.attemptTimeoutMs` only for a call
  passing `retry: { repeatable: true }`. An attempt that outlives its limit is
  aborted with a `TimeoutError` reading "No response headers within N ms". A
  `Retry-After` header is a floor on the wait; a value that is neither
  delay-seconds nor an HTTP-date, or one over 30 seconds, ends the retry.
  `retry.deadline` bounds the waits and the dispatch of retries, not an
  attempt already sent, and defaults to 30 seconds from the first attempt.
  `retry: false` makes one attempt. `onRetry` reports each retry and each
  refusal returned unretried. `warnOnRetry` turns a logger into an `onRetry`.
  The response or error the caller sees is the last attempt's. Before each
  wait the refused response's body is read in full, while the caller's
  signal applies and no later than `retry.deadline`. The response held
  across the wait is a copy built from those bytes, without
  `content-encoding` and `content-length` because the bytes are already
  decoded, so it reads in full even after the caller gives up. If that read
  fails, the call returns the refusal without waiting, its body rejecting
  with the error that ended the read, and `onRetry` gives the reason
  `aborted` when the caller's signal ended it and `body-unreadable`
  otherwise. If the deadline arrives during that read, the read is
  cancelled, closing the connection, and the call returns the refusal's
  status and headers, again without `content-encoding` and
  `content-length`, unretried, its body rejecting with a `TimeoutError`.
- **http:** `runWithoutRequestRetry` runs a callback in which every
  `httpFetch` call started before the callback calls the
  `resumeRequestRetry` function it receives makes one attempt, also when it
  is still in flight at the resume. A call started after the resume follows
  its own `retry` option. A caller that retries part of a unit of work
  itself uses it so the two retries never multiply. `httpFetch`, the types
  `HttpClientOptions`, `HttpRetryOptions` and `HttpRetryEvent`,
  `warnOnRetry`, `runWithoutRequestRetry`, and the constants
  `DEFAULT_RETRY_BUDGET_MS` (30 seconds) and `READ_ATTEMPT_TIMEOUT_MS`
  (10 seconds) are exported from `./server`.
- **verifiable-credential:** `VerifyOptions.signal` aborts a verification,
  including any wait before a retry. `VerifyOptions.deadline` and
  `GetCredentialStatusInput.deadline`, in epoch milliseconds, end the retries
  of a verification and of a status read. Each bounds the waits and the
  dispatch of retries, and the read of a refused response's body before a
  wait, not an attempt already sent. Without one, the adapter
  applies its own retry budget.
- **did-manager:** `DidCreateError` and `DidDocumentFetchError` take an
  optional `cause`, and the VCKit DID adapter passes the underlying error.
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

- **verifiable-credential, did-manager, identity-resolver, storage:** the
  VCKit, Pyx and UNCEFACT adapters retry a `429` on every call and log each
  retry at warn. VCKit verification and status reads, VCKit DID resolution
  and key lookup, and identity resolver link, description and link-type reads
  also retry a `503`. DID key lookup and the identity resolver reads bound
  each attempt to 10 seconds; verification, status reads and DID resolution
  have no per-attempt limit. The VCKit status-list mint and status
  set make one attempt, because they run under the caller's status-list
  serialiser. The `429` resend of an effectful call (issuance, storage, link
  registration, DID creation, updates and deletions) assumes a `429` means
  the request was refused before it was processed. A gateway that forwards a
  request and then answers `429` can cause a repeated effect, such as a
  second signed credential or a duplicate link registration. A caller of an
  adapter that cannot accept that runs the call inside
  `runWithoutRequestRetry` without resuming retry, and a direct `httpFetch`
  caller can pass `retry: false`; both are listed under Added.
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

### Fixed

- **did-manager:** the VCKit DID adapter logs a provider "already exists" conflict at debug, not error, before throwing `DidConflictError`. Other creation failures still log at error.
