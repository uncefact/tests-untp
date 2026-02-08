---
name: service-registry
description: Use when adding a new service type, adapter implementation, or service instance to the registry. Triggers include creating adapters, config schemas, resolver functions, registry entries, or modifying the service resolution flow.
---

# Service Registry Pattern

## Overview

All external service integrations follow a three-layer model: **service type** (the capability), **adapter** (the implementation), and **instance** (a configured deployment). This pattern enables multi-tenancy, runtime swapping, and consistent architecture across all service integrations.

The full specification lives at `.claude/specs/service-registry.md`. Always read it for authoritative details. This skill teaches the patterns and principles for working within the registry.

## The Three Layers

### Why Three Layers?

A single factory hardcoded to environment variables cannot support multiple implementations, per-tenant configuration, or multiple instances of the same provider. The three layers separate **what** (service type interface), **how** (adapter implementation), and **where** (instance configuration).

### Service Type

A category of capability with a defined interface contract. Examples: DID management, credential issuance, storage.

- Represented as a Prisma enum (`ServiceType`)
- Each type has an interface in `packages/services` (e.g., `IDidService`)
- New types require a Prisma migration to extend the enum
- Each type gets a dedicated resolver function in `packages/mock-app`

### Adapter

A concrete implementation of a service type interface. One provider (e.g., VCKit) can implement multiple service types.

- Represented as a Prisma enum (`AdapterType`)
- Lives in `packages/services` alongside the service type it implements
- Each adapter declares its config requirements via a Zod schema
- New adapters may require a Prisma migration if the provider is new

### Instance

A tenant-registered, configured deployment of an adapter. One tenant can have multiple instances of the same adapter type with different configurations.

- Stored as a row in the `ServiceInstance` database table
- Config is encrypted at rest (AES-256-GCM, entire JSON blob)
- System defaults are owned by `organizationId === "system"` and visible to all tenants
- Tenants can designate one instance as `isPrimary` per service type

## Naming Conventions

Consistent naming is critical. Every new service type and adapter must follow this:

| Dimension | Convention | Why |
|-----------|-----------|-----|
| Interface | `I{Domain}Service` | `Service` = the contract |
| Adapter class | `{Provider}{Domain}Service` | `Service` = consistent suffix, `I` prefix distinguishes interfaces |
| Service type enum | Short domain noun, `UPPER_SNAKE` | Keep enum values concise |
| Adapter type enum | Provider name, `UPPER_SNAKE` | One provider can span multiple types |

Both interfaces and adapter classes use the `Service` suffix. The `I` prefix on interfaces distinguishes contracts from implementations (e.g., `IDidService` vs `VCKitDidService`).

## Package Boundaries

### `packages/services` (pure TypeScript, no framework dependencies)

This package owns:
- Service interfaces (`IDidService`, `ICredentialService`, etc.)
- Adapter classes (`VCKitDidService`, etc.)
- Config Zod schemas with UI metadata
- The static registry map
- The encryption service interface and adapters

**Why here?** These are framework-agnostic. They could be consumed by any TypeScript application, not just Next.js.

### `packages/mock-app` (Next.js application)

This package owns:
- Prisma schema and migrations
- `ServiceInstance` repository (database CRUD)
- Resolver functions (`resolveDidService`, etc.)
- Encryption module instantiation (reads env var, creates adapter)
- Custom error classes
- API routes

**Why here?** These depend on Prisma, Next.js, and application infrastructure.

## Adding a New Adapter for an Existing Service Type

When adding a new implementation of an existing service type (e.g., a Mattereum DID adapter alongside VCKit):

1. **Create the adapter class** in `packages/services/src/{service-type}/adapters/` implementing the existing interface
2. **Create a Zod config schema** alongside the adapter in `packages/services/src/{service-type}/adapters/` with UI metadata and `sensitive` markers on secret fields
3. **Add the adapter type** to the `AdapterType` Prisma enum if the provider is new (requires migration)
4. **Add the registry entry** to the static registry map in `packages/services/src/registry/registry.ts`
5. **Export** all new types and classes from the package barrel
6. **Write tests** for the adapter and config schema

The resolver functions do not need to change — they work generically across all adapters for their service type.

## Adding a New Service Type

When adding an entirely new category of capability (e.g., a notification service):

1. **Define the interface** in `packages/services/src/{service-type}/types.ts`
2. **Create the first adapter** following the adapter steps above
3. **Add the service type** to the `ServiceType` Prisma enum (migration)
4. **Create a resolver function** in `packages/mock-app/src/lib/services/resolve-{type}-service.ts`
5. **Seed a system default** instance in `prisma/seed.ts`
6. **Add provenance FK** to any domain model that uses this service type (e.g., `serviceInstanceId` on `Did`)

## Config Schemas

### Why Zod + JSON Schema?

Zod is the source of truth — it validates at runtime and infers TypeScript types. JSON Schema is derived (via `zod-to-json-schema`) for portability and frontend form rendering. This gives type safety, runtime validation, and UI generation from a single definition.

### UI Metadata

Schemas include metadata that serves dual purposes:
- **Field labels/descriptions**: Drive dynamic form rendering in the frontend
- **`sensitive: true` marker**: Tells the UI to render as a password field AND tells the API to mask the value in GET responses

### Schema Location

Config schemas live alongside their adapter, in `packages/services/src/{service-type}/adapters/`, named `{provider}-{service-type}.schema.ts`. The schema defines what config that specific adapter needs — it's tightly coupled to the adapter's constructor. When the adapter changes, the schema changes. Co-location keeps things that change together near each other.

No separate test files for schemas — they are declarative Zod definitions with no logic to test. Schema correctness is verified implicitly through resolver and adapter tests.

## Instance Resolution

### Resolution Chain

The resolver functions follow a strict priority order:
1. **Explicit instance ID** (caller-specified) — verify ownership or system default
2. **Tenant primary** (`isPrimary === true` for that org + service type)
3. **System default** (`organizationId === "system"` for that service type)
4. **Throw** `ServiceResolutionError` if nothing found

This chain means tenants always have a working service (via system defaults) without any configuration, but can override with their own instances when ready.

### No Caching

Adapter instances are constructed fresh per request. The adapters are stateless HTTP wrappers — construction cost is negligible compared to the actual API calls they make. This avoids cache invalidation complexity and unbounded memory growth.

## Encryption

### Why a Separate Service?

The encryption service follows the same interface/adapter pattern but is NOT part of the database-backed registry. It is instantiated directly from an environment variable (`SERVICE_ENCRYPTION_KEY`). This avoids a circular dependency: you need encryption to read service instance configs, so encryption cannot itself be stored as a service instance.

### The Pattern Still Applies

Even though encryption is infrastructure-level, it uses `IEncryptionService` + `AesGcmEncryptionAdapter` so the implementation can be swapped (e.g., to AWS KMS) without refactoring consumers.

## Error Handling

Custom error classes extend `ServiceRegistryError` and use `instanceof` discrimination in route handlers:

| Error | Meaning | HTTP Status |
|-------|---------|-------------|
| `ServiceInstanceNotFoundError` | Explicit ID not found or not accessible | 404 |
| `ServiceResolutionError` | No instance available at all | 500 |
| `ConfigDecryptionError` | Key mismatch or corrupt ciphertext | 500 |
| `ConfigValidationError` | Decrypted config fails schema validation | 500 |

**Why typed errors?** They let route handlers return appropriate HTTP statuses without parsing error messages. Each error class communicates both what went wrong and how to respond.

## Common Mistakes

| Mistake | Why It's Wrong | Do This Instead |
|---------|---------------|-----------------|
| Reading env vars at runtime for service config | Database is the single source of truth after seeding | Use the resolver function |
| Creating a global/singleton adapter instance | Tenants have different configs; instances are per-request | Call the resolver per request |
| Adding `isDefault` to models | System defaults are identified by `organizationId === "system"` | Check org ownership |
| Putting config schemas in a separate directory from adapters | Schemas and adapters are tightly coupled — they change together | Co-locate in the adapter's directory |
| Skipping the `sensitive` marker on secret fields | Secrets will be returned unmasked in API responses | Always mark secrets in the schema |
| Hardcoding adapter construction in route handlers | Bypasses the registry, breaks multi-tenancy | Use `resolve{Type}Service()` |
