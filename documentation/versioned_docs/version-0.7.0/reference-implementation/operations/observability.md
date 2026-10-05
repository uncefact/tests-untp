---
sidebar_position: 6
title: Observability
---

# Observability

The Reference Implementation and its background worker emit OpenTelemetry traces through an OTLP gRPC exporter. The OpenTelemetry SDK also starts its default OTLP metrics exporter, which sends over HTTP, but the bundled stack does not receive or store metrics. Shipping logs to a log store is not included.

## Configuration

The exporter reads `OTEL_EXPORTER_OTLP_ENDPOINT`. The code default is `http://localhost:4317`, which suits a process started directly from a checkout. The bundled Compose file sets `http://otel-agent:4317` by default so both containers send to the collector on the Compose network.

The web process reads `OTEL_SERVICE_NAME`, which defaults to `reference-implementation`. The worker process reads the same process variable but defaults to `reference-implementation-worker`; the Compose worker block maps `OTEL_WORKER_SERVICE_NAME` to that process variable. Set the two names separately when filtering a shared trace store so the web process and worker can be told apart.

Every trace carries these resource attributes:

| Attribute                     | Source                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service.name`                | The resolved `OTEL_SERVICE_NAME`, or the process default. `OTEL_RESOURCE_ATTRIBUTES` cannot rename this service because the resolved name is applied after environment-detected attributes. |
| `service.version`             | The Reference Implementation package version. The worker reads the version from the same package metadata and reports `unknown` only when that version cannot be read.                      |
| `deployment.environment.name` | `DEPLOYMENT_ENVIRONMENT`, defaulting to `local`.                                                                                                                                            |

## What is emitted

The Node SDK uses `@opentelemetry/auto-instrumentations-node`, covering HTTP, `fetch` through undici, `pg` and other common libraries. Pino auto-instrumentation is disabled because the application logger's mixin supplies the log trace fields. Prisma spans are not emitted because Prisma instrumentation is not installed, and filesystem auto-instrumentation is off.

Next.js spans appear only on the web process. The web process also emits HTTP, undici, DNS and network spans for its outbound fetches, and no pg spans, because its boot loads `pg` through the job queue before it starts the SDK. The worker emits a span for each job it runs, undici spans, and pg spans only for job queue calls made while a span is active, in practice inside a job. Neither process emits filesystem spans.

In the worker, the job queue's own background work (polling, fetching and settling jobs, maintenance and the scheduler's own polls) and the health-probe query normally run with no span active, so they emit no pg spans. No setting traces them again. To turn pg spans off entirely, set `OTEL_NODE_DISABLED_INSTRUMENTATIONS=pg` in the worker's environment. The bundled Compose file does not pass that variable through, so add it to the `ri-worker` service.

When this background work in the worker opens a new database connection, its `tcp.connect` and `dns.lookup` spans may still appear as traces of their own.

Failures in this work reach the logs, not the trace store:

- The job queue's error and warning events, in both the web process and the worker, are logged as "Job queue reported an error".
- The worker's health probe logs "Health probe failed; the heartbeat is not refreshed" at warn.

One case is not logged. If the write that records a job as completed fails and the job queue then records the job as failed, nothing is logged. The job is retried if it has attempts left.

The web process and worker use the same exporter and resource attribute shape, but they are separate processes with separate service names. A dashboard filtered only to `reference-implementation` will not show worker spans.

## Compose profiles

The root Compose file provides two profiles:

| Profile               | Services                        | Use                                                                                                    |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `observability`       | `otel-agent` only               | Sends traces to an agent. Use this shape when the agent will forward to a remote collector or backend. |
| `local-observability` | `otel-agent`, Tempo and Grafana | Runs a local trace backend and dashboard. Grafana is available at `http://localhost:3030`.             |

Start the agent-only profile with:

```bash
docker compose --profile observability up -d --build
```

Stop it with:

```bash
docker compose --profile observability down
```

Start the local profile with:

```bash
docker compose --profile local-observability up -d --build
```

Stop the local profile and remove its Tempo and Grafana volumes with:

```bash
docker compose --profile local-observability down -v
```

The local collector receives OTLP on gRPC port `4317` and forwards traces to Tempo. Grafana is provisioned with the local Tempo data source. The agent-only profile contains no local Tempo or Grafana service.

## Confirming trace flow

1. Start the `local-observability` profile and wait for the Reference Implementation and its dependencies to become healthy.
2. Open the Reference Implementation at `http://localhost:3003` and navigate to a page or call an API route.
3. Open Grafana at `http://localhost:3030`, select **Explore**, and use the provisioned **Tempo** data source.
4. Filter by the web `service.name` value, `reference-implementation` by default, and run the query. Filter separately by `reference-implementation-worker` to see background work. Recent traces should appear within a minute.

If the web traces arrive but worker traces do not, check the worker's `OTEL_WORKER_SERVICE_NAME` mapping and its endpoint. If neither process produces traces, check the endpoint, the collector container logs and the collector's OTLP receiver. An unreachable OTLP endpoint does not stop either process, and produces no log line about a failed export, so silence is not proof that traces were delivered.

## Correlating logs and traces

The [Correlation IDs](./logging#correlation-ids) section explains the request log identifier and how it travels across the services. A log line written through the application logger while a span is active carries `traceId`, `spanId` and `traceFlags` beside `correlationId`. The span active in a route handler carries the `correlation.id` attribute. In the web process this is Next's internal route span, not the top-level server span, so query Tempo with `{ .correlation.id = "…" }` without a span-kind filter.

An enqueued job carries the request's correlation id. Its worker job span is named after its queue and carries `correlation.id` and `job.id`. The request trace and job trace are separate traces joined by the correlation id; scheduler jobs receive a fresh correlation id.

## What is not included

This release does not ship application logs to a log store. The local stack stores traces in Tempo only and receives no metrics, so it is not a complete metrics and logs backend.
