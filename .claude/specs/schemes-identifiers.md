# Schemes & Identifiers — Specification

## Overview

Build the foundational layer for identifier scheme management and the Identity Resolver (IDR) service integration. Three distinct data entities — **Registrars**, **Identifier Schemes**, and **Identifiers** — form the base that organisations, facilities, and products reference. The IDR service integration follows the established service instance pattern and includes adapter-specific verification/initialisation.

This iteration also includes cross-cutting improvements (renaming `tenantId` to `tenantId`, adding service API versioning) and DID manager backports (DID import, verification for all DID types).

**Branch:** `feat/ri-schemes-identifiers`
**Depends on:** Nothing — this is foundational.
**Depended on by:** Master Data (Group 2), Credential Lifecycle (Group 6).

---

## 1. Registrar Repository

### Purpose

A data layer for managing **registrars** — the organisations that operate identifier schemes. One registrar can operate multiple schemes (e.g. GS1 operates GTIN, GLN, SGTIN).

### Data Model — `Registrar`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String (cuid) | Auto | Primary key |
| `tenantId` | String | Yes | Owning org, or `"system"` for instance-level defaults |
| `name` | String | Yes | Human-readable name (e.g. "GS1", "Australian Business Register") |
| `namespace` | String | Yes | Namespace identifier used in IDR resolution (e.g. "gs1", "abr", "asic"). Required because some IDR services (notably Pyx) support multiple registrars within a single instance and use namespace as the top-level grouping to distinguish between them. Not all IDR services need this, but storing it on the registrar ensures it's available when needed. |
| `url` | String | No | Registrar's website URL |
| `idrServiceInstanceId` | String? (FK → ServiceInstance) | No | The registrar's own IDR service instance (e.g. GS1's resolver). Must reference a system-level or same-org service instance (validated at application layer). |
| `isDefault` | Boolean | No | Whether this is a system/default registrar (display hint; scoping is via tenantId) |
| `createdAt` | DateTime | Auto | Creation timestamp |
| `updatedAt` | DateTime | Auto | Update timestamp |

**Deletion behaviour:** `onDelete: Cascade` — deleting a registrar cascade-deletes its schemes and their qualifiers. However, if any scheme has identifiers referencing it, the cascade is blocked by the `Restrict` on Scheme→Identifier. Error message: "Cannot delete registrar: identifiers still reference scheme '{name}'."

### Scoping

- Registrars are **instance-level by default** (`tenantId = "system"`), shared across all tenants.
- Tenants can register additional registrars (`tenantId = <tenant-org-id>`).
- Queries return system records + tenant-specific records using `OR: [{ tenantId }, { tenantId: "system" }]` (same pattern as `ServiceInstance`).

### Repository — `registrar.repository.ts`

- `createRegistrar(input)` — creates a registrar. Validates that `idrServiceInstanceId` (if provided) references a service instance accessible to the same org or system.
- `getRegistrarById(id, tenantId)` — returns registrar if owned by org or system
- `listRegistrars(tenantId, options)` — lists org registrars + system registrars, with filtering/pagination
- `updateRegistrar(id, tenantId, input)` — updates a registrar; cannot modify system defaults. Validates FK accessibility on update.
- `deleteRegistrar(id, tenantId)` — deletes a tenant registrar; cannot delete system defaults. Fails with error if schemes still reference it.

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/registrars` | Create a new registrar |
| `GET` | `/api/v1/registrars` | List registrars (with filtering) |
| `GET` | `/api/v1/registrars/[id]` | Get registrar by ID |
| `PATCH` | `/api/v1/registrars/[id]` | Update a registrar |
| `DELETE` | `/api/v1/registrars/[id]` | Delete a registrar |

All routes wrapped with `withOrgAuth()`.

### Seed Data

| Name | Namespace | URL |
|------|-----------|-----|
| GS1 | `gs1` | https://www.gs1.org |
| Australian Business Register | `abr` | https://abr.business.gov.au |
| ASIC | `asic` | https://asic.gov.au |
**Note:** The system seeds common registrars and their schemes, but is designed to support **any** identifier scheme — not just the seeded defaults. Registrars and schemes are the extension point: when the system doesn't ship with a given registrar/identifier scheme combination, tenants (or system administrators) create a new registrar, then register schemes under it. A registrar must exist before a scheme can be created under it.

### Seed IDR Service Instance

A system-level Pyx IDR service instance is seeded alongside the registrars and schemes, making the system functional out-of-the-box. The seed creates:
- A `ServiceInstance` with `tenantId = "system"`, `serviceType = IDR`, `adapterType = PYX_IDR`, `isPrimary = true`
- Encrypted config with the Pyx IDR connection details

**Onboarding:** Registrars and schemes are NOT cloned to new tenants — they're queried with the `OR: [{ tenantId }, { tenantId: "system" }]` pattern. The system IDR service instance IS cloned via `cloneSystemDefaults()` (same pattern as the VCKit DID service instance), so each tenant gets their own IDR service instance that they can reconfigure if needed.

---

## 2. Identifier Scheme Repository

### Purpose

A data layer for managing **identifier schemes** — the catalogue of identifier types the system understands. Each scheme belongs to a registrar and defines validation rules for identifiers of that type.

### Data Model — `IdentifierScheme`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String (cuid) | Auto | Primary key |
| `tenantId` | String | Yes | Owning org, or `"system"` for instance-level defaults |
| `registrarId` | String (FK → Registrar) | Yes | Reference to the `Registrar` that operates this scheme |
| `name` | String | Yes | Human-readable name (e.g. "Australian Business Number") |
| `primaryKey` | String | Yes | The primary identifier key per ISO 18975 (e.g. `abn`, `01`) |
| `validationPattern` | String | Yes | Regex for validating identifier values (e.g. `^\d{11}$`) |
| `namespace` | String | No | Optional namespace override (if different from the registrar's namespace) |
| `idrServiceInstanceId` | String? (FK → ServiceInstance) | No | Associated IDR service instance (overrides registrar IDR). Must reference a system-level or same-org service instance (validated at application layer). |
| `isDefault` | Boolean | No | Whether this is a system/default scheme (display hint; scoping is via tenantId) |
| `createdAt` | DateTime | Auto | Creation timestamp |
| `updatedAt` | DateTime | Auto | Update timestamp |

**Unique constraint:** `@@unique([registrarId, primaryKey, tenantId])` — prevents duplicate primaryKeys under the same registrar within the same scope.

**Relationships:**
- Many schemes -> one registrar (`onDelete: Cascade`)
- One scheme -> many qualifiers (`SchemeQualifier`)
- One scheme -> many identifiers

### Data Model — `SchemeQualifier`

Qualifier definitions are stored in their own table to support relational integrity. This enables future use cases such as range-based credential issuance (e.g. issuing DPPs for serial numbers 1-10 within a batch) and querying issued credentials by qualifier (e.g. all DPPs for a given batch). Storing qualifier definitions relationally provides a clean FK target for when qualifier values are stored on `LinkRegistration` or batch issuance models in Group 6.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String (cuid) | Auto | Primary key |
| `schemeId` | String (FK → IdentifierScheme) | Yes | Reference to the parent scheme |
| `key` | String | Yes | Qualifier key / application identifier code (e.g. `10` for batch, `21` for serial) |
| `description` | String | Yes | Human-readable description (e.g. "Batch/Lot Number") |
| `validationPattern` | String | No | Regex for validating qualifier values |
| `createdAt` | DateTime | Auto | Creation timestamp |
| `updatedAt` | DateTime | Auto | Update timestamp |

**Unique constraint:** `@@unique([schemeId, key])` — a scheme cannot have duplicate qualifier keys.

**Deletion behaviour:** `onDelete: Cascade` from `IdentifierScheme` — deleting a scheme removes its qualifier definitions. (Qualifier definitions are metadata owned by the scheme, not independently referenced yet. When Group 6 introduces qualifier value references, this cascade may need revisiting.)

**Namespace resolution:** Use the scheme's `namespace` if set, otherwise fall back to the registrar's `namespace`.

**Tenant override pattern:** Both `namespace` and `idrServiceInstanceId` on the scheme exist to support tenant-level overrides of system defaults. When the system ships with a default registrar and schemes (e.g. GS1 with GTIN), a tenant may need to use a different IDR service or namespace for that same scheme. Rather than modifying the system default, the tenant creates a tenant-scoped copy of the scheme with their own `namespace` and/or `idrServiceInstanceId` set. This keeps system defaults immutable while allowing per-tenant customisation.

**Deletion behaviour:** Scheme→Identifier uses `onDelete: Restrict` — cannot delete a scheme that has identifiers referencing it. Error message: "Cannot delete scheme: N identifiers still reference it." Scheme→SchemeQualifier uses `onDelete: Cascade` — qualifier definitions delete with their parent scheme. Registrar→Scheme uses `onDelete: Cascade` — schemes delete with their parent registrar (blocked if identifiers exist).

### Design Decisions

**Profiles (deferred):** Some identifier schemes have variants/profiles (e.g. NLIS PICs with state-dependent prefixes). For now, this is handled with a single general `validationPattern` per scheme. Scheme profiles can be added in a later iteration.

**GTIN/SGTIN (resolved):** GTIN and SGTIN are a single scheme with optional qualifiers, not two separate records. In GS1 Digital Link and ISO 18975, `01` is a single application identifier. When qualifiers (batch `10`, serial `21`) are used, the identifier is effectively an SGTIN. This avoids ambiguity from two schemes sharing the same primaryKey.

**Qualifier values (resolved):** Qualifier values (e.g. batch number "LOT-2024-A") are NOT stored on identifiers. They are provided at link publishing time via the `qualifierPath` parameter. A single GTIN identifier can publish links for multiple batches/serials.

### Scoping

Same as registrars — instance-level by default (`tenantId = "system"`), tenants can add their own.

### Repository — `identifier-scheme.repository.ts`

- `createIdentifierScheme(input)` — creates a scheme with optional qualifiers (nested create); tenant-scoped or system-level. Validates FK accessibility for `idrServiceInstanceId` and `registrarId`.
- `getIdentifierSchemeById(id, tenantId)` — returns scheme if owned by org or system; includes registrar and qualifiers relations
- `listIdentifierSchemes(tenantId, options)` — lists org schemes + system schemes, with filtering by registrarId/pagination; includes qualifiers
- `updateIdentifierScheme(id, tenantId, input)` — updates a scheme; cannot modify system defaults. Validates FK accessibility on update. Qualifier updates use delete-and-recreate (replace entire set).
- `deleteIdentifierScheme(id, tenantId)` — deletes a tenant scheme; cannot delete system defaults. Fails with error if identifiers still reference it. Qualifier definitions cascade-delete.

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/schemes` | Create a new identifier scheme |
| `GET` | `/api/v1/schemes` | List schemes (with filtering) |
| `GET` | `/api/v1/schemes/[id]` | Get scheme by ID |
| `PATCH` | `/api/v1/schemes/[id]` | Update a scheme |
| `DELETE` | `/api/v1/schemes/[id]` | Delete a scheme |

All routes wrapped with `withOrgAuth()`.

### Seed Data

| Scheme | Primary Key | Validation | Registrar |
|--------|-------------|------------|-----------|
| Australian Business Number | `abn` | `^\d{11}$` | Australian Business Register |
| Australian Company Number | `acn` | `^\d{9}$` | ASIC |
| GS1 Global Location Number | `gln` | `^\d{13}$` | GS1 |
| GS1 Global Trade Item Number | `01` | `^\d{14}$` | GS1 |

**Seed qualifiers** (for GS1 Global Trade Item Number):

| Key | Description | Validation Pattern |
|-----|-------------|--------------------|
| `10` | Batch/Lot Number | `^[A-Za-z0-9]{1,20}$` |
| `21` | Serial Number | `^[A-Za-z0-9]{1,20}$` |

---

## 3. Identifier Repository

### Purpose

A data layer for **identifier instances** — the actual identifier values attached to entities (organisations, facilities, products). Identifiers exist as independent records and are linked to entities via FK on the entity side.

### Entity-Identifier Relationship

Identifiers are created first, independently of entities. When creating an entity (organisation, facility, product — in Group 2), the entity references its identifier(s) via FK. The flow is:

1. Register identifier schemes (this group)
2. Create identifier instances with values (this group)
3. Create entities and link them to existing identifiers (Group 2 — Master Data)

### Data Model — `Identifier`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String (cuid) | Auto | Primary key |
| `tenantId` | String | Yes | Owning tenant |
| `schemeId` | String (FK → IdentifierScheme) | Yes | Reference to `IdentifierScheme` |
| `value` | String | Yes | The identifier value (e.g. "51824753556") |
| `createdAt` | DateTime | Auto | Creation timestamp |
| `updatedAt` | DateTime | Auto | Update timestamp |

**Unique constraint:** `@@unique([schemeId, value])` — globally unique per scheme. Only one tenant can register a given identifier value for a given scheme across the entire system. This prevents multi-tenant IDR collision where two tenants publishing to the same IDR under the same identifier could overwrite or inject malicious links against each other's registrations. An identifier belongs to one entity; other parties referencing that identifier (e.g. as a supplier or customer) is a Group 2 entity-relationship concern, not a reason to duplicate the identifier record.

**Future consideration — third-party link publishing (circularity):** UNTP defines use cases where parties other than the identifier owner may be permitted to publish links against that identifier on the owner's IDR. For example, in circularity scenarios, recyclers, repairers, and maintenance providers may need to post recycling events, repair reports, or maintenance records against a product's identifier (e.g. a GTIN) on the product owner's Identity Resolver Service. This permission is a mechanism defined within the IDR service itself (access control at the resolver level), not at the application layer. The current unique constraint and per-org scoping is sufficient for the use cases we intend to demonstrate now, but future iterations should review how to model third-party link publishing within the reference implementation to demonstrate this capability.

**Note:** Entity linkage (`entityType`, `entityId`, `isPrimary`) is NOT on this model. Instead, entity models (Organisation, Facility, Product) in Group 2 will hold FK references to `Identifier`. This keeps identifiers independent and reusable.

**Deletion behaviour:** The Identifier -> IdentifierScheme FK uses `onDelete: Restrict` (cannot delete a scheme while identifiers reference it). Future entity -> Identifier FKs (Group 2) will use `onDelete: SetNull` to match the existing pattern for optional references.

### Validation

- When creating/updating an identifier, validate the `value` against the scheme's `validationPattern`.

### Repository — `identifier.repository.ts`

- `createIdentifier(input)` — creates an identifier; validates value against scheme pattern
- `getIdentifierById(id, tenantId)` — returns identifier if owned by org; includes scheme relation
- `listIdentifiers(tenantId, options)` — lists identifiers with filtering by schemeId, value
- `updateIdentifier(id, tenantId, input)` — updates value (re-validates against scheme pattern)
- `deleteIdentifier(id, tenantId)` — deletes an identifier

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/identifiers` | Create an identifier |
| `GET` | `/api/v1/identifiers` | List identifiers (with filtering) |
| `GET` | `/api/v1/identifiers/[id]` | Get identifier by ID |
| `PATCH` | `/api/v1/identifiers/[id]` | Update an identifier |
| `DELETE` | `/api/v1/identifiers/[id]` | Delete an identifier |

All routes wrapped with `withOrgAuth()`.

---

## 4. IDR Service Integration

### Purpose

Formalise IDR service configuration within the existing service registry pattern. Includes adapter-specific verification/initialisation and link management.

### Pyx IDR API Reference

The Pyx Identity Resolver API is documented at: https://idr.labs.pyx.io/api-docs

Key endpoints used by the adapter:

| Pyx Endpoint | Method | Purpose |
|--------------|--------|---------|
| `/resolver` | `POST` | Register links for an identifier (CreateLinkRegistrationDto) |
| `/resolver/links` | `GET` | List active links for an identifier (query by namespace, keyType, key, etc.) |
| `/resolver/links/{linkId}` | `GET/PUT/DELETE` | Manage individual links |
| `/identifiers` | `POST` | Create/update identifier scheme registration (IdentifierDto) |
| `/identifiers` | `GET` | Get registered identifier schemes (by namespace) |
| `/voc` | `GET` | Retrieve vocabulary data (link types via `?show=linktypes`) |
| `/voc/{linktype}` | `GET` | Get specific link type definition |
| `/.well-known/resolver` | `GET` | Resolver description file (discovery mechanism) |
| `/health-check` | `GET` | Health check |

**Key Pyx DTOs:**

`IdentifierDto` (for scheme registration with the Pyx IDR):
- `namespace` — scheme namespace (e.g. "gs1")
- `applicationIdentifiers[]` — array of identifier definitions, each with:
  - `title`, `label`, `shortcode` — display names
  - `ai` — application identifier code (maps to our `primaryKey`)
  - `type` — category: `I` (identifier), `Q` (qualifier), `D` (data)
  - `regex` — validation pattern
  - `qualifiers[]` — related qualifier AI codes

`CreateLinkRegistrationDto` (for publishing links):
- `namespace`, `identificationKeyType`, `identificationKey`
- `itemDescription`, `qualifierPath`, `active`
- `responses[]` — link response objects with linkType, targetUrl, mimeType, title, etc.

### 4a. Service Instance Changes

**Service API versioning** is covered in section 5b (Cross-Cutting Changes). The `apiVersion` field is required on all service instances.

#### New Enum Values

**Prisma enums:**
- Add `IDR` to the `ServiceType` enum
- Add `PYX_IDR` to the `AdapterType` enum

**Services package (`@uncefact/untp-ri-services`):**
- Add `IDR` to `ServiceType` constant object
- Add `PYX_IDR` to `AdapterType` constant object
- Register `PyxIdentityResolverAdapter` in the adapter registry with its config schema

#### Pyx IDR Config Schema (Zod)

```typescript
const pyxIdrConfigSchema = z.object({
  baseUrl: z.string().url(), // Base URL only, no path segments (e.g. "https://idr.labs.pyx.io"). Paths are constructed from the apiVersion on the ServiceInstance.
  apiKey: z.string(), // API key value only — the adapter constructs the "Bearer {apiKey}" authorization header.
  defaultContext: z.string().optional().default("au"),
  defaultFlags: z.object({
    defaultLinkType: z.boolean().optional().default(false),
    defaultMimeType: z.boolean().optional().default(false),
    defaultIanaLanguage: z.boolean().optional().default(false),
    defaultContext: z.boolean().optional().default(false),
    fwqs: z.boolean().optional().default(false),
  }).optional(),
});
```

**Notes:**
- Namespace is NOT in the adapter config — it comes from the Registrar/Scheme model (see namespace resolution in section 2).
- `defaultFlags` can be overridden at link publishing time. The `publishLinks()` call accepts optional flag overrides that take precedence over the config defaults for that specific registration.

#### IIdentityResolverService Interface Update

Extend the core `IIdentityResolverService` interface with full CRUD for links:

```typescript
interface IIdentityResolverService {
  /** Register/publish links for an identifier */
  publishLinks(
    identifierScheme: string,
    identifier: string,
    links: Link[],
    qualifierPath?: string,
    options?: PublishLinksOptions,
  ): Promise<LinkRegistration>;

  /** Get a single link by its IDR-assigned ID */
  getLinkById(
    linkId: string,
  ): Promise<Link>;

  /** Update an existing link (e.g. supersede a quarterly DFR link with a new URL) */
  updateLink(
    linkId: string,
    link: Partial<Link>,
  ): Promise<Link>;

  /** Delete/unpublish a link from the IDR */
  deleteLink(
    linkId: string,
  ): Promise<void>;

  /** Fetch the resolver description file (/.well-known/resolver) — standards-based, all IDR services support this */
  getResolverDescription(): Promise<ResolverDescription>;

  /** Get supported link types from the IDR — standards-based, all IDR services support this */
  getLinkTypes(): Promise<LinkType[]>;
}

// ResolverDescription — derived from the /.well-known/resolver schema (ISO 18975)
// LinkType — derived from the vocabulary/link type definitions (e.g. Pyx /voc response)
// These types will be defined during implementation based on the standards and Pyx API response formats.

```

**Use cases:**
- **Create**: Publishing credential links (DPP, DCC, DTE) for an identifier
- **Read**: Getting a specific link by its IDR-assigned ID
- **Update**: Superseding links — e.g. updating a Digital Facility Record link when a new quarterly emissions report is issued
- **Delete**: Unpublishing links — e.g. revoking a credential and removing its link from the IDR
- **Discovery**: Fetching resolver description and supported link types for validation

**Adapter-specific methods:** `registerSchemes()` remains on `PyxIdentityResolverAdapter` only — whether an IDR service exposes scheme registration to tenants is service-specific. In Pyx's case it does; other IDR services may not.

**Note for the `IIdentityResolverService` interface documentation:** The core interface assumes that the identifier scheme is already registered/permitted within the IDR service. If an IDR service supports tenant-managed scheme registration, adapter authors should implement that as an adapter-specific method (as Pyx does with `registerSchemes()`). If the IDR service does not support scheme registration, the adapter should provide clear error messaging when operations fail due to an unrecognised scheme — e.g. "Scheme '{primaryKey}' is not registered on this IDR service. Contact the service provider to register it."

#### Common IDR Utilities

Following the pattern established for DID services (where common utilities were extracted for adapters to share), the identity resolver service should provide shared utilities that adapters can use without recreating common functionality. Examples:

- **Resolver description validation**: Checking that a resolver description file conforms to the expected schema
- **UNTP link type verification**: Verifying that required UNTP link types (`untp:dpp`, `untp:dcc`, `untp:dte`, `untp:idr`) are supported
- **Link type schema validation**: Validating link type definitions against the standard

These utilities live alongside the core `IIdentityResolverService` interface in the services package and are imported by adapters as needed.

#### Adapter Constructor Pattern (Cross-Cutting)

All service adapters (DID and IDR) should receive a logger, name, and version at construction time. This automates logging prefixes for observability:

```typescript
interface AdapterConstructorOptions {
  name: string;      // Adapter name (e.g. "PYX_IDR")
  version: string;   // API version from ServiceInstance (e.g. "1.0.0")
  logger: Logger;    // Logger instance
}
```

The adapter uses these to prefix all log messages (e.g. `[PYX_IDR v1.0.0] Publishing links for abn/51824753556`). This is a cross-cutting change that applies to existing adapters (VCKit DID) as well as new ones (Pyx IDR).

### 4b. IDR Service Resolution

Create `resolve-idr-service.ts` following the same pattern as `resolve-did-service.ts`.

Resolution chain for determining which IDR to use (most-specific-wins):
1. Scheme's `idrServiceInstanceId` (if set)
2. Registrar's `idrServiceInstanceId` (if set)
3. Tenant's primary IDR service instance (`isPrimary = true` for serviceType IDR)
4. System default IDR service instance (`tenantId = "system"`)

**Note:** In practice, system-default schemes and registrars will NOT have an explicit IDR set, so the chain typically falls through to steps 3-4.

**Adoption pathway:** The resolution chain supports a natural adoption pathway for tenants. The system ships with default registrars, schemes, and a system-level IDR service. When a tenant wants to use their own IDR (e.g. a third-party service provider's identity resolver), they:
1. Create an IDR service instance with the appropriate adapter and configuration details
2. Set it as their tenant's primary IDR service instance
3. All their link publishing now goes to their IDR instead of the system default — no modification of system defaults required

This works because system schemes and registrars don't have explicit `idrServiceInstanceId` set, so the resolution chain falls through to the tenant's primary (step 3).

**Fine-grained override:** The `idrServiceInstanceId` on scheme and registrar exists as an extension point for when tenant isolation at the scheme level is needed. Since system defaults are immutable (tenants cannot modify them), a tenant needing a different IDR for a specific scheme creates a tenant-scoped scheme with their `idrServiceInstanceId` set. This takes precedence (step 1) over their tenant primary (step 3). This is an edge case — most tenants will use a single IDR for all their identifiers via the tenant primary.

### 4c. IDR Service Verification

When an IDR service instance is configured (created or updated), a **verification step** runs. This has two layers: common verification that applies to ALL IDR services, and adapter-specific verification for capabilities unique to certain service providers.

#### Common Verification (All IDR Services)

These checks use the core `IIdentityResolverService` interface methods and common IDR utilities. They apply to every IDR adapter.

**Resolver Description Validation:**
1. Call `getResolverDescription()` to fetch the resolver description file (`/.well-known/resolver`)
2. Validate the response conforms to the expected schema using the common IDR utility

**UNTP Link Type Verification:**
1. Call `getLinkTypes()` to get registered link types
2. Use the common IDR utility to verify that required UNTP link types are supported: `untp:dpp`, `untp:dcc`, `untp:dte`, `untp:idr`
3. **If link types are missing**: **warn** the user during provisioning (do not block). The warning should clearly communicate which types are missing and that link publishing will fail for those types.
4. At link **publishing** time, if the link type is not supported, **fail-fast** with a clear error message referencing the missing link type.

#### Multi-Tenant Scheme Registration (Adapter-Specific, Predicted Common)

Multi-tenant IDR service providers need a mechanism to differentiate between identifier schemes across tenants — e.g. distinguishing GS1 identifiers from ASIC identifiers within the same service instance. This typically manifests as namespace-based scheme registration.

Currently this is implemented in the Pyx adapter via `registerSchemes()`, but we foresee this pattern being common across multi-tenant IDR service providers. The `IIdentityResolverService` interface documentation should note this as a foreseeable pattern, guiding future adapter authors to implement scheme registration when their service provider supports it.

**Pyx-specific implementation:**

Only for schemes whose IDR resolution chain resolves to this specific IDR instance (not ALL system schemes):

1. Walk the resolution chain for each relevant scheme to check if it resolves to this IDR instance
2. Call `GET /identifiers?namespace={namespace}` on the Pyx IDR to check if the scheme is registered
3. For each scheme, verify the application identifiers exist with correct `ai` codes, `regex` patterns, and `qualifiers`
4. **If the scheme is not registered or is incomplete**: call `POST /identifiers` to auto-register the scheme in the Pyx IDR using the `IdentifierDto` format
5. Scheme registration failures should **warn**, not block provisioning

The `IdentifierDto` maps from our scheme data:
- `namespace` — resolved from scheme namespace or registrar namespace
- `applicationIdentifiers` — built from the scheme's `primaryKey`, `validationPattern`, and related `SchemeQualifier` records
  - `ai` = scheme's `primaryKey`
  - `regex` = scheme's `validationPattern`
  - `type` = `"I"` for primary identifiers, `"Q"` for qualifiers

#### Verification Trigger

The verification runs:
- When a new IDR service instance is created
- When an existing IDR service instance configuration is updated
- Common verification runs for ALL adapters; adapter-specific verification runs based on adapter type
- The result (pass/warnings) is returned as part of the API response

### 4d. IDR Link Management

#### LinkRegistration Model (Local Audit)

A minimal local audit record of published links. The external IDR is the source of truth for live link data; this provides a local audit trail.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String (cuid) | Auto | Primary key |
| `tenantId` | String | Yes | Owning tenant (for scoping audit queries) |
| `identifierId` | String (FK → Identifier) | Yes | The identifier this link was published for |
| `idrLinkId` | String | Yes | The IDR service's internal ID for this link — used for subsequent update/delete operations |
| `linkType` | String | Yes | Link relation type (e.g. "untp:dpp") |
| `targetUrl` | String | Yes | Destination URL |
| `mimeType` | String | Yes | MIME type of the target resource |
| `resolverUri` | String | Yes | Canonical URI returned by the IDR |
| `qualifierPath` | String | No | Qualifier path used (e.g. "/10/LOT-2024-A") |
| `publishedAt` | DateTime | Auto | When the link was published |

#### API Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/identifiers/[id]/links` | Publish links for an identifier to the IDR |
| `GET` | `/api/v1/identifiers/[id]/links/[linkId]` | Get a specific link by its IDR-assigned ID |
| `PATCH` | `/api/v1/identifiers/[id]/links/[linkId]` | Update/supersede a link on the IDR |
| `DELETE` | `/api/v1/identifiers/[id]/links/[linkId]` | Unpublish/delete a link from the IDR |

**POST route flow:**
1. Looks up the identifier and its scheme (and scheme's registrar)
2. Resolves the IDR service instance using the resolution chain (4b)
3. Resolves namespace from scheme (if set) or registrar
4. Calls `publishLinks()` on the resolved adapter (which maps to `POST /resolver` on the Pyx IDR)
5. The adapter returns the `LinkRegistration` result including the IDR-assigned link IDs for each published link (see adapter guidance below)
6. Stores `LinkRegistration` audit records locally, capturing the `idrLinkId` for each link
7. Returns the registration result including the IDR link IDs

**Adapter guidance — IDR link ID mapping:** When `publishLinks()` is called, the adapter is responsible for extracting the IDR service's internal link IDs from the response and returning them as part of the `LinkRegistration` result. Each published link must be mapped to its IDR-assigned ID so that subsequent `updateLink()` and `deleteLink()` operations can reference the correct link. The format of the IDR link ID is service-specific (e.g. Pyx returns a numeric ID per link response), and the adapter handles the mapping transparently. The `LinkRegistration` return type should include a `links` array with `{ idrLinkId, link }` pairs.

**GET route flow:**
1. Looks up the identifier and verifies the `linkId` exists in local `LinkRegistration` records
2. Resolves the IDR service instance
3. Calls `getLinkById(linkId)` on the resolved adapter (which maps to `GET /resolver/links/{linkId}` on the Pyx IDR)
4. Returns the live link from the IDR, falling back to the local `LinkRegistration` record if the IDR is unavailable

---

## Resolved Design Decisions

All open questions have been resolved through the spec review process.

| # | Topic | Decision |
|---|-------|----------|
| 1 | GTIN vs SGTIN | Single scheme with optional qualifiers (SGTIN removed from seed data) |
| 2 | primaryKey uniqueness | `@@unique([registrarId, primaryKey, tenantId])` |
| 3 | Identifier value uniqueness | `@@unique([schemeId, value])` — globally unique to prevent multi-tenant IDR collision |
| 4 | IDR link storage | Hybrid: minimal local `LinkRegistration` audit record + live IDR queries |
| 5 | Tenant IDR override | Handled by resolution chain: tenant sets primary IDR (step 3); per-scheme override via tenant-scoped scheme copy (step 1) for edge cases |
| 6 | Qualifier values | Link-time only via `qualifierPath`, not stored on Identifier model |
| 7 | IDR precedence | Scheme > Registrar > Tenant Primary > System Default (most-specific-wins) |
| 8 | registrarId required | Required; tenants create their own registrars for custom schemes |
| 9 | Qualifiers storage | Separate `SchemeQualifier` table (FK to IdentifierScheme) for relational integrity and future range-based issuance |
| 10 | Auto-registration scope | Only schemes whose resolution chain resolves to this IDR instance |
| 11 | Link type warning | Warn at provisioning, fail-fast at publish time |
| 12 | apiVersion | Required on ServiceInstance, semver without `v` prefix, existing records need backfill |
| 13 | Namespace mapping | `namespace` on Registrar (required) + IdentifierScheme (optional tenant override) |
| 14 | Scoping pattern | `tenantId = "system"` (ServiceInstance pattern) |
| 15 | Registrar-SI FK | Application-layer validation: same org or system |
| 16 | Interface gaps | Full CRUD + discovery on core `IIdentityResolverService`: `publishLinks()`, `getLinkById()`, `updateLink()`, `deleteLink()`, `getResolverDescription()`, `getLinkTypes()`; `registerSchemes()` is Pyx-specific; common utilities extracted for adapter reuse |
| 17 | Deletion cascades | Registrar→Scheme: `Cascade`; Scheme→Qualifier: `Cascade`; Scheme→Identifier: `Restrict` |
| 18 | Pyx IDR config schema | `baseUrl` (no path segments) + `apiKey` (adapter constructs Bearer token); optional `defaultFlags` (overridable at publish time) and `defaultContext` |

---

## Resolved — Multi-Tenant IDR Collision

### The Problem

When two tenants share the same IDR service instance and both register the same identifier (e.g. both have ABN "51824753556"), either tenant can publish links for that identifier. This means Tenant A could inadvertently (or maliciously) publish links against Tenant B's identifier on the shared IDR — including overwriting link registrations or injecting malicious payloads.

### Resolution

Identifier values are **globally unique per scheme** (`@@unique([schemeId, value])`). Only one tenant can register a given identifier value. This prevents the collision at the application layer by ensuring only the owning tenant can publish links for that identifier.

This matches the DID model's approach (`did String @unique` — global uniqueness).

Other parties referencing an identifier they don't own (e.g. as a supplier or customer) is handled at the entity-relationship level (Group 2), not by creating duplicate identifier records.

### UNTP-Level Recommendation

At the protocol level, UNTP should consider recommending an **identity anchoring credential** — a verifiable credential from the identifier registrar (e.g. ABR for ABNs) that proves ownership of the identifier. This would provide cryptographic proof of identifier ownership rather than relying solely on application-layer checks. This is a UNTP-level concern, not an application-level implementation item.

---

## 5. Cross-Cutting Changes

### 5a. Rename `tenantId` to `tenantId`

Tenants should be called what they are — tenants, not organisations. This is a cross-cutting rename across the entire codebase.

**Scope:**
- Rename `tenantId` field to `tenantId` on ALL Prisma models (User, Organization, Did, ServiceInstance, Credential, and all new models in this spec)
- Rename `Organization` model to `Tenant`
- Update `withOrgAuth()` middleware → `withTenantAuth()` (or equivalent)
- Update all repository functions, API routes, and service resolution to use `tenantId`
- Update the system-level sentinel value from `tenantId = "system"` to `tenantId = "system"`
- Migration to rename database columns

**Note:** All new models in this spec (Registrar, IdentifierScheme, Identifier, SchemeQualifier, LinkRegistration) should use `tenantId` from the start.

### 5b. Service API Versioning

All service instances need to track the API version of the service they connect to.

**Add to `ServiceInstance`:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiVersion` | String | Yes | Semantic version of the service API without `v` prefix (e.g. "1.0.0", "2.0.0"). Required for all service instances. Existing records will need backfilling. |

**Version-aware adapters:** The `apiVersion` from the ServiceInstance is passed into the adapter at construction time. The adapter uses a version strategy/helper internally to map operations to the correct endpoints and request/response formats for that version. This keeps one adapter type per service provider with a clean internal structure — no registry proliferation, no messy branching.

**Backfill:** Existing VCKit DID service instances will be backfilled with `apiVersion = "1.1.0"` via migration.

---

## 6. DID Manager Backports

These changes apply to the existing DID management functionality. They are included in this iteration because the cross-cutting changes (tenantId rename, service versioning) already require touching this code.

### 6a. DID Import

**Use case:** A user has an existing DID from a service outside the reference implementation. They want to use it to issue credentials but don't need the system to create it — just register it locally.

**Implementation:**
- New API route: `POST /api/v1/dids/import` (or a flag on the existing create route)
- Accepts DID details (did value, type, method, name, etc.) and the associated service instance
- **No-op on the external service** — no DID creation call to the adapter
- Registers the DID locally in the database with type `SELF_MANAGED` (or a new `IMPORTED` type — to be determined)
- Runs the same verification step as any other DID (see 6b below)

### 6b. DID Verification for All Types

**Current state:** Only self-managed DIDs are verified at creation. Managed DIDs skip verification.

**Change:** Self-managed and imported DIDs should be verified at creation. Managed DIDs (created by the adapter) do NOT need verification — the adapter creation is the guarantee of validity.

**Rationale:** Self-managed and imported DIDs originate outside the system's control, so the system needs to confirm they're valid and resolvable. Managed DIDs are created by a trusted adapter, so verification is redundant.

### 6c. Apply Cross-Cutting Changes to DID Manager

- Rename `organizationId` to `tenantId` in DID models, repositories, and API routes
- Add `apiVersion` to existing DID service instances (backfill with `"1.1.0"` via migration)
- Keep `isDefault` field as-is on the DID model — just do the field rename. Full migration to `tenantId = "system"` scoping pattern is deferred to a future iteration.
- Update VCKit DID adapter to accept logger, name, and version in constructor (cross-cutting adapter pattern)

---

## Technical Debt Notes

- **DID scoping inconsistency**: Partially addressed — `organizationId` is renamed to `tenantId`, but `isDefault` remains as the scoping mechanism for system DIDs. Full migration to the `tenantId = "system"` pattern is deferred.

---

## Patterns to Follow

- **Repository pattern**: Static exported functions, Prisma client, tenant-scoped queries. See `did.repository.ts`.
- **API routes**: Next.js App Router handlers, `withTenantAuth()` middleware (renamed from `withOrgAuth()`), JSDoc `@swagger` annotations.
- **Service resolution**: Factory pattern via `resolve-did-service.ts` — resolve config, decrypt, instantiate adapter.
- **Validation**: Use `validation.ts` helpers; throw `ValidationError` for 400s.
- **Error handling**: Use `errors.ts` error classes; `NotFoundError` for 404s, `ServiceRegistryError` for service failures.
- **Swagger tags**: Add new tags: "Registrars", "Schemes", "Identifiers", "Links" (alongside existing "DIDs" and "Credentials").
- **Testing**: Co-located test files (`.test.ts`), following existing test patterns.

---

## Implementation Ordering

Recommended order to minimise risk:

1. **Cross-cutting rename** — `organizationId` → `tenantId`, `Organization` → `Tenant` (schema, code, tests, E2E). Separate migration + commit.
2. **Service API versioning** — Add `apiVersion` to ServiceInstance, backfill VCKit with `"1.1.0"`. Separate migration.
3. **Adapter constructor pattern** — Add logger, name, version to VCKit DID adapter and update factory/registry.
4. **New models** — Registrar, IdentifierScheme, SchemeQualifier, Identifier. New migration.
5. **IDR service integration** — New enums (IDR, PYX_IDR), Pyx adapter updates (apiKey, apiVersion, full CRUD), adapter registry, `resolve-idr-service.ts`, common utilities, verification flow.
6. **Link management** — LinkRegistration model, API routes for link CRUD.
7. **Seed data** — Registrars, schemes, qualifiers, system IDR service instance. Update `cloneSystemDefaults()`.
8. **DID backports** — DID import, verification for self-managed + imported, Swagger updates.

---

## Out of Scope

- Organisation/facility/product entity management (Group 2 — Master Data)
- Credential issuance or storage (Group 6 — Credential Lifecycle)
- Identifier scheme profiles/variants (deferred — use general validationPattern for now)
- Merging DID Manager and Verifiable Credential service (separate work item)
