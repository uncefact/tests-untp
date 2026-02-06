<!-- TODO: Harmonise READMEs -->

## Reference Implementation

The **Reference Implementation (RI)** provides an environment for organisations and implementers to experiment with the **UN Transparency Protocol (UNTP)** and its extensions before committing to changes in their production systems.
It acts as an **on-ramp**, allowing users to create, issue, and test credentials in a controlled environment.

The RI is also used to facilitate **pilots and demonstrations**, helping stakeholders showcase the value of UNTP and its extensions at low cost.
Each organisation in the environment includes its own configuration (name, logo, and colours) so that pilot participants can be easily distinguished and collaborate with their colleagues within the same organisation.

### Persistence Layer

The **persistence layer** ensures the Reference Implementation maintains state across sessions.
It stores the application data required to manage users, organisations, and issued items so participants can log back in and continue where they left off.

Credential issuance and verification are handled by **VCKit**, and credentials themselves are stored in the **Storage Service**.
The persistence layer holds the supporting data — user records, organisation details, and references to issued credentials — that allows the application to function cohesively.

#### Environment Variables

Environment variables control how the Reference Implementation is configured.

- **Local development:** variables are automatically loaded from the root `.env` file.
- **Docker Compose:** variables are passed directly into the container environment through the compose configuration.

The **Next.js** application also loads variables from the root `.env`.
In local mode, values are read from the file; in Docker mode, they are injected at runtime.

**Setup:**

Copy the environment template to the repository root:

```bash
cd ../..
cp .env.example .env
```

The default values in `.env.example` are sufficient for local development - no changes required.

**File structure:**

```
tests-untp/                            # Repository root
├── .env.example                       # Template environment configuration
├── .env                               # Your local environment variables (copy from .env.example)
├── docker-compose.yml                 # Passes environment variables to containers
└── packages/
    └── mock-app/
        ├── next.config.ts             # Loads environment variables from repository root
        └── prisma/
            └── prisma.config.ts       # Loads environment variables from repository root and constructs database URL from environment variables
```

#### Database

The Reference Implementation uses **Postgres** to store all application-level data.

#### Database Client

The Reference Implementation uses **Prisma** as the database client.
It defines the schema, manages migrations, and provides a simple interface for database operations.

The Prisma client is generated automatically when running `yarn build` or `yarn dev`.
If the schema changes, apply migrations to update the database:

```bash
yarn prisma migrate dev
```

You can view or modify data using Prisma Studio:

```bash
yarn prisma studio --config=prisma/prisma.config.ts
```

Accessible at `http://localhost:5555`.

**Directory structure:**

```
packages/mock-app/
├── prisma/
│   ├── prisma.config.ts       # Database connection configuration
│   └── schema.prisma          # Schema definition
└── src/lib/prisma/
    ├── generated/             # Auto-generated Prisma client
    └── prisma.ts              # Prisma client instance
```

---

### Authentication Layer

The Reference Implementation uses **NextAuth.js** with **Keycloak** as the identity provider.

**Current protected routes:**

- `/dashboard` - Protected page route (will migrate to homepage once new RI functionality is built, replacing the old implementation)
- `/api/v1/*` - All versioned API endpoints

**Architecture:**

- Protected page routes use client-side session checks in their layout
- Protected API routes use middleware for edge-safe authentication
- Logout flow clears both application and IDP sessions

---

### Developer Instructions

#### Prerequisites

- Node.js ≥ 20.12.2
- Yarn ≥ 1.22.22
- Docker and Docker Compose

#### Environment Setup

Copy the environment template to the repository root:

```bash
cd ../..
cp .env.example .env
```

The default values are sufficient for local development - no changes required.

#### Start Services

Start the database and dependent services using Docker Compose:

```bash
SEEDING=true docker compose up -d
```

This starts Postgres, VCKit, Storage Service, Link Resolver, and other required services in the background. The ri-init service within the Docker Compose config will apply the migrations to the Reference Implementation's database.

See [configure-document.md](./documents/configure-document.md) for additional configuration details.

#### Build and Run

```bash
# Install dependencies from repository root
yarn install
yarn build

# Start the development server
yarn start
```

The RI runs on `http://localhost:3003` with hot reloading enabled.
The Prisma client is automatically generated during build or dev startup.

#### Login Credentials

Default credentials for development:

- **Email:** `admin@example.com`
- **Password:** `changeme`

Credentials are defined in the Keycloak realm import file `keycloak-realms`.
