# ADR: Single root Docker Compose file with profile-based activation

- **Date:** 2026-05-12
- **Status:** accepted

## Context

The repository runs two apps (`reference-implementation`, `playground`) plus their dependent services (15+ services across both) plus observability sidecars (Vector, OTel collector, Icinga agent) plus, optionally, a local LGTM stack for fully-local observability testing.

The naive approach of one compose file per concern (apps, sidecars, local observability) produces multiple `-f` flags on every `docker compose` invocation, which is cumbersome and easy to get wrong. Per-app compose files duplicate shared services. Mixing all concerns into a single unstructured compose file confuses what should run when.

We need a single source of truth for what runs on any given EC2 instance and in any given local-dev mode, with explicit opt-in for observability tooling.

## Decision

We adopt a **single root `docker-compose.yml`** at the repository root, with services tagged by Compose profiles to control activation.

**Service tagging:**

- **Apps and shared services** (`reference-implementation`, `playground`, their dependent services): no profile tag. Always run.
- **Observability sidecars** (Vector, OTel agent, Icinga agent): tagged `['observability', 'local-observability']`. Active for either profile.
- **Local LGTM stack** (local Loki, local Prometheus, local Tempo, local Grafana): tagged `['local-observability']`. Active only for that profile.

**Invocation patterns:**

```bash
# Apps only — default local dev
docker compose up

# Apps + observability sidecars (the production shape, locally)
docker compose --profile observability up

# Apps + sidecars + local LGTM stack (full local fidelity)
docker compose --profile local-observability up
```

Because sidecars belong to both profiles, the `local-observability` profile is a superset that automatically activates the sidecars. Devs use one flag for whichever mode they want.

**Configuration:**

- Observability agent config templates live at `deploy/observability-configs/` and are mounted into containers via volume mounts. Configs are templated by env var substitution at compose-up time, using values from `.env`.
- Local LGTM stack configs (Grafana datasources, dashboards, Loki/Prometheus/Tempo configs) live at `deploy/observability-local/`.

**EC2 deployment** uses the same compose file with environment-specific env vars (set by Pulumi or in instance user-data) and the `observability` profile:

```bash
DEPLOYMENT_ENVIRONMENT=prod \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-gateway.obs.internal:4317 \
LOKI_ENDPOINT=http://loki.obs.internal:3100 \
ICINGA_MASTER=icinga.obs.internal \
docker compose --profile observability up -d
```

**Same compose file is the truth for both local dev and production.** Differences are environment values, not file content.

We chose this design because it eliminates drift between local and production setups, gives devs a clear UX (one flag picks the mode), and keeps the observability concern explicitly opt-in rather than always-on locally.

## Adoption notes

The walking-skeleton implementation of this ADR ships across the per-package E2E split, in two stages, both targeting `docker-compose.e2e.yml` only.

**Stage 1, playground (#579):** introduced the profile pattern and added the `playground` profile.

**Stage 2, reference implementation (#582):** kept the same profile shape and added the buildx GHA cache backend on the `app` and `untp-playground` services so the new upstream `build-e2e-images` CI job and the downstream matrix entries share a single image build.

**Stage 3, observability walking skeleton (#592):** introduced the broader-vision profile shape on the root `docker-compose.yml`. Added an `otel-agent` sidecar tagged `['observability', 'local-observability']` and a `tempo` plus `grafana` pair tagged `['local-observability']`. The reference implementation gains `OTEL_EXPORTER_OTLP_ENDPOINT` / `DEPLOYMENT_ENVIRONMENT` env vars; the app and shared services remain untagged so default-profile runs are unaffected.

The current profile tagging is:

- `ri` profile (E2E compose): `app`, `vckit-api`, `db`, `storage-service`, `identity-resolver-service`, `identity-resolver-service-object-store`, `e2e-ri-db`, `e2e-keycloak`.
- `playground` profile (E2E compose): `untp-playground`, `vckit-api`, `db`.
- `vckit-api` (and its `db` dependency) are tagged with both E2E profiles since the playground calls `vckit-api` for credential verification.
- `observability` profile (root compose): `otel-agent`.
- `local-observability` profile (root compose): `otel-agent`, `tempo`, `grafana`. Sidecars are shared with `observability` so `local-observability` is the superset.

The broader vision (a single `docker-compose.yml` at repo root covering local dev, observability sidecars, and the local LGTM stack) is being adopted incrementally. Vector log shipping (#593), Prometheus (#594), and the central gateway target for the agent (#595) are the remaining pieces.

Note: when every service in a compose file is tagged with a profile, `docker compose up` with no profile flag starts nothing. CI invocations always pass `--profile ri` or `--profile playground`; local devs running the E2E stack must do the same.

## Consequences

**What becomes easier:**
- New contributors run `docker compose up` and get a working local environment without observability noise.
- Devs working on instrumentation or dashboards run `docker compose --profile local-observability up` and get the full local stack with one flag.
- Production deploys use the same compose file as local — what runs in dev matches what runs in prod, modulo env vars.
- Adding a new service is a single PR to one compose file.

**What becomes harder:**
- Service naming must be globally unique within the compose file. If reference-implementation has a `postgres` service and playground has a `postgres` service, they need distinct names (`ref-impl-postgres`, `playground-postgres`). Audit and rename as part of the migration.
- Single compose file at the root grows large. Acceptable but worth periodic refactoring (e.g., factoring shared service definitions into reusable YAML anchors).
- Compose profiles are a relatively recent feature; very old Compose versions don't support them. Pin Compose version in `.env` or document the minimum.
- Cross-cutting changes (e.g., updating Prisma version) touch only one file but affect both apps. Reviews need to consider both apps' implications.

## Alternatives Considered

### Separate compose file per app (`apps/<app>/docker-compose.yml`)

Rejected because shared services (vckit, identity resolver, etc.) would be duplicated across two files, with drift risk. Also produces inconsistent local dev experience — devs have to choose which app's compose to run.

### Separate compose files for app vs observability (`docker-compose.yml` + `docker-compose.observability.yml`, mixed with `-f`)

Rejected because the multiple `-f` invocation is cumbersome and the cross-compose Docker network setup adds complexity. Profiles within a single file are cleaner.

### Observability agents as systemd services on the host instead of containers

Rejected because the agents are infrastructure-as-code in the same way the apps are. Containerising them keeps the deployment story consistent: everything is a container, everything is declared in compose.

### Separate compose files per environment (dev/staging/prod)

Rejected because the environments differ only in configuration values, not in service composition. Templating env vars is the right mechanism, not duplicated compose files.

### Default `COMPOSE_PROFILES` env var to activate observability automatically

Considered. Rejected because most local dev doesn't need observability and forcing it on by default creates noise and resource overhead. Opt-in via explicit `--profile` flag is the right default.

## References

- ADR: Observability host agents and instrumentation
- ADR: Three deployment tiers (dev, staging, prod)
- Docker Compose profiles documentation
