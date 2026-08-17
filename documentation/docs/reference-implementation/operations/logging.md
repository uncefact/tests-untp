---
sidebar_position: 4
title: Logging
---

# Logging

The Reference Implementation produces structured logs for every request and operation. Logs include contextual information — such as correlation IDs, user IDs, and tenant IDs — that make it straightforward to trace a request through the system and diagnose issues.

## What Gets Logged

Every API request is logged on entry and completion. The entry log records the HTTP method and path. The completion log adds the response status code and how long the request took to process.

In between, individual operations log what they are doing — creating a credential, resolving a DID, uploading to storage, and so on. Each log entry carries the context of the request it belongs to, so you can follow the full lifecycle of any operation.

## Contextual Information

Each log entry automatically includes the following fields where available:

| Field | Description |
|-------|-------------|
| `correlationId` | A unique identifier for the request, used to trace it across the system |
| `userId` | The authenticated user who initiated the request |
| `tenantId` | The tenant the request is scoped to |
| `service` | The name of the service or adapter producing the log (e.g., `DID - VCKitDid`, `Storage - UncefactStorage`) |
| `route` | The API route handling the request (e.g., `/api/v1/credentials`) |
| `path` | The raw request pathname (e.g., `/api/v1/credentials/123`), attached automatically to the entry and completion logs by the shared request-logging middleware, distinct from the handler-supplied `route` pattern |
| `method` | The HTTP method (GET, POST, etc.) |
| `status` | The HTTP response status code (on completion) |
| `durationMs` | How long the request took to process in milliseconds (on completion) |

### Correlation IDs

Every request is assigned a correlation ID. This ID is included in every log entry produced during that request, making it possible to trace a single request across all the services and operations it touches.

The correlation ID is the `x-correlation-id` request header when the caller provides one. An inbound value is validated before it is trusted: it must be at most 128 characters of letters, digits, hyphens, and underscores, and anything else is replaced. Without a valid caller ID, a request carrying an `X-Amzn-Trace-Id` header (as AWS load balancers set) has its Root token adopted, joining these logs to ALB access logs and X-Ray, and otherwise a random UUID is generated.

The correlation ID is also returned in the `x-correlation-id` response header, so callers can use it to correlate their own logs with the Reference Implementation's logs, and it is forwarded as `x-correlation-id` on outbound calls to the configured UNTP services (storage, identity resolver, and verifiable credential services), so one ID traces a request across service boundaries in a log aggregator. Calls to third-party hosts, such as resolving a `did:web` document from its own domain, deliberately carry no correlation header.

When a request fails with an error that has no specific mapping, the response body's `error` message includes the correlation ID, reading `An unexpected error has occurred. If the issue persists, please contact support and quote correlation id "<id>".` This gives a caller who cannot inspect server logs the identifier to quote in a support request. A failure that occurs before a route handler runs, such as a fault during authentication or tenant resolution, is reported with this same message rather than the underlying error text.

### Service Names

Each service and adapter has its own logger name, making it easy to filter logs by component. Service names follow the pattern `{Domain} - {Adapter}` — for example, `DID - VCKitDid` or `Storage - UncefactStorage`. API route handlers are identified by their route path.

## Log Levels

The Reference Implementation supports four log levels, in order of increasing severity:

| Level | Description |
|-------|-------------|
| `debug` | Detailed diagnostic information, useful during development |
| `info` | General operational information (default) |
| `warn` | Warning conditions that may require attention |
| `error` | Error conditions that indicate a failure |

The log level is controlled by the `LOG_LEVEL` environment variable. Only messages at or above the configured level are emitted. The default is `info`.

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Minimum log level to emit (`debug`, `info`, `warn`, `error`) | `info` |

## Redaction

Secret-bearing fields are replaced with `[REDACTED]` before a log entry is written. The following field names are redacted by default, at the top level of a logged object, one level deep, and two levels deep:

- `decryptionKey`
- `apiKey`
- `authorization` and `Authorization`
- `token`
- `password`

`Authorization` and `authorization` are additionally redacted in the HTTP client error shape `error.config.headers`, which nests one level deeper than the other defaults reach.

Deployments can extend the redacted set with the `LOG_REDACT_PATHS` environment variable, a comma-separated list of [pino redact paths](https://getpino.io/#/docs/redaction). This covers a secret shape specific to an environment or an integrated service without waiting for a code change.

| Variable | Description | Default |
|----------|-------------|---------|
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
