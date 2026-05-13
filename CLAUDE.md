# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a monorepo for the UNTP (UN Transparency Protocol) test suite and reference implementation. It includes:
- **Reference Implementation**: Web UI for issuing/verifying UNTP credentials (`packages/reference-implementation/`)
- **Services Package**: Core business logic, credential processing, EPCIS events, DID management, and external service adapters
- **Components Package**: Shared React component library
- **UNTP Playground**: Credential validation tool
- **Test Suites**: Technical and semantic interoperability testing

## Tech Stack

- **Monorepo**: pnpm Workspaces
- **Language**: TypeScript (ESNext)
- **Frontend**: Next.js 15 (App Router), React 19, Material-UI, Tailwind CSS
- **Backend**: Next.js API routes, Prisma ORM, PostgreSQL
- **Auth**: NextAuth.js 5 with Keycloak (OAuth2/OIDC)
- **Testing**: Jest (unit), Cypress (E2E), Storybook (components)
- **Infrastructure**: Docker Compose with dependent services

## Required Environment

- **Node**: >= 22.22.2
- **pnpm**: 9.15.4 (via Corepack)
- **Docker**: Latest with Compose

## Essential Commands

### Initial Setup
```bash
# Install Node via NVM; pnpm via Corepack
nvm install 22.22.2 && nvm use 22.22.2
corepack enable

# Environment file
cp .env.example .env  # All defaults work for local dev

# Start dependent services (VCKit, Storage, IDR, Keycloak, Postgres)
docker compose up -d

# Install, build, and start
pnpm install
pnpm build
pnpm start
```

Access the reference implementation at http://localhost:3003 (admin@example.com / changeme)

### Daily Development
```bash
pnpm start                          # Start RI dev server (hot reload)
pnpm start:untp-playground          # Start playground on port 4001
pnpm build:services                 # Rebuild services after changes
pnpm build:components               # Rebuild components after changes
pnpm build                          # Full build (services + components + test-suite)
```

### Testing
```bash
pnpm test                           # All tests across all packages
pnpm test:coverage                  # Merged coverage report
pnpm test:services                  # Services package only
pnpm test:reference-implementation  # Reference implementation only
pnpm test:components                # Components only

# E2E Testing (per-app suites; see packages/<app>/e2e/README.md for details)

# RI open mode
docker compose -f docker-compose.e2e.yml --profile ri up -d --build
pnpm test:e2e:ri:open                                                          # or pnpm test:e2e:ri (default)
pnpm test:e2e:ri:open-ui                                                       # Interactive UI
docker compose -f docker-compose.e2e.yml --profile ri down -v

# RI closed mode — the closed-mode override MUST be passed to every compose verb
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-closed.yml --profile ri up -d --build
pnpm test:e2e:ri:closed
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-closed.yml --profile ri down -v

# Playground
docker compose -f docker-compose.e2e.yml --profile playground up -d --build
pnpm test:e2e:playground
pnpm test:e2e:playground:open-ui
docker compose -f docker-compose.e2e.yml --profile playground down -v
```

### Database
```bash
cd packages/reference-implementation
pnpm prisma studio            # Visual DB editor (localhost:5555)
pnpm prisma migrate dev       # Create/apply migrations
```

### Code Quality
```bash
pnpm lint:check               # ESLint across packages
```

### Other
```bash
pnpm storybook:components                  # Component library docs
pnpm storybook:reference-implementation    # RI component docs
pnpm build-clean                           # Remove all artifacts and node_modules
```

## Architecture Patterns

### Monorepo Structure
```
tests-untp/
├── packages/
│   ├── services/                       # Core logic (TypeScript library)
│   ├── components/                     # React component library
│   ├── reference-implementation/       # Next.js reference implementation (and e2e/)
│   ├── untp-playground/                # Validation tool (and e2e/)
│   └── untp-test-suite/                # CLI test suite
└── documentation/                      # Docusaurus site
```

### Service Registry Pattern
The services package uses a type-safe adapter registry for pluggable implementations:
- `ServiceType` enum: IDR, STORAGE, VC
- `AdapterType` enum: VCKIT (extensible)
- `AdapterRegistry`: Type-safe mapping of services to adapters
- `AdapterRegistryEntry`: Schema validation + factory function pattern

Example: `registry[ServiceType.VC][AdapterType.VCKIT]` returns factory for VCKit VC adapter.

DID adapters are resolved via the separate `didAdapterRegistry`, exported from `server.ts`.

### Adapter Pattern
External integrations use interfaces + implementations:
- `VerifiableCredentialService` → `VCKitAdapter`
- `StorageService` → `UncefactStorageAdapter`
- `EncryptionService` → `AesGcmEncryptionAdapter`
- `KeyProvider` → `LocalKeyGenerator`

### Services Package Responsibilities
- UNTP credential processing (DPP, DIA, DFR, DCC)
- EPCIS events (object, aggregation, transformation, transaction, association, traceability)
- DID management (create, verify `did:web`, `did:web+vh`)
- Encryption/decryption (AES-GCM)
- Identity scheme handling (GS1)

### Reference Implementation Architecture
- **Database**: Prisma ORM with entities: User, Organization, Did, Credential, ServiceInstance, Service, Adapter
- **API Routes**: `/src/app/api/v1/` - `/dids`, `/credentials`, `/auth`
- **Auth**: Keycloak via NextAuth.js with organization-level branding
- **Config**: Tenant configuration via database (replacing legacy app-config.json)

## Development Workflow

### Making Changes to Services
1. Edit code in `packages/services/src/`
2. Run `pnpm build:services`
3. Changes auto-imported into the reference implementation (hot reload)

### Making Changes to Components
1. Edit code in `packages/components/src/`
2. Run `pnpm build:components`
3. Consumed by the reference implementation (hot reload)

### Database Changes
1. Edit `packages/reference-implementation/prisma/schema.prisma`
2. Run `cd packages/reference-implementation && pnpm prisma migrate dev`
3. Restart the reference implementation

### Configuration Changes
- Tenant configuration is managed via the database

## Testing Requirements

- Write tests for all new features
- Run `pnpm test` before committing
- Ensure 100% coverage for services package
- E2E tests must pass before merging

## Keep ADRs in sync with the code

Before opening a PR, audit whether any change in the PR touches behaviour, conventions, or topology already recorded in an ADR under `docs/adrs/`. The `creating-adrs` skill gate enforces *evaluation* (was an architectural decision made?); this rule covers *synchronisation* (does the existing ADR text still match reality?).

Three outcomes, three responses:

- **Implementation changed, decision unchanged** (e.g. command examples in an ADR body now use `pnpm` instead of `yarn` after a package-manager migration, or workflow filenames moved): add a dated `Update (YYYY-MM-DD)` line to the ADR header (under `Status:`) pointing at the new state and any relevant PRs / superseding ADRs. **Do not rewrite the body.** The body is historical record — what was true at the time of the decision. Editing it silently rewrites history.
- **Decision changed**: open or update an ADR via the `creating-adrs` skill. If the change supersedes a prior decision, mark the prior ADR's status `superseded` with a forward link, and reference the prior ADR from the new one's `References` section.
- **Decision retired entirely**: mark `superseded` or `deprecated` in the status with a one-line explanation.

ADRs that go stale silently are worse than no ADRs at all — they lock in misleading history and re-litigate settled decisions. When in doubt about which outcome applies, ask before editing the body.

## Critical Dependencies

### Docker Services (must be running)
- VCKit API - Verifiable credential operations
- Storage Service - UNTP credential storage
- Identity Resolver Service (IDR) - Identifier resolution
- PostgreSQL (vckit-db, ri-db) - Databases
- Keycloak - OAuth2/OIDC provider
- MinIO - Object storage for IDR service

## Important Notes

### Path Aliases
All packages use `@/*` → `./src/*` in TypeScript

### Build Output
- Services: `packages/services/build/` (CommonJS + ESM with `.d.ts`)
- Components: `packages/components/build/`

### TypeScript Configuration
Each package has its own `tsconfig.json` (no centralized config)

### Test Configuration
- Base config: `jest.config.base.js`
- Package-specific: `packages/*/jest.config.{mjs,ts}`

### Environment Variables
- Root `.env` file (use `.env.example` as template)
- No changes needed for local development defaults

### Version Management
- All packages share same version (Lerna managed)
- See `RELEASE_MANAGEMENT_GUIDE.md` for release process
- Use conventional commits (see `CONTRIBUTING.md`)

### DO NOT
- Mix E2E and standard Docker Compose setups
- Run services without dependent Docker services
- Skip test runs before committing
