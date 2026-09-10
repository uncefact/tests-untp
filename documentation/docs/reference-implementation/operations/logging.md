---
sidebar_position: 4
title: Logging
---

# Logging

The Reference Implementation produces structured logs for every request and operation. Logs include contextual information, such as correlation IDs, user IDs, and tenant IDs, that make it straightforward to trace a request through the system and diagnose issues.

## What Gets Logged

Every API request is logged on entry and completion. The entry log records the HTTP method and path. The completion log adds the response status code and how long the request took to process.

In between, individual operations log what they are doing, including creating a credential, resolving a DID, uploading to storage, and so on. Each log entry carries the context of the request it belongs to, so you can follow the full lifecycle of any operation.

### Library read degradation

The library list and batch-get routes return `200` when an individual stored row cannot be represented, so HTTP 5xx monitoring does not detect that condition. Watch for the error-level `Library record read degraded` event instead. The detail route emits the same event when it returns a `DECRYPTION_KEY_UNAVAILABLE` warning.

The event carries these fields, on top of the `correlationId` and `tenantId` every log line gets from the request context:

| Field           | Description                                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordId`      | The record this outcome belongs to: the id the page selected, or the id the caller submitted                                                                                                                                                                                       |
| `route`         | The route pattern that produced it                                                                                                                                                                                                                                                 |
| `readStage`     | `hydration`, `projection` or `detail`                                                                                                                                                                                                                                              |
| `code`          | The public code the caller was given: `RECORD_UNREADABLE`, or `DECRYPTION_KEY_UNAVAILABLE` on the detail route                                                                                                                                                                     |
| `reason`        | The classification, one of `shape`, `projection`, `identity-mismatch`, `unclassified`, `malformed-envelope`, `key-configuration` and `unwrap-failed`. The last three are key causes on the detail route                                                                            |
| `errorCode`     | The failing error's own namespaced code (for example `library.record-shape`). Every classified `reason` carries one. An `unclassified` event carries it only when whatever was thrown happens to be a structured error, so key an alert on `reason` and `code` rather than on this |
| `errorRecordId` | The record the failing error named, present only when a row-local error named a record other than the one being read                                                                                                                                                               |
| `error`         | The failing error reduced to its `name` and `message`. `name` is the error's class name, which a production build minifies, so it is not a stable identifier; `errorCode` is what names the error                                                                                  |

Each degraded record produces one such event. The list and batch-get routes then emit one info-level `Library record read summary` event per request, carrying the counts for `returned`, `unreadable` and `notFound`; the detail route reads one record and emits no summary. A list request whose filter carries a NUL character is answered before the database read and still emits a summary, with all three counts zero, so a summary of zeros means either an empty result or that rejected filter. These events never include a stored key, encryption envelope or raw record. Use the `recordId` and `correlationId` together when investigating a row, and ask the caller to quote the `x-correlation-id` response header.

The detail route replaces one existing line rather than adding to it. Its key-unavailable event stands in for `Failed to decrypt stored credential decryption key`, which `GET /api/v1/library/{id}` no longer writes, so that one failure still produces exactly one error line. Every other caller of the key reveal keeps writing that message, so a saved search on it needs the new event beside it rather than in place of it.

`reason` is what separates repairs that look alike. A rotation that re-wrapped some rows and left others under the previous key shows `unwrap-failed` on the rows it did not reach. A key that matches no stored envelope at all does not reach this event: startup validation decrypts one existing envelope and refuses to boot when it cannot. A deployment that cannot resolve the key at all shows `key-configuration`, and a single damaged row shows `malformed-envelope`. Each of those three is recognised by an error class of its own rather than by matching message text, so a fault the service has not met before shows `unclassified` rather than being attributed to a key configuration that is not at fault.

The `reason` and `code` values are an operator-facing contract, not free-form diagnostics. They are renamed with the same sweep an API code gets, so an alert wired to either of them keeps working until a release note says otherwise. `errorCode` is diagnostic detail for reading a single event, which is why the table above points alerts at `reason` and `code` instead.

## Contextual Information

Each log entry automatically includes the following fields where available:

| Field           | Description                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `correlationId` | A unique identifier for the request, used to trace it across the system                                                                                                                                      |
| `userId`        | The authenticated user who initiated the request                                                                                                                                                             |
| `tenantId`      | The tenant the request is scoped to                                                                                                                                                                          |
| `service`       | The name of the service or adapter producing the log (e.g., `DID - VCKitDid`, `Storage - UncefactStorage`)                                                                                                   |
| `route`         | The API route handling the request (e.g., `/api/v1/credentials`)                                                                                                                                             |
| `path`          | The raw request pathname (e.g., `/api/v1/library/123`), attached automatically to the entry and completion logs by the shared request-logging middleware, distinct from the handler-supplied `route` pattern |
| `method`        | The HTTP method (GET, POST, etc.)                                                                                                                                                                            |
| `status`        | The HTTP response status code (on completion)                                                                                                                                                                |
| `durationMs`    | How long the request took to process in milliseconds (on completion)                                                                                                                                         |

### Correlation IDs

Every request is assigned a correlation ID. This ID is included in every log entry produced during that request, making it possible to trace a single request across all the services and operations it touches.

The correlation ID is the `x-correlation-id` request header when the caller provides one. An inbound value is validated before it is trusted: it must be at most 128 characters of letters, digits, hyphens, and underscores, and anything else is replaced. Without a valid caller ID, a request carrying an `X-Amzn-Trace-Id` header (as AWS load balancers set) has its Root token adopted when that token is a valid X-Ray root, joining these logs to ALB access logs and X-Ray. Otherwise a random UUID is generated.

The correlation ID is also returned in the `x-correlation-id` response header, so callers can use it to correlate their own logs with the Reference Implementation's logs, and it is forwarded as `x-correlation-id` on outbound calls to the configured UNTP services (storage, identity resolver, and verifiable credential services), so one ID traces a request across service boundaries in a log aggregator. Calls to third-party hosts, such as resolving a `did:web` document from its own domain, deliberately carry no correlation header.

When a request fails with an error that has no specific mapping, the response body's `error` message includes the correlation ID, reading `An unexpected error has occurred. If the issue persists, please contact support and quote correlation id "<id>".` This gives a caller who cannot inspect server logs the identifier to quote in a support request. A failure that occurs before a route handler runs, such as a fault during authentication or tenant resolution, is reported with this same message rather than the underlying error text.

### Service Names

Each service and adapter has its own logger name, making it easy to filter logs by component. Service names follow the pattern `{Domain} - {Adapter}`, for example, `DID - VCKitDid` or `Storage - UncefactStorage`. API route handlers are identified by their route path.

## Log Levels

The Reference Implementation supports four log levels, in order of increasing severity:

| Level   | Description                                                |
| ------- | ---------------------------------------------------------- |
| `debug` | Detailed diagnostic information, useful during development |
| `info`  | General operational information (default)                  |
| `warn`  | Warning conditions that may require attention              |
| `error` | Error conditions that indicate a failure                   |

The log level is controlled by the `LOG_LEVEL` environment variable. Only messages at or above the configured level are emitted. The default is `info`.

| Variable    | Description                                                  | Default |
| ----------- | ------------------------------------------------------------ | ------- |
| `LOG_LEVEL` | Minimum log level to emit (`debug`, `info`, `warn`, `error`) | `info`  |

## Library storage lines that need an operator

Some library storage outcomes cannot be reported to the caller, because the caller cannot act on them. They are recorded as log lines instead, and these are the ones an operator has to watch for. Each carries `recordId` and `tenantId` alongside the fields named below, except the last: the store path it is written from is shared with registration, which has no record id yet, so that line carries `tenantId` and the storage coordinates only.

| Message                                                                        | Level   | Extra fields                                                                                                                                                                    | What it means                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Prepared recovery copy is orphaned and needs operator cleanup`                | `error` | `reason`, `storageUri`, `storageExternalId`, `storageBucket`                                                                                                                    | A re-verification stored a durable copy and then did not attach it, because the record moved, the generation was superseded or the transaction failed. Nothing refers to the object; it can be removed.                                                                                                                                                      |
| `Retired recovery copy removed`                                                | `info`  | `removal`, `storageUri`, `storageServiceInstanceId`, `storageExternalId`, `storageBucket`                                                                                       | A key-bearing recovery opened the record's unopened ciphertext, replaced its custody with a receiver-protected copy, and removed the original supplier ciphertext it retired. Nothing to do.                                                                                                                                                                 |
| `Retired recovery copy remains for operator-managed cleanup`                   | `warn`  | `removal`, `errorName` when `removal` is `storage_delete_failed` or `storage_resolution_failed`, `storageUri`, `storageServiceInstanceId`, `storageExternalId`, `storageBucket` | The same recovery, where the removal did not happen. `removal` says why: `storage_delete_failed`, `storage_resolution_failed`, or `incomplete_storage_coordinates` for a row that never recorded a full set. The object is no longer named by any record, so deleting the record will not remove it either. This line is the only record of where it is.     |
| `The reserved durable copy could not be acquired for recovery`                 | `error` | `reason`, `classification`, `error`                                                                                                                                             | A key-bearing recovery could not read back or prove the record's own durable copy. `reason` separates a failed read from a missing recorded digest and an unreadable one; `classification` is the reader's `transient` or `terminal` judgement, which is what decides whether the settled generation is retryable. The caller sees only the settled message. |
| `Storage encrypted the durable copy but returned no key; the copy is orphaned` | `error` | `storageUri`, `storageExternalId`, `storageBucket`                                                                                                                              | The storage service encrypted a copy and did not return the key it must return. The object exists and cannot be opened; the caller's failure message names no coordinates, so this line is where they are.                                                                                                                                                   |

## Redaction

Secret-bearing fields are replaced with `[REDACTED]` before a log entry is written. The following field names are redacted by default, at the top level of a logged object, one level deep, and two levels deep:

- `decryptionKey`
- `apiKey`
- `authorization` and `Authorization`
- `token`
- `password`

`Authorization` and `authorization` are additionally redacted in the HTTP client error shape `error.config.headers`, which nests one level deeper than the other defaults reach.

Deployments can extend the redacted set with the `LOG_REDACT_PATHS` environment variable, a comma-separated list of [pino redact paths](https://getpino.io/#/docs/redaction). This covers a secret shape specific to an environment or an integrated service without waiting for a code change.

| Variable           | Description                                                         | Default |
| ------------------ | ------------------------------------------------------------------- | ------- |
| `LOG_REDACT_PATHS` | Comma-separated pino redact paths merged with the built-in defaults | (unset) |

Each wildcard in a pino path matches exactly one level, and `*[*]` covers both arrays and plain objects. Worked examples:

- `webhookSignature` redacts the field at the top level of a logged object.
- `*.webhookSignature` redacts it one level deep, such as `{ integration: { webhookSignature } }`.
- `*[*].webhookSignature` redacts it two levels deep, including inside arrays, such as `{ integrations: [{ webhookSignature }] }`.

Because each wildcard matches a single level, a secret nested deeper than the paths you configure is not redacted.

An invalid path in `LOG_REDACT_PATHS` fails logger construction, which stops the application at startup with an error naming the variable and the configured paths. A redaction path that was silently dropped would leak the very value it was meant to protect, so a typo is surfaced immediately rather than discovered in shipped logs. The one tolerated irregularity is an empty segment (a double or trailing comma): it is ignored with a startup warning rather than failing the boot.

## Output Format

Logs are emitted as structured JSON, one JSON object per line, in every environment including development. This format is compatible with log aggregation tools such as CloudWatch, Datadog, ELK, and similar platforms.

Pretty-printed, colourised output with readable timestamps is available by passing `pretty: true` to `createLogger()`, but the Reference Implementation does not set this option anywhere, so no environment currently receives it.
