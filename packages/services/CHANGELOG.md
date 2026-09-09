# Changelog

All notable changes to `@uncefact/untp-ri-services` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
version numbers follow semantic versioning. The package ships via the
`untp-ri-services-v<X.Y.Z>` tag-triggered publish workflow described in
[ADR 031](../../docs/adrs/031-per-package-tag-triggered-npm-release.md).

## [Unreleased]

### Changed

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
