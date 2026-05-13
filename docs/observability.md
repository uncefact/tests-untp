# Observability

This repository's observability story is being built out incrementally. The current state is a **walking skeleton** that proves the end-to-end pipeline from one app (the reference implementation) into a local trace backend. Logs, metrics, and broader app coverage land in follow-up tickets.

## What works today

- The reference implementation is instrumented with the OpenTelemetry Node SDK and exports OTLP traces.
- A local Tempo backend, a local OTel agent (collector in agent mode), and a local Grafana run alongside the app under a Docker Compose profile.
- Traces from any request to the reference implementation are visible in Grafana, indexed by the `service.name`, `service.version`, and `deployment.environment.name` resource attributes.

## What is intentionally not wired yet

- **Pino structured logging** lands with [#593](https://github.com/uncefact/tests-untp/issues/593).
- **OpenTelemetry metrics** (request rate, latency, error rate, runtime) land with [#594](https://github.com/uncefact/tests-untp/issues/594).
- **Playground instrumentation** lands with [#597](https://github.com/uncefact/tests-untp/issues/597), once #593 and #594 give it a fully exercised template to follow.
- **Custom domain spans** on the credential pipeline, adapter invocations, etc. (per ADR 019) are a follow-up to the walking skeleton.
- **Central OTel gateway and cloud LGTM stack** are part of [#595](https://github.com/uncefact/tests-untp/issues/595). Until that lands, the local OTel agent exports straight to local Tempo.

## Running the local stack

```bash
docker compose --profile local-observability up -d --build
```

This brings up the app and shared services plus three observability containers:

| Service | Image | Purpose |
|---|---|---|
| `otel-agent` | `otel/opentelemetry-collector-contrib` | Receives OTLP from the app on `:4317`, exports to Tempo. |
| `tempo` | `grafana/tempo` | Trace storage. |
| `grafana` | `grafana/grafana` | Dashboard / Explore UI. |

When everything is healthy, the reference implementation is at `http://localhost:3003` and Grafana is at `http://localhost:3030`. Grafana ships with the default `admin`/`admin` login and may prompt you to set a new password on first sign-in.

## Verifying that traces flow

1. Log into the reference implementation at `http://localhost:3003`.
2. Navigate around (any page hit produces a trace).
3. Open Grafana at `http://localhost:3030`.
4. Use **Explore** with the **Tempo** data source. The data source is pre-provisioned and is the default.
5. In the search panel, set the **Service Name** filter to `reference-implementation` and click **Run query**.
6. Recent traces appear within a minute. Click one to see the span tree.

Each trace carries resource attributes:

- `service.name` = `reference-implementation`
- `service.version` = the package version from `packages/reference-implementation/package.json`
- `deployment.environment.name` = the value of `DEPLOYMENT_ENVIRONMENT` (`local` by default)

These are the segregation keys that the shared observability stack (ADR 018) uses across environments.

## Tearing down

```bash
docker compose --profile local-observability down -v
```

The `-v` flag removes the named volumes (`tempo-data`, `grafana-data`) so the next start is clean.

## Compose profile shape

Per ADR 020, the root `docker-compose.yml` carries two observability profiles:

- `observability`. Sidecars only. Production-shape locally: the OTel agent runs, but no local LGTM stack does. The agent is intended to forward to a central gateway (see #595); until that lands, this profile is structurally present but unverified.
- `local-observability`. Superset of `observability`. Adds the local LGTM stack (currently just Tempo and Grafana; Loki and Prometheus join with #593 and #594).

The walking skeleton verifies `local-observability` end-to-end. `observability` is structurally in place so later tickets can extend it without restructuring.

## How the app emits

The reference implementation initialises the SDK via Next.js's instrumentation hook at `packages/reference-implementation/src/instrumentation.ts`, which Next.js calls once per process at startup. The hook guards on `NEXT_RUNTIME === 'nodejs'` so the Node SDK does not get pulled into the Edge runtime bundle. The SDK uses the OTLP gRPC trace exporter; the endpoint is read from `OTEL_EXPORTER_OTLP_ENDPOINT` and defaults to `http://localhost:4317` (suitable for `pnpm dev` against the compose stack). The Docker Compose service for the reference implementation overrides this default to `http://otel-agent:4317` so containerised runs reach the sidecar through the compose network.

Auto-instrumentation is provided by `@opentelemetry/auto-instrumentations-node`, which covers HTTP, fetch, Next.js, Prisma, and other common libraries.

## Relevant ADRs

- [ADR 018: Shared single observability stack across environments](./adrs/018-shared-observability-stack.md)
- [ADR 019: Observability host agents and OpenTelemetry instrumentation](./adrs/019-observability-host-agents-and-instrumentation.md)
- [ADR 020: Single root Docker Compose file with profile-based activation](./adrs/020-docker-compose-profile-based-activation.md)
