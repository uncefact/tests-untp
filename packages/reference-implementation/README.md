## Reference Implementation

The **Reference Implementation (RI)** provides an environment for organisations and implementers to experiment with the **UN Transparency Protocol (UNTP)** and its extensions before committing to changes in their production systems. It acts as an **on-ramp**, allowing users to create, issue, and test verifiable credentials in a controlled environment.

The RI is also used to facilitate **pilots and demonstrations**, helping stakeholders showcase the value of UNTP and its extensions at low cost.

For a full understanding of the architecture and how the RI fits together, see the [documentation site](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/overview).

### Environment Variables

Environment variables control how the RI is configured.

- **Local development**: variables are loaded from the root `.env` file.
- **Docker Compose**: variables are passed into the container through the compose configuration.

Copy the environment template to the repository root:

```bash
cd ../..
cp .env.example .env
```

The default values in `.env.example` are sufficient for local development — no changes required.

### Quick Start

See the [Quick Start guide](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/quick-start) for getting the full stack running with Docker Compose.

For local development with hot reloading, stop the RI container and run it locally from the **repository root**.

> **Warning**: Running the RI on the host needs a one-line Keycloak change first. The Compose config sets `KC_HOSTNAME` to `http://keycloak:8080` for the containerised RI, but the host process cannot resolve `keycloak:8080` and the issuer in Keycloak's tokens would not match, so API authentication fails. Before the steps below, change `KC_HOSTNAME` to `http://localhost:8080` in `docker-compose.yml` and recreate Keycloak with `docker compose up -d keycloak`. Revert it to `http://keycloak:8080` before running the RI in Docker again.

```bash
docker compose stop ri
pnpm build
pnpm start
```

> **Note**: Ensure you have completed the [Prerequisites](../../README.md#prerequisites) in the root README before running locally.

The RI runs on [http://localhost:3003](http://localhost:3003) with hot reloading enabled.

### Key Documentation

- [System Architecture](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/system-architecture) — how the RI connects to its dependent services
- [Service Architecture](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/services/service-architecture) — adapter pattern, encryption, service resolution
- [Authentication](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/authentication) — browser sessions, service accounts, and obtaining tokens
- [API Documentation](http://localhost:3003/api-docs) — interactive Swagger UI (requires running instance)

### Credential Issuance and DID Ownership

When issuing a credential, the `issuer.id` in the credential payload must be a DID that belongs to the authenticated tenant or a [system default DID](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/api/dids#system-dids-vs-tenant-dids). The VC service used for signing is determined by the DID's associated service instance, not the tenant's primary. This ensures signing always happens on the VC service that holds the DID's key material.

**did:web and HTTPS**: Managed DIDs use the `did:web` method, which requires the DID document to be resolvable over HTTPS. In local Docker development, VCKit runs on HTTP with an internal hostname, so managed DIDs created locally cannot be used for credential issuance. Use the system default DID for local development, or deploy VCKit with a publicly resolvable HTTPS domain.

See the [Credentials API documentation](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/api/credentials) for the full issuance pipeline.

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

### Database

The RI uses **PostgreSQL** for all application-level data and **Prisma** as the database client.

The Prisma client is generated automatically during `pnpm build`. If the schema changes, apply migrations:

```bash
pnpm prisma migrate dev
```

View or modify data using Prisma Studio:

```bash
pnpm prisma studio --config=prisma/prisma.config.ts
```

Accessible at [http://localhost:5555](http://localhost:5555).

**Directory structure:**

```
packages/reference-implementation/
├── prisma/
│   ├── prisma.config.ts       # Database connection configuration
│   ├── schema.prisma          # Schema definition
│   └── seed.ts                # System tenant and default data seeding
└── src/lib/prisma/
    ├── generated/             # Auto-generated Prisma client
    └── prisma.ts              # Prisma client instance
```

### Testing

```bash
pnpm test          # Run all RI tests
```

See the root [README](../../README.md) for E2E testing instructions.
