# Service Registry Pattern

## 1. Context

The UNTP reference implementation needs a consistent pattern for managing external service integrations (DID management, verifiable credentials, storage, etc.). Each service type can have multiple adapter implementations, and each tenant (organisation) can register multiple configured instances of any adapter.

This is a foundational architecture pattern that will be reused across the entire codebase for all service integrations.

### Current State

Service configuration is handled via global environment variables (`VCKIT_API_URL`, `VCKIT_AUTH_TOKEN`) with a single hardcoded factory (`createDidService()` in `src/lib/api/helpers.ts`). This reads env vars on every request and constructs a `VCKitDidService` instance directly.

Three adapter classes already exist:
- `VCKitDidService` -- DID management via VCKit
- `VCKitAdapter` -- verifiable credential issuance/verification via VCKit
- `UNCEFACTStorageAdapter` -- credential storage via UNCEFACT Identity Resolver

Each has a different constructor signature and config requirements.

## 2. Problem

The current approach does not support:
- Multiple implementations of the same service type
- Per-tenant service instance configuration
- Runtime swapping of implementations
- Multiple instances of the same adapter with different configs (e.g., three VCKit instances)
- Provenance tracking (which service instance created a DID or issued a credential)

## 3. Architecture Overview

### 3.1 Three-Layer Model

1. **Service Type** -- a category of capability with a defined interface (e.g., DID, credential, storage). Represented as a Prisma enum.
2. **Adapter** -- a concrete implementation of a service type interface (e.g., VCKit adapter for DID service). Represented as a Prisma enum. One adapter provider (like VCKit) can implement multiple service types.
3. **Instance** -- a tenant-registered, configured deployment of an adapter (e.g., "Production VCKit" with specific endpoint + API key). Stored as a row in the `ServiceInstance` database table.

### 3.2 System Defaults

- System-level default service instances are bundled with the application.
- Owned by the "system" organisation (`organizationId === "system"`).
- Pre-seeded during database initialisation (same pattern as the existing system default DID).
- Visible to all tenants as read-only entries.
- Tenants cannot edit or delete system default instances.
- Tenants can register their own instances alongside system defaults.

### 3.3 Naming Conventions

Consistent naming across all service types:

| Dimension | Convention | Examples |
|---|---|---|
| Service type enum | Short domain noun, UPPER_SNAKE | `DID`, `CREDENTIAL`, `STORAGE` |
| Service interface | `I{Domain}Service` | `IDidService`, `ICredentialService`, `IStorageService` |
| Adapter class | `{Provider}{Domain}Service` | `VCKitDidService`, `VCKitCredentialService`, `UncefactStorageService` |
| Adapter type enum | Provider name, UPPER_SNAKE | `VCKIT`, `UNCEFACT` |

Both interfaces and adapter classes use the `Service` suffix. Interfaces are prefixed with `I` to distinguish them from concrete classes (e.g., `IDidService` vs `VCKitDidService`).

**Renames required (Phase 2, future):**
- `VCKitAdapter` -> `VCKitCredentialService`
- `IVerifiableCredentialService` -> `ICredentialService`

## 4. Database Schema

### 4.1 New Enums

```prisma
enum ServiceType {
  DID
}

enum AdapterType {
  VCKIT
}
```

> Additional values (`CREDENTIAL`, `STORAGE`, `UNCEFACT`, etc.) will be added via migrations as those service types are implemented in future phases.

### 4.2 ServiceInstance Model

```prisma
model ServiceInstance {
  id             String      @id @default(cuid())
  organizationId String
  serviceType    ServiceType
  adapterType    AdapterType
  name           String
  description    String?
  config         String      // AES-256-GCM encrypted JSON blob
  isPrimary      Boolean     @default(false)
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  dids           Did[]

  @@index([organizationId, serviceType])
}
```

**Design decisions:**
- **`config` is a `String` column**, not `Json`. The entire config object is encrypted as a single AES-256-GCM ciphertext blob. PostgreSQL cannot inspect encrypted data, so `Json` type offers no benefit.
- **No `isDefault` column.** System default instances are identified by `organizationId === "system"`. This is consistent with how the existing `Did` model handles system defaults.
- **`isPrimary` uniqueness** is enforced at the application layer, not via database constraint. When setting `isPrimary` on an instance, the repository code first unsets any existing primary for that org + service type combination. PostgreSQL/Prisma does not natively support conditional unique indexes.
- **No soft delete.** Deleted instances are removed from the database. Referencing records (`Did`, `Credential`) have their FK nulled out via `onDelete: SetNull`.

### 4.3 FK Additions to Existing Models

**Did model** -- add optional `serviceInstanceId` for provenance tracking:

```prisma
model Did {
  // ... existing fields ...
  serviceInstanceId String?
  serviceInstance   ServiceInstance? @relation(fields: [serviceInstanceId], references: [id], onDelete: SetNull)
}
```

> The `Credential` model will gain similar FKs in Phase 2 (for VC service instance and storage service instance).

### 4.4 Organisation Model Update

Add the `ServiceInstance` relation:

```prisma
model Organization {
  // ... existing fields ...
  serviceInstances ServiceInstance[]
}
```

## 5. Package Structure

### 5.1 `packages/services` (pure TypeScript, no framework dependencies)

Contains adapter classes, service interfaces, config schemas, the static registry map, and the encryption service.

```
packages/services/src/
  did-manager/
    types.ts                              # existing DID types
    adapters/
      vckit-did.service.ts                # existing adapter class (unchanged)
      vckit-did.service.test.ts           # existing adapter tests (unchanged)
      vckit-did.schema.ts                 # Zod config schema with UI metadata
  encryption/
    encryption.interface.ts               # IEncryptionService interface
    adapters/
      aes-gcm.adapter.ts                  # AesGcmEncryptionAdapter
      aes-gcm.adapter.test.ts
  registry/
    types.ts                              # AdapterRegistryEntry, registry types
    registry.ts                           # static registry map
    registry.test.ts
```

### 5.2 `packages/mock-app` (Next.js application)

Contains Prisma schema, repositories, resolution service, API routes, and seed script.

```
packages/mock-app/src/
  lib/
    encryption/
      encryption.ts                       # instantiates AesGcmEncryptionAdapter from env var
    prisma/
      repositories/
        service-instance.repository.ts    # CRUD for ServiceInstance
        service-instance.repository.test.ts
    services/
      resolve-did-service.ts              # resolveDidService(orgId, instanceId?)
      resolve-did-service.test.ts
    api/
      helpers.ts                          # updated: createDidService() deprecated, uses resolver
      errors.ts                           # custom error classes
```

## 6. Config Schemas

### 6.1 Schema Approach

Each adapter exports a **Zod schema** as the source of truth for its config shape. JSON Schema is derived from Zod via `zod-to-json-schema` for portability and frontend form generation.

Schemas include **UI metadata** via Zod's `.describe()` and custom extensions:
- Field labels and descriptions (for form rendering)
- Sensitive field markers (dual purpose: UI renders as password input, backend encrypts the entire blob)
- Field ordering hints

### 6.2 Example: VCKit DID Config Schema

```typescript
import { z } from 'zod';

export const vckitDidConfigSchema = z.object({
  endpoint: z.string()
    .url()
    .describe('API Endpoint||The base URL of your VCKit instance, e.g. https://vckit.example.com'),
  authToken: z.string()
    .min(1)
    .describe('Auth Token||The Bearer token for authenticating with VCKit')
    .meta({ sensitive: true }),
});

export type VCKitDidConfig = z.infer<typeof vckitDidConfigSchema>;
```

> The `sensitive: true` metadata marker serves two purposes:
> 1. The frontend renders the field as a password input.
> 2. The API response masks the field value (e.g., `"****"`) when returning config.

### 6.3 JSON Schema Derivation

JSON Schema is derived at runtime when the schema discovery endpoint is called:

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema';

const jsonSchema = zodToJsonSchema(vckitDidConfigSchema);
```

## 7. Static Registry Map

### 7.1 Structure

The registry is a compile-time TypeScript map, nested `serviceType -> adapterType -> { configSchema, factory }`:

```typescript
import { ServiceType, AdapterType } from './types';
import { vckitDidConfigSchema, VCKitDidConfig } from '../did-manager/adapters/vckit-did.schema';
import { VCKitDidService } from '../did-manager/adapters/vckit-did.service';

export type AdapterRegistryEntry<TConfig, TService> = {
  configSchema: z.ZodType<TConfig>;
  factory: (config: TConfig) => TService;
};

export const adapterRegistry = {
  [ServiceType.DID]: {
    [AdapterType.VCKIT]: {
      configSchema: vckitDidConfigSchema,
      factory: (config: VCKitDidConfig) => new VCKitDidService(
        config.endpoint,
        { Authorization: `Bearer ${config.authToken}` },
      ),
    },
  },
} as const;
```

### 7.2 Adding New Adapters

To add a new adapter to the registry:
1. Create the adapter class implementing the relevant service interface.
2. Create a Zod config schema with UI metadata.
3. Add the enum values to `ServiceType` and/or `AdapterType` (Prisma migration).
4. Add the entry to the `adapterRegistry` map.
5. Add a per-service-type resolver function (if new service type).

## 8. Encryption Service

### 8.1 Design

The encryption service follows the same interface/adapter pattern as all other services, but it is **not part of the database-backed registry**. It is application infrastructure, instantiated directly from environment variables.

**Rationale:** The encryption service is needed to decrypt service instance configs. If it were itself stored in the database, it would create a circular dependency (need encryption to read encryption config). It is a system-level concern, not tenant-configurable.

### 8.2 Interface

```typescript
export interface IEncryptionService {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}
```

### 8.3 AES-256-GCM Adapter

```typescript
export class AesGcmEncryptionAdapter implements IEncryptionService {
  constructor(private readonly key: string) {
    if (!key) {
      throw new Error('Encryption key is required');
    }
  }

  encrypt(plaintext: string): string { /* AES-256-GCM encryption */ }
  decrypt(ciphertext: string): string { /* AES-256-GCM decryption */ }
}
```

The ciphertext format includes the IV and auth tag alongside the encrypted data (e.g., `iv:authTag:ciphertext` as a single string), so each encryption operation produces a unique output even for identical plaintext.

### 8.4 Instantiation

In `packages/mock-app`, the encryption adapter is instantiated once and imported where needed:

```typescript
// src/lib/encryption/encryption.ts
import { AesGcmEncryptionAdapter } from '@mock-app/services';

const key = process.env.SERVICE_ENCRYPTION_KEY;
if (!key) {
  throw new Error('Missing required SERVICE_ENCRYPTION_KEY environment variable');
}

export const encryptionService = new AesGcmEncryptionAdapter(key);
```

### 8.5 Future-Proofing

The `IEncryptionService` interface allows swapping to a different implementation (e.g., AWS KMS adapter) without refactoring consumers. Only the instantiation module changes.

## 9. Instance Resolution

### 9.1 Resolution Chain

When a service is needed for an organisation, the resolution chain is:

1. **Explicit instance ID** -- if the caller passes a `serviceInstanceId`, look it up. Verify the instance belongs to the requesting org or is a system default (`organizationId === "system"`). If not found or not accessible, throw `ServiceInstanceNotFoundError`.
2. **Tenant primary** -- if no explicit ID, find the instance where `organizationId === orgId AND serviceType === type AND isPrimary === true`. If found, use it.
3. **System default** -- if no tenant primary, find the instance where `organizationId === "system" AND serviceType === type`. If found, use it.
4. **No instance available** -- if none of the above resolves, throw `ServiceResolutionError`.

### 9.2 Resolver Function Signatures

Per-service-type resolver functions, fully type-safe:

```typescript
// Phase 1
export async function resolveDidService(
  organizationId: string,
  serviceInstanceId?: string,
): Promise<IDidService>;

// Phase 2 (future)
export async function resolveCredentialService(
  organizationId: string,
  serviceInstanceId?: string,
): Promise<ICredentialService>;

export async function resolveStorageService(
  organizationId: string,
  serviceInstanceId?: string,
): Promise<IStorageService>;
```

### 9.3 Resolution Implementation

Each resolver function:
1. Queries the `ServiceInstance` table following the resolution chain.
2. Decrypts the config blob using the `IEncryptionService`.
3. Validates the decrypted config against the adapter's Zod schema (guards against schema drift).
4. Calls the registry factory function with the validated config.
5. Returns the hydrated adapter instance.

### 9.4 No Caching

Adapter instances are **not cached**. A new instance is constructed per request. The adapters are stateless HTTP wrappers (holding a URL and headers for subsequent `fetch` calls), so construction cost is negligible. This avoids unbounded memory allocation and cache invalidation complexity.

### 9.5 Usage in Route Handlers

```typescript
// Before (current):
const didService = createDidService();

// After (Phase 1):
const didService = await resolveDidService(organizationId, requestedInstanceId);
```

## 10. Error Handling

### 10.1 Custom Error Classes

Typed error classes for `instanceof` discrimination in route handlers:

| Error Class | Meaning | HTTP Status |
|---|---|---|
| `ServiceInstanceNotFoundError` | Explicit instance ID not found or not accessible to the org | 404 |
| `ServiceResolutionError` | No instance available (no primary, no system default) | 500 |
| `ConfigDecryptionError` | Encryption key mismatch or corrupt ciphertext | 500 |
| `ConfigValidationError` | Decrypted config fails Zod schema validation | 500 |

All error classes extend a common `ServiceRegistryError` base class.

### 10.2 Route Handler Pattern

```typescript
try {
  const didService = await resolveDidService(organizationId, instanceId);
  const result = await didService.create(options);
  return NextResponse.json({ ok: true, did: result }, { status: 201 });
} catch (e) {
  if (e instanceof ServiceInstanceNotFoundError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
  }
  if (e instanceof ServiceRegistryError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
  // ... existing catch-all
}
```

## 11. Seed Script Changes

### 11.1 Updated Seed Flow

The seed script (`prisma/seed.ts`) will be extended to:

1. Upsert the system organisation (existing).
2. Upsert the system default DID (existing).
3. **New:** Upsert the system default VCKit DID service instance.

### 11.2 Service Instance Seeding

The seed script reads the existing environment variables (`VCKIT_API_URL`, `VCKIT_AUTH_TOKEN`) and persists the encrypted config into a `ServiceInstance` row:

```typescript
const config = JSON.stringify({
  endpoint: new URL(process.env.VCKIT_API_URL!).origin,
  authToken: process.env.VCKIT_AUTH_TOKEN!,
});

const encryptedConfig = encryptionService.encrypt(config);

await prisma.serviceInstance.upsert({
  where: { /* unique lookup - see below */ },
  update: { config: encryptedConfig },
  create: {
    organizationId: SYSTEM_ORG_ID,
    serviceType: 'DID',
    adapterType: 'VCKIT',
    name: 'System Default VCKit (DID)',
    description: 'System-wide default VCKit instance for DID management',
    config: encryptedConfig,
    isPrimary: false,  // system defaults are not "primary" -- they are fallbacks
  },
});
```

### 11.3 Env Var Usage After Seeding

After seeding, `VCKIT_API_URL` and `VCKIT_AUTH_TOKEN` are **not read at runtime**. The database is the single source of truth. The env vars are seed-time inputs only. `SERVICE_ENCRYPTION_KEY` is the only service-registry-related env var read at runtime.

### 11.4 Upsert Identity for System Defaults

The seed needs a stable way to identify the system default instance for upsert. Since there is no natural unique key beyond `organizationId + serviceType + adapterType` (and a system org might theoretically have multiple instances of the same adapter type), a pragmatic approach is to use a well-known `id` value (e.g., `system-did-vckit`) for system defaults, making the upsert deterministic.

## 12. Environment Variables

### 12.1 New Variables

| Variable | Required | Purpose |
|---|---|---|
| `SERVICE_ENCRYPTION_KEY` | Yes (runtime + seed) | AES-256-GCM symmetric key for encrypting/decrypting service instance config |

### 12.2 Existing Variables (Unchanged)

| Variable | Required | Purpose |
|---|---|---|
| `VCKIT_API_URL` | Yes (seed only) | VCKit API URL, read at seed time to populate system default service instance |
| `VCKIT_AUTH_TOKEN` | Yes (seed only) | VCKit auth token, read at seed time to populate system default service instance |
| `DEFAULT_ISSUER_DID` | Yes (seed only) | System default DID string |
| `RI_DATABASE_URL` | Yes (runtime) | PostgreSQL connection string |

### 12.3 Deprecated Patterns

The following will be removed after Phase 1:
- `src/lib/config/did.config.ts` (`getDidConfig()`) -- replaced by database-backed resolution.
- `createDidService()` in `src/lib/api/helpers.ts` -- replaced by `resolveDidService()`.

## 13. Phase 1 Scope (Implement Now)

Phase 1 proves the entire service registry pattern end-to-end with the DID service type. All items below are in scope for the initial PR.

### 13.1 `packages/services` Changes

- [ ] **Create** `IEncryptionService` interface and `AesGcmEncryptionAdapter` with tests.
- [ ] **Create** VCKit DID config Zod schema (`vckitDidConfigSchema`) with UI metadata and sensitive field markers.
- [ ] **Create** registry types (`AdapterRegistryEntry`, etc.) and the static registry map with the single `DID -> VCKIT` entry.
- [ ] **Export** all new types, schemas, and classes from the package barrel.

### 13.2 `packages/mock-app` Changes

- [ ] **Prisma migration:** Add `ServiceType` enum (value: `DID`), `AdapterType` enum (value: `VCKIT`), `ServiceInstance` model, and `serviceInstanceId` FK on `Did` model.
- [ ] **Create** encryption module (`src/lib/encryption/encryption.ts`) that instantiates `AesGcmEncryptionAdapter` from `SERVICE_ENCRYPTION_KEY` env var.
- [ ] **Create** `ServiceInstance` repository with CRUD functions and `isPrimary` management logic.
- [ ] **Create** `resolveDidService()` resolver function implementing the resolution chain.
- [ ] **Create** custom error classes (`ServiceRegistryError`, `ServiceInstanceNotFoundError`, `ServiceResolutionError`, `ConfigDecryptionError`, `ConfigValidationError`).
- [ ] **Update** seed script to create system default VCKit DID service instance.
- [ ] **Retrofit** existing DID API routes to use `resolveDidService()` instead of `createDidService()`.
- [ ] **Deprecate/remove** `getDidConfig()` and `createDidService()`.
- [ ] **Tests** for all new code (repository, resolver, encryption module integration, updated route handlers).

### 13.3 What Phase 1 Does NOT Include

- CRUD API routes for tenant management of service instances (Phase 3).
- Schema/discovery API endpoint (Phase 3).
- Credential and storage service types in the registry (Phase 2).
- Adapter class renames for credential and storage (Phase 2).
- Provenance FKs on `Credential` model (Phase 2).

## 14. Phase 2 Scope (Future -- Document Only)

Phase 2 expands the registry to cover all existing service types.

- Add `CREDENTIAL` and `STORAGE` to the `ServiceType` enum (migration).
- Add `UNCEFACT` to the `AdapterType` enum (migration).
- Create config schemas for `VCKitCredentialService` and `UncefactStorageService`.
- Add registry entries for `CREDENTIAL -> VCKIT` and `STORAGE -> UNCEFACT`.
- Create `resolveCredentialService()` and `resolveStorageService()` resolver functions.
- Rename `VCKitAdapter` to `VCKitCredentialService` and `IVerifiableCredentialService` to `ICredentialService`.
- Add `vcServiceInstanceId` and `storageServiceInstanceId` FKs to the `Credential` model.
- Seed system default instances for credential and storage service types.
- Retrofit any existing credential/storage routes to use the new resolvers.

## 15. Phase 3 Scope (Future -- Document Only)

Phase 3 adds tenant-facing management of service instances.

### 15.1 CRUD API Routes

```
POST   /api/v1/service-instances          -- register a new instance
GET    /api/v1/service-instances          -- list instances for the org (filter by serviceType, adapterType)
GET    /api/v1/service-instances/:id      -- get a single instance (config with sensitive fields masked)
PUT    /api/v1/service-instances/:id      -- update instance (name, config, isPrimary)
DELETE /api/v1/service-instances/:id      -- remove an instance (nulls FKs on referencing records)
```

**Behavioural rules:**
- Config is validated against the adapter's Zod schema on create and update.
- Config is encrypted before storage, decrypted on read.
- Sensitive fields are masked in GET responses (e.g., `"****"`), driven by the schema's `sensitive: true` metadata.
- System default instances (`organizationId === "system"`) are visible in list responses but cannot be edited or deleted.
- Deleting an instance nulls out FKs on referencing `Did` and `Credential` records (`onDelete: SetNull`).
- If the deleted instance was primary, resolution falls back to the system default silently.
- `isPrimary` is never set automatically. Tenants explicitly designate a primary instance during creation (optional flag) or via update. A tenant can have instances registered with none marked primary; they will use the system default.

### 15.2 Schema Discovery API

```
GET /api/v1/service-registry/adapters?serviceType=DID
```

Returns available adapter types for a service type, including their JSON Schemas (derived from Zod via `zod-to-json-schema`) with UI metadata for dynamic form rendering:

```json
{
  "ok": true,
  "adapters": [
    {
      "adapterType": "VCKIT",
      "name": "VCKit",
      "configSchema": { /* JSON Schema with UI metadata */ }
    }
  ]
}
```

## 16. Acceptance Criteria (Phase 1)

1. The `ServiceInstance` Prisma model exists with the schema described in section 4.
2. The `Did` model has an optional `serviceInstanceId` FK.
3. The `AesGcmEncryptionAdapter` correctly encrypts and decrypts config blobs using AES-256-GCM.
4. The seed script creates a system default VCKit DID service instance with encrypted config.
5. `resolveDidService(orgId)` returns a hydrated `IDidService` adapter from the system default when no tenant-specific instance exists.
6. `resolveDidService(orgId, instanceId)` returns a hydrated adapter for the specified instance, with ownership verification.
7. All existing DID API routes use `resolveDidService()` instead of `createDidService()`.
8. The existing DID API integration tests pass with the new resolution flow.
9. New DID records are created with `serviceInstanceId` populated.
10. Custom error classes are thrown with specific messages for each failure mode.
11. All new code has unit tests.
12. `getDidConfig()` and `createDidService()` are removed.

## 17. Open Questions (Deferred)

These items were identified during specification but are intentionally deferred:

- **Per-tenant encryption keys / key rotation:** Not needed for the reference implementation. The single `SERVICE_ENCRYPTION_KEY` is sufficient.
- **Adapter health checks:** Could be added to detect misconfigured or unreachable service instances. Not in scope for any current phase.
- **Config migration on schema change:** If an adapter's config schema changes (e.g., a new required field), existing stored configs may fail validation. A migration strategy (versioned schemas, default values, migration scripts) may be needed. Deferred until it becomes a practical concern.
- **Audit logging:** Tracking who created/modified/deleted service instances. Not in scope.
