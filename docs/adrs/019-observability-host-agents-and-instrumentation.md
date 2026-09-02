# ADR: Observability host agents and OpenTelemetry instrumentation

- **Date:** 2026-05-12
- **Status:** proposed
- **Update (2026-09-02):** the reference implementation reads `service.name` from `OTEL_SERVICE_NAME`, falling back to `reference-implementation`, and passes the resolved name to the Node SDK as its `serviceName` option so the SDK applies it after its own environment detection (#643). A `service.name` set only through `OTEL_RESOURCE_ATTRIBUTES` therefore does not rename the app, while the other attributes in that variable still apply. The decision that apps set these resource attributes is unchanged.

## Context

Given the shared observability stack (separate ADR), we need a mechanism for shipping telemetry from each EC2 instance to the central stack. Apps need to emit traces, metrics, and logs; agents on each instance need to forward those signals to the central LGTM(V) backends.

The architectural choices:

- Direct app-to-central-backend connections vs host-side agents that batch and forward.
- Which agents to run on each host.
- How apps emit telemetry (push vs pull, OTLP vs vendor-specific).
- Where structured logging fits relative to OTel.

## Decision

**Three host-side agents** run on each EC2 instance:

1. **Vector** — collects logs from containers and journald, ships to central Loki.
2. **OpenTelemetry Collector** (agent mode) — receives OTLP traces and metrics from apps on `localhost:4317`, plus collects host metrics directly via the hostmetrics receiver. Forwards everything to the central OTel gateway.
3. **Icinga2 agent** — runs infrastructure health checks, reports to the central Icinga master.

Apps emit telemetry to local agents, not directly to central backends:

- Traces and metrics: app uses OpenTelemetry SDK, emits OTLP to `localhost:4317`.
- Logs: app writes structured JSON to stdout, Docker captures, Vector reads from Docker logs and ships to Loki.

**Host metrics** come from OTel's built-in `hostmetrics` receiver, not a separate node_exporter. The receiver covers CPU, memory, disk, filesystem, network, load, and processes — the same scope as node_exporter — with consistent OTel semantic conventions.

**App instrumentation:**

- **Reference-implementation:** OpenTelemetry SDK fully integrated (traces, metrics, structured logs). Custom spans for credential pipeline, adapter invocations, and other domain-relevant operations.
- **Playground:** Production-grade structured logging via **Pino** (JSON output, contextual fields, trace correlation IDs) replacing ad-hoc `console.log` calls. OpenTelemetry SDK integrated to match reference-implementation.

Both apps:
- Read `OTEL_EXPORTER_OTLP_ENDPOINT` from environment (set to `http://otel-agent:4317` in compose).
- Set `service.name`, `service.version`, `deployment.environment` as resource attributes.
- Include trace correlation IDs in log records (Pino + OTel JS integration).

**Configuration templating:** observability agent configs (`otel-collector.yaml.template`, `vector.toml.template`, `icinga2.conf.template`) live in `deploy/observability-configs/` and are templated with environment-specific values (collector endpoint, Loki endpoint, Icinga master endpoint, deployment environment) at deploy time.

We chose this design because:
- The agent layer protects apps from observability backend outages (agents buffer locally if the central stack is unreachable).
- OpenTelemetry as the emission standard avoids vendor lock-in and gives consistent semantics across traces, metrics, and logs.
- OTel's hostmetrics receiver removes the need for a separate node_exporter agent, simplifying the host-side setup.
- Pino is a mature, well-supported structured logger for Node.js with good OTel integration.

## Consequences

**What becomes easier:**
- Apps emit to localhost — no observability backend addresses or auth configured in app code.
- Local observability backend outages don't crash or block apps; agents buffer and retry.
- Same telemetry pipeline works locally (against local LGTM stack) and in production (against central stack); only endpoints differ.
- Adding a new app to the observability pipeline means adding the OTel SDK and pointing it at `localhost:4317`. No host-side changes needed.
- OTel's vendor-neutral semantic conventions make telemetry portable.

**What becomes harder:**
- Three host-side agents per instance is more moving parts than direct app-to-backend would be. Each agent is its own potential failure point.
- App instrumentation is significant work, especially for the reference implementation. Custom spans for domain logic require thought about what to instrument.
- Playground needs ad-hoc logging migrated to Pino, which touches many files.
- OTel SDK has its own learning curve and version churn. JS-side OTel has historically been less mature than other languages; worth monitoring.
- Resource detection (EC2 instance ID, AZ, region) needs explicit configuration in the OTel agent. Otherwise host metadata is missing from telemetry.

## Alternatives Considered

### Apps emit directly to central backends (no host agents)

Rejected because it couples app uptime to central backend availability and puts authentication of backend endpoints into every app's configuration. Agent-based architecture is the standard pattern for good reasons.

### node_exporter for host metrics, OTel agent only for app metrics

Rejected. OTel's hostmetrics receiver covers the same scope as node_exporter and produces metrics with OTel semantic conventions consistent with the rest of the pipeline. Adding node_exporter adds another agent for no functional gain. The one tradeoff (OTel naming differs from node_exporter's traditional metric names) means we build dashboards against OTel conventions, which is cleaner anyway.

### Promtail for log shipping instead of Vector

Considered. Vector is more capable (transformation, multi-sink, multi-source) but heavier. For this stack's needs, Promtail or Grafana Alloy would also work. Vector is the chosen tool because the team has committed to it; the choice is not architecturally load-bearing.

### Winston instead of Pino

Considered. Pino is generally faster and has slightly better JSON-first ergonomics. Winston has a larger ecosystem. Either would work; Pino chosen as the more performant default. Not an architecturally critical decision.

### Skip OTel, use vendor-specific (Loki/Tempo/Prometheus) instrumentation directly

Rejected because OTel's vendor-neutral conventions and unified SDK make the pipeline portable. If we ever change a backend (e.g., Prometheus → Mimir), apps don't need to change.

## References

- ADR: Shared single observability stack
- ADR: Docker Compose with profile-based activation
- ADR: Three deployment tiers (dev, staging, prod)
- OpenTelemetry documentation on hostmetrics receiver
- Pino documentation
