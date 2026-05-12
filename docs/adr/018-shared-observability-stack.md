# ADR: Shared single observability stack across environments

## Status

accepted

## Context

The reference implementation and playground need observability — logs, metrics, traces, infrastructure monitoring — across dev, staging, and prod environments. The question is whether each environment gets its own dedicated observability stack or whether all three environments share one.

The architectural reflex for tier isolation (separate VPCs, separate databases per environment) suggests separate observability stacks. But observability has different properties than apps and data:

- Observability provides visibility, not customer-facing service. Its blast radius concerns are inverted — we want observability to keep working even when the thing being observed is broken.
- A small team maintaining three full LGTM stacks would do all three poorly. Maintaining one well is more achievable.
- Cross-environment visibility is genuinely useful for investigation ("is this behaviour different in staging vs prod?").
- Cost: three full LGTM stacks roughly triples the observability infrastructure bill for marginal isolation benefit.

## Decision

We adopt a **single shared observability stack** serving all three environments, with multi-tenant segregation via labels.

**Central stack composition** (in its own VPC):
- **Loki** — log storage and querying
- **Prometheus** — metric storage (with `--web.enable-remote-write-receiver`); upgrade to Mimir/Thanos later if long-term retention requirements grow
- **Tempo** — trace storage
- **OpenTelemetry Collector** (gateway mode) — receives from host-side agents, routes to backends
- **Grafana** — dashboards, exploration, alerting (with `$environment` and `$service` variables for multi-env dashboards)
- **Icinga2 master** — infrastructure monitoring control plane
- **S3 backends** for Loki and Tempo long-term storage

**Segregation by labels, not infrastructure:**

Every telemetry signal carries resource attributes:
- `service.name` — `reference-implementation`, `playground`, etc.
- `service.version` — running version
- `deployment.environment` — `dev`, `staging`, `prod`
- `service.instance.id` — unique per running instance

Labels become Loki log stream labels, Tempo span attributes, Prometheus metric labels. Queries filter naturally.

**Dashboards** are built once with `$environment` and `$service` as variables. Same dashboard serves all environments.

**Retention** is configured per environment label:
- `environment=dev`: 7-day retention
- `environment=staging`: 30-day retention
- `environment=prod`: 90+ day retention

**Alerting** rules use the `environment` label to route appropriately. Prod alerts go to on-call channels; dev alerts may go to dev channels or be suppressed entirely.

**VPC peering** connects the observability VPC to each app VPC (dev, staging, prod). Agents on EC2 instances reach the central stack over private IPs.

**Access control** within Grafana uses folders and team-based permissions. Prod data may have tighter access than dev/staging. If access control by environment label becomes a real constraint later, splitting prod observability into its own stack remains an option, but is not the default.

We chose this design because the operational simplicity, cost reduction, and cross-environment visibility benefits outweigh the marginal isolation cost for a small-team OSS reference implementation.

## Consequences

**What becomes easier:**
- One stack to upgrade, monitor, and maintain — well-configured rather than three partial setups.
- Cross-environment queries are trivial: "Did this error appear in staging before prod?" is a single Grafana query.
- Dashboards developed once, work everywhere via variables.
- Lower infrastructure cost — roughly one-third the cost of three replicated stacks.
- Alerting rules live in one place, scoped by labels.

**What becomes harder:**
- Observability outage affects visibility into all environments simultaneously. Mitigated by treating the observability stack as production-grade (multi-AZ, monitored, backed up) regardless of which environments it observes.
- Dev's high-volume noisy logs share storage and cardinality budgets with prod's lower-volume high-signal logs. Retention policies by label help; queries from prod investigations are filterable. Real but bounded.
- Security boundary is logical (label-based access control in Grafana) rather than physical (separate infrastructure). For a reference implementation without highly sensitive prod data, acceptable. Worth revisiting if data sensitivity changes.
- Upgrades to the stack happen across all environments at once. Risk is real but small for an OSS project where downtime windows can be coordinated.

## Alternatives Considered

### One observability stack per environment

Rejected because:
- 3x infrastructure cost.
- 3x maintenance overhead for a small team that would do all three poorly.
- Loses cross-environment visibility, which is one of the most useful properties for investigation.
- Mirrors the app/database isolation principle, but that principle's load-bearing reasons (blast radius on prod traffic, data integrity) don't apply to observability the same way.

### Grafana Cloud (managed) instead of self-hosted

Considered as a quick-start option. Rejected because:
- For a UN-backed reference implementation, data sovereignty considerations favour self-hosting.
- Long-term cost at scale typically exceeds self-hosted on AWS.
- The team has Pulumi+AWS expertise; adding a managed SaaS dependency adds a different operational concern.

### Mimir instead of Prometheus

Considered. Rejected for the initial implementation because Mimir's value is at scale (horizontal scaling, object storage backend for metrics, multi-tenant routing) that this project doesn't yet need. Prometheus with object-storage retention via Thanos (if needed) is a less complex starting point. Migration to Mimir is possible later without changing the rest of the observability architecture.

### Self-hosted observability replicated per environment with cross-env federation

Rejected. Federation adds complexity without removing the maintenance burden of three stacks.

## References

- ADR: Three deployment tiers (dev, staging, prod)
- ADR: Observability host agents and instrumentation
- ADR: Pulumi for infrastructure with stack-per-environment
