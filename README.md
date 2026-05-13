# tests-untp

A comprehensive suite of tools for implementing and demonstrating the [UN Transparency Protocol (UNTP)](https://untp.unece.org/) specification. The repository includes:

1. **[Reference Implementation](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/overview)**: A multi-tenant application for issuing, storing, and verifying UNTP-compliant verifiable credentials such as Digital Product Passports (DPPs), Digital Conformity Credentials (DCCs), and more.
2. **[Test Suites](https://uncefact.github.io/tests-untp/docs/next/test-suites)**: Technical interoperability, semantic interoperability, and graph validation testing.
3. **[Playground](https://uncefact.github.io/tests-untp/docs/next/untp-playground)**: A web application for validating UNTP credentials against the specification.
4. **[Documentation Site](https://uncefact.github.io/tests-untp/)**: Comprehensive resources covering setup, configuration, and usage.

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose (latest version recommended)
- Node.js >= 20.12.2; pnpm 9.15.4 (managed via Corepack)

We recommend using [Node Version Manager (NVM)](https://github.com/nvm-sh/nvm) to manage Node.js versions:

```bash
nvm install 20.12.2
nvm use 20.12.2
corepack enable
pnpm install
```

### Start with Docker Compose

The fastest way to get everything running:

```bash
git clone https://github.com/uncefact/tests-untp.git
cd tests-untp
cp .env.example .env
docker compose up -d --build
```

This starts the Reference Implementation and all dependent services. See the [Quick Start guide](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/quick-start) for full details.

### Resetting Services

To tear down all containers **and remove all data volumes** (databases, Keycloak realm data, etc.):

```bash
docker compose down -v
```

> **Warning**: The `-v` flag removes all named volumes. This deletes all database data and forces Keycloak to re-import its realm configuration on the next start. Only use this when you need a clean slate.

To reset a specific service's data without affecting others, remove its volume individually. For example, to reset Keycloak so it re-imports the latest realm configuration:

```bash
docker compose down
docker volume rm tests-untp_keycloak-data
docker compose up -d --build
```

### Local Development

For development with hot reloading, stop the Reference Implementation container and run it locally instead:

```bash
docker compose stop ri
pnpm build
pnpm start
```

> **Note**: Ensure you have completed the [Prerequisites](#prerequisites) before running locally.

The dependent services continue running in Docker while the Reference Implementation runs locally at [http://localhost:3003](http://localhost:3003). See [Authentication](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/authentication) for how to obtain an API token.

## Architecture

The Reference Implementation is an orchestration layer that delegates to several dependent services:

| Service | Purpose |
|---------|---------|
| **Verifiable Credential Service** | DID management, credential signing and verification |
| **Storage Service** | Credential and template storage |
| **Identity Resolver Service** | Links identifiers to associated credentials |
| **Identity Provider (Keycloak)** | Authentication and tenant resolution |
| **PostgreSQL** | Database for the Reference Implementation and VC service |

For a detailed overview of how these components connect, see [System Architecture](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/system-architecture) and [Service Architecture](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/services/service-architecture).

## Documentation

The documentation site is included in the Docker Compose stack at [http://localhost:3002](http://localhost:3002), or view the deployed version at [https://uncefact.github.io/tests-untp/](https://uncefact.github.io/tests-untp/).

Key pages:

- [Overview](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/overview) — what the Reference Implementation does and why
- [Quick Start](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/quick-start) — getting started with Docker Compose
- [System Architecture](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/system-architecture) — how the components connect
- [Authentication](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/authentication) — browser sessions and service accounts
- [API Documentation](http://localhost:3003/api-docs) — interactive Swagger UI (requires running instance)

To run the documentation site outside Docker:

```bash
cd documentation
pnpm install
pnpm start
```

## Development

```bash
pnpm build                    # Full build (services + components + test-suite)
pnpm start                    # Start Reference Implementation dev server
pnpm test                     # Run all tests
pnpm lint:check               # ESLint across packages
```

## Observability

The reference implementation is instrumented with OpenTelemetry. To run the local trace stack (Tempo + OTel agent + Grafana) alongside the app, use `docker compose --profile local-observability up -d --build`. See [`docs/observability.md`](docs/observability.md) for the full guide.

## End-to-End Testing

E2E tests use Cypress and support both local Docker Compose and deployed instances. Each app owns its own E2E suite:

- [`packages/reference-implementation/e2e/`](packages/reference-implementation/e2e/README.md) for the reference implementation.
- [`packages/untp-playground/e2e/`](packages/untp-playground/e2e/README.md) for the playground.

See each suite's README for setup, local testing, deployed instance prerequisites, and tenant mode configuration.

## Release Management

See the [release management guide](RELEASE_MANAGEMENT_GUIDE.md) and [release guide](RELEASE_GUIDE.md).

## Contributions

See [CONTRIBUTING.md](CONTRIBUTING.md).
