# Changelog

All notable changes to `@uncefact/untp-ri-services` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
version numbers follow semantic versioning. The package ships via the
`untp-ri-services-v<X.Y.Z>` tag-triggered publish workflow described in
[ADR 031](../../docs/adrs/031-per-package-tag-triggered-npm-release.md).

## [Unreleased]

### Added

- **logging:** `LoggerConfig` now accepts an optional `traceContextProvider`
  for adding active trace identifiers to structured log entries.
- **encryption:** `decryptCredential` and `decryptCredentialToBytes` accept an
  optional logger as a second argument, so callers can supply a logger that
  carries request and trace context. Omitting it keeps the module-scoped
  logger.

### Changed

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
