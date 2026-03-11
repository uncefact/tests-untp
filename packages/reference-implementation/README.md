## Reference Implementation

The **Reference Implementation (RI)** provides an environment for organisations and implementers to experiment with the **UN Transparency Protocol (UNTP)** and its extensions before committing to changes in their production systems. It acts as an **on-ramp**, allowing users to create, issue, and test verifiable credentials in a controlled environment.

The RI is also used to facilitate **pilots and demonstrations**, helping stakeholders showcase the value of UNTP and its extensions at low cost.

For a full understanding of the architecture and how the RI fits together, see the [documentation site](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/overview).

### Quick Start

See the [Quick Start guide](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/quick-start) for getting the full stack running with Docker Compose.

For local development with hot reloading, stop the RI container and run it locally:

```bash
docker compose stop ri
yarn install
yarn build
yarn start
```

The RI runs on [http://localhost:3003](http://localhost:3003) with hot reloading enabled.

### Key Documentation

- [System Architecture](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/system-architecture) — how the RI connects to its dependent services
- [Service Architecture](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/services/service-architecture) — adapter pattern, encryption, service resolution
- [Authentication](https://uncefact.github.io/tests-untp/docs/next/reference-implementation/authentication) — browser sessions, service accounts, and obtaining tokens
- [API Documentation](http://localhost:3003/api-docs) — interactive Swagger UI (requires running instance)

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

### Database

The RI uses **PostgreSQL** for all application-level data and **Prisma** as the database client.

The Prisma client is generated automatically during `yarn build`. If the schema changes, apply migrations:

```bash
yarn prisma migrate dev
```

View or modify data using Prisma Studio:

```bash
yarn prisma studio --config=prisma/prisma.config.ts
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
yarn test          # Run all RI tests
```

See the root [README](../../README.md) for E2E testing instructions.
