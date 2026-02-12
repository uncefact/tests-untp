# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a monorepo for the UNTP (UN Transparency Protocol) test suite and reference implementation. It includes:
- **Reference Implementation (mock-app)**: Web UI for issuing/verifying UNTP credentials
- **Services Package**: Core business logic, credential processing, EPCIS events, DID management, and external service adapters
- **Components Package**: Shared React component library
- **UNTP Playground**: Credential validation tool
- **Test Suites**: Technical and semantic interoperability testing

## Tech Stack

- **Monorepo**: Yarn Workspaces with Lerna
- **Language**: TypeScript (ESNext)
- **Frontend**: Next.js 15 (App Router), React 19, Material-UI, Tailwind CSS
- **Backend**: Next.js API routes, Prisma ORM, PostgreSQL
- **Auth**: NextAuth.js 5 with Keycloak (OAuth2/OIDC)
- **Testing**: Jest (unit), Cypress (E2E), Storybook (components)
- **Infrastructure**: Docker Compose with dependent services

## Required Environment

- **Node**: >= 20.12.2
- **Yarn**: 1.22.22
- **Docker**: Latest with Compose

## Essential Commands

### Initial Setup
```bash
# Install Node/Yarn via NVM
nvm install 20.12.2 && nvm use 20.12.2
npm install -g yarn@1.22.22

# Environment file
cp .env.example .env  # All defaults work for local dev

# Start dependent services (VCKit, Storage, IDR, Keycloak, Postgres)
SEEDING=true docker compose up -d

# Install, build, and start
yarn install
yarn build
yarn start
```

Access mock-app at http://localhost:3003 (admin@example.com / changeme)

### Daily Development
```bash
yarn start                    # Start mock-app dev server (hot reload)
yarn start:untp-playground    # Start playground on port 4001
yarn build:services           # Rebuild services after changes
yarn build:components         # Rebuild components after changes
yarn build                    # Full build (services + components + test-suite)
```

### Testing
```bash
yarn test                     # All tests across all packages
yarn test:coverage            # Merged coverage report
yarn test:services            # Services package only
yarn test:mock-app            # Mock-app only
yarn test:components          # Components only

# E2E Testing (separate Docker setup)
SEEDING=true docker compose -f docker-compose.e2e.yml up -d --build
yarn test:run-cypress         # Headless
yarn test:open-cypress        # Interactive UI
docker compose -f docker-compose.e2e.yml down  # Cleanup
```

### Database
```bash
cd packages/mock-app
yarn prisma studio            # Visual DB editor (localhost:5555)
yarn prisma migrate dev       # Create/apply migrations
```

### Code Quality
```bash
yarn lint                     # ESLint across packages
```

### Other
```bash
yarn storybook:components     # Component library docs
yarn storybook:mock-app       # Mock-app component docs
yarn build-clean              # Remove all artifacts and node_modules
```

## Architecture Patterns

### Monorepo Structure
```
tests-untp/
├── packages/
│   ├── services/          # Core logic (TypeScript library)
│   ├── components/        # React component library
│   ├── mock-app/          # Next.js reference implementation
│   ├── untp-playground/   # Validation tool
│   └── untp-test-suite/   # CLI test suite
├── e2e/                   # Cypress tests
├── documentation/         # Docusaurus site
└── seeding/              # IDR data seeding scripts
```

### Service Registry Pattern
The services package uses a type-safe adapter registry for pluggable implementations:
- `ServiceType` enum: DID (extensible)
- `AdapterType` enum: VCKIT (extensible)
- `AdapterRegistry`: Type-safe mapping of services to adapters
- `AdapterRegistryEntry`: Schema validation + factory function pattern

Example: `registry[ServiceType.DID][AdapterType.VCKIT]` returns factory for VCKit DID adapter.

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

### Mock-App Architecture
- **Database**: Prisma ORM with entities: User, Organization, Did, Credential, ServiceInstance, Service, Adapter
- **API Routes**: `/src/app/api/v1/` - `/dids`, `/credentials`, `/auth`
- **Auth**: Keycloak via NextAuth.js with organization-level branding
- **Config**: `app-config.json` determines app setup (copied to src at build time via `yarn copy-config`)

## Development Workflow

### Making Changes to Services
1. Edit code in `packages/services/src/`
2. Run `yarn build:services`
3. Changes auto-imported into mock-app (hot reload)

### Making Changes to Components
1. Edit code in `packages/components/src/`
2. Run `yarn build:components`
3. Consumed by mock-app (hot reload)

### Database Changes
1. Edit `packages/mock-app/prisma/schema.prisma`
2. Run `cd packages/mock-app && yarn prisma migrate dev`
3. Restart mock-app

### Configuration Changes
- Modifying `app-config.json` requires stopping and restarting mock-app
- For E2E tests, use `e2e/cypress/fixtures/app-config.json`

## Testing Requirements

- Write tests for all new features
- Run `yarn test` before committing
- Ensure 100% coverage for services package
- E2E tests must pass before merging

## Critical Dependencies

### Docker Services (must be running)
- VCKit API - Verifiable credential operations
- Storage Service - UNTP credential storage
- Identity Resolver Service (IDR) - Identifier resolution
- Mock GS1 IDR - GS1 resolver stand-in
- PostgreSQL (vckit-db, ri-db) - Databases
- Keycloak - OAuth2/OIDC provider
- MinIO - Object storage for IDR services

### Data Seeding
- IDR services must be seeded for `app-config.json` to work
- Use `SEEDING=true` flag with docker compose
- Manual seeding: `./seeding/idr-data.sh && ./seeding/mock-gs1-data.sh`
- Reset: Delete `minio_data/` directories, re-run seed scripts

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
- Commit changes to `app-config.json` without testing E2E
- Skip test runs before committing
