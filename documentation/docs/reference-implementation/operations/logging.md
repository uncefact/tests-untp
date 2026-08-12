---
sidebar_position: 3
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
| `method` | The HTTP method (GET, POST, etc.) |
| `status` | The HTTP response status code (on completion) |
| `durationMs` | How long the request took to process in milliseconds (on completion) |

### Correlation IDs

Every request is assigned a correlation ID. This ID is included in every log entry produced during that request, making it possible to trace a single request across all the services and operations it touches.

The correlation ID is the `x-correlation-id` request header when the caller provides one. An inbound value is validated before it is trusted: it must be at most 128 characters of letters, digits, hyphens, and underscores, and anything else is replaced. Without a valid caller ID, a request carrying an `X-Amzn-Trace-Id` header (as AWS load balancers set) has its Root token adopted, joining these logs to ALB access logs and X-Ray, and otherwise a random UUID is generated.

The correlation ID is also returned in the `x-correlation-id` response header, so callers can use it to correlate their own logs with the Reference Implementation's logs, and it is forwarded as `x-correlation-id` on outbound calls to the configured UNTP services (storage, identity resolver, and verifiable credential services), so one ID traces a request across service boundaries in a log aggregator. Calls to third-party hosts, such as resolving a `did:web` document from its own domain, deliberately carry no correlation header.

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

## Output Format

In production, logs are emitted as structured JSON — one JSON object per line. This format is compatible with log aggregation tools such as CloudWatch, Datadog, ELK, and similar platforms.

In development, logs are formatted for human readability with colour coding and readable timestamps.
