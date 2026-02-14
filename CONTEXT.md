# CONTEXT — Schemes & Identifiers

## Branch

`feat/ri-schemes-identifiers`

## Objective

Build the foundational layer for identifier scheme management and the Identity Resolver (IDR) service integration. This group establishes how the system knows about identifier types (ABN, GTIN, GLN, etc.), stores identifier instances against entities, and resolves identifiers to credential links via the IDR service.

## What We Are Building

### 1. Scheme Repository

A data layer for managing **identifier schemes** — the catalogue of identifier types the system understands.

Each scheme has:
- A name (e.g. "Australian Business Number")
- A namespace/prefix (e.g. `abn`, `gtin`, `gln`)
- A regex or validation pattern
- A primary URI structure (how this identifier resolves on the web)
- Whether it is a default/system scheme or tenant-defined

Schemes are **instance-level** (shared across tenants in a deployment) with the ability for tenants to register additional schemes.

**Deliverables:**
- Prisma model for `IdentifierScheme`
- Repository class (`identifier-scheme.repository.ts`) with CRUD operations
- API routes: `GET/POST /api/v1/schemes`, `GET/PATCH/DELETE /api/v1/schemes/[id]`
- Seed data for common schemes (ABN, GTIN, GLN, PGLN)

### 2. Identifier Repository

A data layer for **identifier instances** — the actual identifier values attached to entities (organisations, facilities, products).

Each identifier instance has:
- A reference to an `IdentifierScheme`
- The identifier value (e.g. "51 824 753 556")
- A link to the owning entity (polymorphic — could be org, facility, or product)
- Whether it is the primary identifier for that entity

**Deliverables:**
- Prisma model for `Identifier` (with polymorphic entity reference)
- Repository class (`identifier.repository.ts`)
- Validation logic: identifier value against scheme regex
- Association helpers for linking identifiers to entities

### 3. IDR Service Repository

The Identity Resolver service is already partially integrated (Pyx adapter exists in `@uncefact/untp-ri-services`). This work formalises:

- **Service registration** — storing IDR service configurations per tenant (connection details, API keys, endpoint URLs)
- **Link management** — CRUD for links registered against identifiers in the IDR
- **Link types** — support for different MIME types and link relation types per the UNTP spec

The existing `ServiceInstance` model may be extended, or a dedicated `IdrServiceConfig` model created.

**Deliverables:**
- Extend or create Prisma model for IDR service configuration
- Repository class for IDR service configs
- API routes for managing IDR links: `POST /api/v1/identifiers/[id]/links`, `GET /api/v1/identifiers/[id]/links`
- Integration with the existing IDR adapter from `@uncefact/untp-ri-services`

## Architecture Reference Documents

Read these for full context:

| Document | Path | Relevant Sections |
|----------|------|-------------------|
| Overview | `/Users/admin/rbtp-alpha-phase/reference-implementation/00-overview.md` | Service architecture overview |
| Master Data Management | `/Users/admin/rbtp-alpha-phase/reference-implementation/03-master-data-management.md` | Identifier schemes, identifier model |
| Identity & Resolution | `/Users/admin/rbtp-alpha-phase/reference-implementation/04-identity-and-resolution.md` | IDR service, link types, resolution |
| Service Architecture | `/Users/admin/rbtp-alpha-phase/reference-implementation/06-service-architecture.md` | Adapter pattern, service registration |
| Open Questions | `/Users/admin/rbtp-alpha-phase/reference-implementation/07-open-questions.md` | #22 (batch identifier patterns) |

## Existing Codebase Reference

| What | Path |
|------|------|
| Current Prisma schema | `packages/reference-implementation/prisma/schema.prisma` |
| Existing service instance repo | `packages/reference-implementation/src/lib/prisma/repositories/service-instance.repository.ts` |
| DID service resolution (pattern to follow) | `packages/reference-implementation/src/lib/services/resolve-did-service.ts` |
| API middleware (auth pattern) | `packages/reference-implementation/src/lib/api/with-org-auth.ts` |
| Existing DID API routes (pattern to follow) | `packages/reference-implementation/src/app/api/v1/dids/` |
| Encryption service (for config encryption) | `packages/reference-implementation/src/lib/encryption/encryption.ts` |

## Patterns to Follow

- **Repository pattern**: See `did.repository.ts` for the established pattern — class with static methods, Prisma client, organisation-scoped queries.
- **API routes**: Next.js App Router handlers, wrapped with `withOrgAuth()` middleware for tenant isolation.
- **Service adapters**: Factory pattern via `resolve-did-service.ts` — resolve config, decrypt, instantiate adapter.
- **Validation**: Use `validation.ts` helpers for input validation in API routes.

## Dependencies

- **Depends on**: Nothing — this is foundational.
- **Depended on by**: Master Data (Group 2) will reference schemes. Credential Lifecycle (Group 6) uses IDR for publishing.

## Out of Scope

- Organisation/facility/product entity management (that's Group 2 — Master Data)
- DID management (that's Group 3 — Identity & Signing)
- Credential issuance or storage (that's Group 6 — Credential Lifecycle)
