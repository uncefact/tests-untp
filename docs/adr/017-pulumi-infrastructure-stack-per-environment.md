# ADR: Pulumi for infrastructure with stack-per-environment

## Status

accepted

## Context

The repository already uses Pulumi for infrastructure provisioning. With the introduction of three deployment tiers (dev, staging, prod) plus a shared observability stack, we need to confirm the structural approach for organising Pulumi configuration.

The choices to make:

1. One Pulumi stack covering all environments vs separate stacks per environment.
2. Where shared resources (the observability stack) sit in the structure.
3. How cross-stack dependencies are managed (e.g., app environments referencing the observability stack's collector endpoint).

## Decision

We use Pulumi with a **stack-per-environment** pattern, plus a separate stack for shared observability infrastructure. Four Pulumi stacks total:

- **`observability`** — shared LGTM(V) infrastructure (Loki, Prometheus, Tempo, OTel gateway, Grafana, Icinga master, S3 backends, dedicated VPC).
- **`dev`** — dev environment app stack (EC2 instances, AWS managed DB, networking) plus VPC peering to observability VPC.
- **`staging`** — staging environment app stack, same shape as dev.
- **`prod`** — production environment app stack, same shape as dev/staging but with prod-appropriate sizing and isolation.

**Stack references** are used for cross-stack dependencies:

```typescript
const observability = new pulumi.StackReference('untp/observability');
const otelEndpoint = observability.getOutput('otelGatewayEndpoint');
```

Each app stack reads observability stack outputs (collector endpoint, Grafana URL, Loki endpoint, Icinga master endpoint) to configure the apps deployed within it.

**Shared resource definitions** (droplet sizing, base AMI, networking patterns, deployment scripts) are factored into reusable Pulumi components or functions, so dev/staging/prod stacks share most of their definition and differ only in inputs (instance sizes, database sizes, retention periods).

**Secrets** are managed via Pulumi's secret support, backed by AWS Secrets Manager. Pulumi stack configs reference secret values; AWS Secrets Manager holds the actual values. Rotation happens in AWS Secrets Manager; Pulumi pulls current values at deploy time.

**Pulumi state backend** uses Pulumi Cloud or an S3 backend (whichever is currently configured). State is backed up as part of the disaster-recovery story.

We chose this design because stack-per-environment is the standard Pulumi pattern for the use case, it isolates per-environment configuration cleanly, and stack references provide a clean mechanism for cross-stack dependencies without coupling.

## Consequences

**What becomes easier:**
- Each environment is fully independent — `pulumi up --stack dev` cannot accidentally modify staging or prod.
- Environment-specific configuration (instance sizes, retention periods, scaling parameters) lives in the stack's config, not buried in conditional logic.
- The observability stack can be updated independently of the app environments — `pulumi up --stack observability` doesn't require app redeploys.
- Reusable Pulumi components mean dev/staging/prod definitions are kept consistent with minimal duplication.
- Pulumi-native secret support integrates with AWS Secrets Manager cleanly.

**What becomes harder:**
- Four stacks to maintain. Each one's state must be backed up. Each one's drift must be monitored.
- Cross-stack updates that touch both observability and apps require coordinated deploys (deploy observability first, then app stacks pick up new outputs).
- Stack reference outputs are dynamic — if the observability stack rotates credentials, app stacks pick up the new values on their next deploy but won't auto-reconfigure running apps. Restarts may be needed for some changes.
- Onboarding new contributors requires explaining the four-stack structure and how stack references work.

## Alternatives Considered

### Single Pulumi stack covering all environments with conditional logic

Rejected because it creates a single point of failure — a bad `pulumi up` could affect all environments simultaneously. Stack-per-environment provides strong isolation that the single-stack design cannot.

### Stack-per-environment but no separate observability stack

Considered. Rejected because the observability infrastructure has a different change cadence than the apps — Grafana dashboards and alert configurations update frequently while app infrastructure changes rarely. Separate stacks let each evolve independently. Also: a shared observability stack across all environments (separate ADR) is operationally simpler than three replicated observability stacks.

### Terraform instead of Pulumi

Rejected. The repository already uses Pulumi; switching infrastructure tooling as part of this restructure adds unrelated risk for no clear benefit. Pulumi's programming-language-based configuration is well-suited to the kind of reusable components this design needs.

### Secrets in Pulumi config (encrypted) without AWS Secrets Manager

Rejected because secret rotation is harder when secrets live in Pulumi config — every rotation requires a Pulumi config update and stack apply. AWS Secrets Manager handles rotation as a first-class concern.

## References

- ADR: Three deployment tiers (dev, staging, prod)
- ADR: Shared single observability stack
- ADR: Backup and disaster recovery considerations
- Pulumi stack references documentation
