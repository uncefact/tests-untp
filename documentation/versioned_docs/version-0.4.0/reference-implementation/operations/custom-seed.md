---
sidebar_position: 2
title: Custom Seed
---

# Custom Seed

The Reference Implementation seeds a set of [default records](./startup.md#step-3-database-seed) on startup: data models, render templates, and service instances. Registrars and identifier schemes are not among them. They come from the manifest described here, so an instance has the registrars and schemes its deployer supplies and no others.

Deployers who need additional data — custom registrars, identifier schemes, data models, render templates, or conformity schemes — can supply a YAML manifest via a Docker volume mount, without modifying the source code or rebuilding the image.

## How It Works

After the core seed completes (see [Startup](./startup.md)), the seed script looks for a custom seed manifest at a well-known path inside the container:

```
/app/seed/custom/seed.yaml
```

If the file exists, it is parsed, validated, and reconciled into the database: the manifest is the source of truth for the rows it manages, so entries are inserted when new, updated when changed, and the corresponding rows are deleted when entries are removed from the manifest. If the file does not exist, the custom seed step is silently skipped and nothing is deleted. See [Reconcile semantics](#reconcile-semantics) for exactly what the manifest owns and how removal behaves.

To supply your own seed data, mount a directory containing your `seed.yaml` (and any referenced files) into the container:

```bash
docker run -v ./my-seed:/app/seed/custom ...
```

Or in Docker Compose:

```yaml
services:
  reference-implementation:
    volumes:
      - ./my-seed:/app/seed/custom
```

The mounted directory should contain:

- `seed.yaml` — the manifest (required)
- Any template files referenced by render templates, e.g. `templates/dpp.hbs` (if applicable)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SKIP_CUSTOM_SEED` | Set to `true` to skip custom seed processing entirely | `false` |
| `CVC_REFRESH_INTERVAL_HOURS` | Cadence, in hours, of the periodic refresh of URL-seeded conformity schemes (maximum 500) | `24` |

Setting `SKIP_CUSTOM_SEED=true` prevents the custom seed from running even if a manifest file is present.

## ID Format

Every entity in the manifest requires an `id` field in **CUID v1** format. CUIDs (Collision-resistant Unique Identifiers) are used throughout the Reference Implementation as primary keys.

A CUID v1 looks like: `cxuj555flzqtp4ldvklv6ya39` — a 25-character lowercase string starting with `c`.

To generate CUIDs for your manifest, use any CUID v1 library or online generator:

```bash
node -e "const s='cdefghijklmnopqrstuvwxyz',t=Date.now().toString(36),r=()=>Math.random().toString(36).slice(2);console.log('c'+t+r()+r())"
```

Each ID must be unique across the entire manifest. If an ID matches a system-tenant record created through the API/UI, or one already managed by a previous custom seed run, it is adopted and updated (upserted). If it matches a system-tenant record created by the core seed, validation fails (see [Core seed protection](#phase-2-referential-integrity)). If it matches a record owned by a different tenant, validation also fails.

## Manifest Structure

The manifest is a YAML file with four top-level arrays. All are optional, and whether a key is present matters: an omitted key leaves that entity type unmanaged for the run, while a key that is present (even as an explicit empty array) makes the manifest authoritative for that type, including deletions. See [Reconcile semantics](#reconcile-semantics).

```yaml
registrars: []         # Identifier registrars with nested schemes and qualifiers
dataModels: []         # Data model extension configurations
renderTemplates: []    # HTML render templates (files referenced by relative path)
conformitySchemes: []  # Conformity schemes to ingest under the system tenant
```

### Registrars

A registrar represents an identifier-issuing authority (e.g. GS1, a national business register). Each registrar can contain nested identifier schemes, and each scheme can contain nested qualifiers.

```yaml
registrars:
  - id: "clxyz1234567890abcdefghij"
    name: "My Registrar"
    namespace: "my-registrar.example.com"
    url: "https://my-registrar.example.com"              # optional
    idrServiceInstanceId: "clxyz00000000000000000001"     # optional — links to an IDR service instance
    identifierSchemes:
      - id: "clxyz1234567890scheme1abc"
        name: "Product ID"
        primaryKey: "01"
        validationPattern: "^\\d{14}$"
        linkTemplate: "https://id.example.com/01/{value}"
        qualifiers:                                       # optional
          - id: "clxyz1234567890qual01abcd"
            key: "10"
            description: "Batch or lot number"
            validationPattern: "^[\\x21-\\x22\\x25-\\x2F\\x30-\\x39\\x41-\\x5A\\x61-\\x7A]{1,20}$"
            order: 1                                      # optional, defaults to 0
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | CUID v1 | Yes | Unique identifier |
| `name` | string | Yes | Display name |
| `namespace` | string | Yes | Namespace identifier |
| `url` | URL | No | Registrar website |
| `idrServiceInstanceId` | CUID v1 | No | Reference to an IDR service instance |
| `identifierSchemes` | array | No | Nested identifier schemes |

**Identifier Scheme fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | CUID v1 | Yes | Unique identifier |
| `name` | string | Yes | Display name |
| `primaryKey` | string | Yes | Primary key code (e.g. `"01"` for GTIN) |
| `validationPattern` | string | Yes | Regular expression for validating identifiers |
| `linkTemplate` | string | Yes | URL template for resolving identifiers |
| `qualifiers` | array | No | Nested qualifiers |

**Qualifier fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | CUID v1 | Yes | Unique identifier |
| `key` | string | Yes | Qualifier key code |
| `description` | string | Yes | Human-readable description |
| `validationPattern` | string | Yes | Regular expression for validating qualifier values |
| `order` | integer | No | Sort order (defaults to 0) |

### Data Models

Data models define credential types. Custom data models **must** reference a core (non-extension) data model as their parent — this links your extension to one of the built-in UNTP credential types (DPP, DCC, DFR, DIA, DTE).

```yaml
dataModels:
  - id: "clxyz1234567890model1abcd"
    name: "Australian DPP v1.0"
    credentialType: "DigitalProductPassport"
    version: "1.0.0"
    parentConfigId: "c1pxfzzkeb86jgeel7hrvmcle"    # must reference a core data model
    schemaUrl: "https://example.com/schemas/au-dpp.json"
    contextUrl: "https://example.com/contexts/au-dpp.jsonld"
    websiteUrl: "https://example.com/docs/au-dpp"    # optional
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | CUID v1 | Yes | Unique identifier |
| `name` | string | Yes | Display name |
| `credentialType` | string | Yes | Credential type name |
| `version` | string | Yes | Version string |
| `parentConfigId` | CUID v1 | Yes | ID of an existing core data model in the database |
| `schemaUrl` | URL | Yes | JSON Schema URL for the credential |
| `contextUrl` | URL | Yes | JSON-LD context URL |
| `websiteUrl` | URL | No | Documentation URL |

The `parentConfigId` must reference a core data model created by the default seed, not another extension. The core data models and their IDs are:

| Credential Type | Version | ID |
|----------------|---------|-----|
| DigitalProductPassport | 0.6.0 | `cxuj555flzqtp4ldvklv6ya39` |
| DigitalProductPassport | 0.6.1 | `c1pxfzzkeb86jgeel7hrvmcle` |
| DigitalProductPassport | 0.7.0 | `ca3frzta22f7lblxntvw6ukuh` |
| DigitalConformityCredential | 0.6.0 | `c3imzyum0txv1y9xkww88aktp` |
| DigitalConformityCredential | 0.6.1 | `cttpz40pfgcfeue2wmbc3jti8` |
| DigitalConformityCredential | 0.7.0 | `ca9ndkrc8lxmtsfzwynui40zy` |
| DigitalFacilityRecord | 0.6.0 | `ctfgtrsuiwv1fedo9t5swxhnk` |
| DigitalFacilityRecord | 0.6.1 | `csrtste8ai2llop7ui8u6n11l` |
| DigitalFacilityRecord | 0.7.0 | `cj3s37lt6pvh56ggspr9upt5m` |
| DigitalIdentityAnchor | 0.6.0 | `cz9raijqcay5nzmq59geoggrk` |
| DigitalIdentityAnchor | 0.6.1 | `cn5u63huxvqgdwppebaxmqt9l` |
| DigitalIdentityAnchor | 0.7.0 | `cw0tzf723j1oql3u4s1r0c2g2` |
| DigitalTraceabilityEvent | 0.6.0 | `crqvpwffc0k2p4bvr8za1ii6j` |
| DigitalTraceabilityEvent | 0.6.1 | `cwb7m3k0hpz9xqft6rjn2oe4s` |
| DigitalTraceabilityEvent | 0.7.0 | `cfhlj3bumipb74z8irp6uiuxn` |

These IDs are defined in [`prisma/seed.ts`](https://github.com/uncefact/tests-untp/blob/main/packages/reference-implementation/prisma/seed.ts). New core data models may be added in future releases.

### Render Templates

Render templates define how credentials are displayed. Each template references an HTML file (typically a Handlebars `.hbs` file) by relative path from the mount directory.

```yaml
renderTemplates:
  - id: "clxyz1234567890templ1abcd"
    name: "AU DPP Default Template"
    file: "templates/au-dpp.hbs"
    dataModelId: "clxyz1234567890model1abcd"
    renderMethodType: "RenderTemplate2024"
    isDefault: true                                  # optional, defaults to false
    inline: false                                    # optional
    mediaType: "text/html"                           # optional
    mediaQuery: ""                                   # optional
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | CUID v1 | Yes | Unique identifier |
| `name` | string | Yes | Display name |
| `file` | string | Yes | Relative path to the template file within the mount directory |
| `dataModelId` | CUID v1 | Yes | Reference to a data model (in the manifest or already in the database) |
| `renderMethodType` | string | Yes | Either `"RenderTemplate2024"` or `"WebRenderingTemplate2022"` |
| `isDefault` | boolean | No | Whether this is the default template for its data model (defaults to `false`) |
| `inline` | boolean | No | Whether the template should be inlined |
| `mediaType` | string | No | MIME type of the rendered output |
| `mediaQuery` | string | No | CSS media query for the template |

The template file at the specified path is uploaded to the storage service during seed processing. The storage service must be configured and reachable.

:::caution
Only one render template per data model may have `isDefault: true`. If multiple templates for the same data model are marked as default, validation will fail.
:::

### Conformity Schemes

Conformity schemes are ingested under the system tenant with `source = SYSTEM_SEED`. Each entry points at a single scheme document — either a remote URL the loader fetches at seed time, or a local JSON-LD file in the mount directory.

```yaml
conformitySchemes:
  - url: "https://vocab.example.com/scheme-a"
    version: "0.7.0"
  - file: "schemes/scheme-b.json"
    version: "0.7.0"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | URL | Yes (or `file`) | HTTP(S) URL of the scheme document to fetch at seed time |
| `file` | string | Yes (or `url`) | Path relative to the mount directory of a local JSON-LD scheme document |
| `version` | string | Yes | CVC specification version this document conforms to, e.g. `"0.7.0"` |

Exactly one of `url` or `file` must be set per entry. The scheme's display name and structure (profiles, criteria) are derived from the document itself; no operator-supplied name is required.

For scheme **content**, every entry is re-ingested on each boot so publisher updates are picked up: an unchanged document is detected cheaply (HTTP validators for URL entries, a content digest for file entries) and skipped, a changed document replaces the stored scheme and its profiles, and a failed fetch or parse keeps the previously stored content while recording the failure on the row. Between boots, URL-sourced entries are also refreshed periodically; see [Periodic refresh](#periodic-refresh).

For scheme **membership**, the manifest reconciles like the other sections when the `conformitySchemes` key is present: seeded (`SYSTEM_SEED`) rows whose source URL no longer appears in the manifest are deleted, together with their profiles, and criteria that no remaining profile references are cleaned up afterwards. UNTP-discovered and tenant-imported schemes are never touched. If any `file` entry cannot be read or parsed, deletion is skipped for that run (with an error logged), so a transiently unavailable file can never cause a previously ingested scheme to be removed.

For file entries, the loader reads the top-level `id` (or `@id`) from the JSON-LD document to determine the row's `sourceUrl`. The file must be a valid JSON-LD scheme document.

## Complete Example

Below is a full example manifest that provisions a custom registrar with an identifier scheme, a data model extension, a render template, and two conformity schemes (one fetched from a URL, one read from a local file).

Mount directory structure:

```
my-seed/
  seed.yaml
  templates/
    au-dpp.hbs
  schemes/
    au-fallback-scheme.json
```

`seed.yaml`:

```yaml
registrars:
  - id: "clxyz1234567890abreg1abcd"
    name: "Australian Business Register"
    namespace: "abr.gov.au"
    url: "https://abr.gov.au"
    identifierSchemes:
      - id: "clxyz1234567890abnscabcde"
        name: "Australian Business Number"
        primaryKey: "abn"
        validationPattern: "^\\d{11}$"
        linkTemplate: "https://abr.business.gov.au/ABN/View?abn={value}"

dataModels:
  - id: "clxyz1234567890aumodabcde"
    name: "AU Digital Product Passport"
    credentialType: "DigitalProductPassport"
    version: "1.0.0"
    parentConfigId: "c1pxfzzkeb86jgeel7hrvmcle"
    schemaUrl: "https://example.com/schemas/au-dpp-v1.json"
    contextUrl: "https://example.com/contexts/au-dpp-v1.jsonld"
    websiteUrl: "https://example.com/docs/au-dpp"

renderTemplates:
  - id: "clxyz1234567890autplabcde"
    name: "AU DPP Template"
    file: "templates/au-dpp.hbs"
    dataModelId: "clxyz1234567890aumodabcde"
    renderMethodType: "RenderTemplate2024"
    isDefault: true

conformitySchemes:
  - url: "https://vocab.example.com/au-scheme"
    version: "0.7.0"
  - file: "schemes/au-fallback-scheme.json"
    version: "0.7.0"
```

## Validation

The manifest goes through two validation phases before any data is written to the database.

### Phase 1: Schema Validation

The YAML is validated against a strict schema. Errors at this phase include:

- Missing required fields
- Invalid field types (e.g. a number where a string is expected)
- IDs that are not valid CUID v1 format
- URLs that are not valid
- Invalid `renderMethodType` values

### Phase 2: Referential Integrity

After schema validation passes, the system checks cross-references and constraints:

- **No duplicate IDs** — every `id` across the entire manifest must be unique
- **Parent data model references** — each data model's `parentConfigId` must reference a core (non-extension) data model that exists in the database
- **Render template data model references** — each render template's `dataModelId` must reference either a data model in the manifest or one already in the database
- **Template file existence** — each render template's `file` must point to a file that exists within the mount directory
- **Path traversal protection** — template file paths cannot reference files outside the mount directory (e.g. `../../etc/passwd` is rejected)
- **Default template uniqueness** — only one render template per data model may be marked as `isDefault: true`
- **Tenant ID collision protection** — IDs that already exist in a non-system tenant cannot be upserted
- **Core seed protection** — IDs that belong to rows created by the core seed cannot be claimed by the manifest
- **Cascade protection** — a render template kept in the manifest cannot reference a manifest-managed data model that the same run would delete

If any validation error is detected, the seed process exits with code 1 and logs the specific errors. No data is written.

Conformity scheme entries are validated structurally (URL XOR file, required `version`) at Phase 1. Other concerns (URL reachability, file existence, presence of the `ConformityScheme` data-model row for the entry's `version`) are evaluated at processing time and recorded as per-entry skips or failures; they do not abort the seed pass.

## Processing Order

Once validation passes, the custom seed processes entities in the following order:

1. **Upload render template files** to the storage service
2. **Upsert all entities** (registrars, schemes, qualifiers, data models, render templates) and then **delete manifest-managed rows whose entries were removed**, in a single atomic database transaction
3. **Reconcile and ingest conformity schemes** (outside the main transaction). The loader first resolves every entry's identity, then deletes seeded schemes no longer in the manifest, then for each remaining entry either fetches the URL or reads the file and runs the scheme through the CVC pipeline (fetch → JSON parse → schema validate → JSON-LD expand → parse → persist), and finally removes criteria that no profile references any more. Per-entry failures are logged and counted; the loop continues to the next entry.

## Periodic Refresh

URL-sourced conformity schemes are re-fetched on a periodic in-process schedule (default every 24 hours, configurable via `CVC_REFRESH_INTERVAL_HOURS`), so a publisher updating a scheme document at its source URL is picked up without redeploying. The refresh reads the rows from the database rather than the manifest, applies the same unchanged/changed/failure behaviour as the boot ingest, and removes criteria that no profile references once a refresh drops them. File-sourced schemes are not fetched between boots; their content refreshes at boot from the mounted file, which is their source of truth. A failed refresh never removes a scheme: the previously stored content stays until a later fetch succeeds, with the failure recorded on the row and in the logs.

## Reconcile Semantics

Every row the custom seed writes is recorded as manifest-managed, and the removal phase only ever deletes rows carrying that record. Rows created by the core seed can never be claimed or touched by the manifest (a matching id fails validation).

A system-tenant row that is not core-seeded and not yet manifest-managed (one created through the API or UI, or by the custom seed before this record existed) IS claimed when a manifest entry uses its `id`: the entry updates the row and records it as manifest-managed from then on, exactly as if the manifest had created it. Each adoption is named in a warning in the seed log, because from that point the row is deletable by future reconciles. Nothing is deleted during the adopting run itself, since deletion only applies to rows already recorded as manifest-managed. If you did not intend to take over an existing row, choose a fresh id for the manifest entry.

For each of the four sections (and the nested `identifierSchemes` and `qualifiers` lists), the behaviour depends on whether the key is present in the YAML:

| Manifest state | Behaviour |
|----------------|-----------|
| Key absent | That entity type is left untouched — no inserts, updates, or deletions |
| Key present with entries | Entries are inserted or updated; manifest-managed rows not listed are **deleted** |
| Key present, explicitly empty (`registrars: []` or `registrars:`) | **All** manifest-managed rows of that type are deleted |

:::danger
An explicitly empty section is a deletion instruction, unlike an omitted one. Removing a section's entries while keeping the key deletes every row that section previously seeded. If you want to stop managing a type without deleting anything, remove the key entirely. A manifest with no section keys at all (an empty file or `{}`) does nothing.
:::

Moving a nested entry between parents (an identifier scheme to a different registrar, a qualifier to a different scheme) is supported: the child is re-attached to its new parent.

Removing a parent entry removes its manifest-created children with it (a deleted registrar takes its seeded identifier schemes and qualifiers, a deleted data model takes its seeded render templates), whether or not the old entry ever declared the nested keys. The nested presence rules govern reconciliation within a retained parent, not survival of children under a removed one.

### When removal is refused

A deletion that would take data the manifest does not own down with it fails the whole seed (exit code 1, no database changes are committed) with an error naming the blocking rows:

- a registrar whose identifier schemes include any not created by this manifest (for example a tenant's own scheme attached to a seeded registrar)
- an identifier scheme whose qualifiers include any not created by this manifest
- an identifier scheme with registered identifiers (identifier values created through the API that link registrations depend on)
- a data model with render templates or extensions not created by this manifest

To proceed, keep the manifest entry, or migrate or delete the blocking data first.

The `ConformityScheme` data model entry, which supplies the JSON Schema the ingestion pipeline validates scheme documents against, is always core-seeded. It can never be claimed or deleted by the manifest (see [Core seed protection](#phase-2-referential-integrity)), so a scheme's schema binding can never be stranded by a custom-seed removal.

### Render template storage objects

Deleting a render template removes its database row only. The uploaded template file stays in the storage service, because credentials already issued against it may still render from it. Cleaning up storage objects is a manual operator action, taken only once no issued credentials still reference the template.

### Identity Resolver (IDR) registrations

IDR registration runs after the custom seed's database transaction has committed, and only when the system IDR service instance was seeded successfully with the Pyx IDR adapter (the data encryption key is present, the IDR configuration is valid, and the service instance upsert succeeded). If that instance was not seeded, registration is skipped and the earlier service-instance warning is the signal.

Each qualifying seed run reads every identifier scheme on the system tenant (including any created outside the manifest), groups them by the registrar's `namespace` (the manifest field `registrars[].namespace`), and sends one complete application-identifier document per non-empty namespace to the IDR. Against the bundled Pyx Identity Resolver 4.0.0 that request is a replacing upsert: the IDR overwrites the namespace's application-identifier list and returns success, on first seed and on every later run alike. See [Identifier Management in the Pyx IDR developer guide](https://pyx-industries.github.io/pyx-identity-resolver/docs/developer-guide/#identifier-management).

What that means for manifest changes:

- Changing a scheme's name, primary key, validation pattern, or qualifiers, or adding a scheme, is applied to the IDR by the next successful seed run. No manual step is needed.
- Removing a scheme whose registrar still has other schemes is also applied by the next seed run, which re-sends the namespace without it. Do not delete the namespace for this case; deleting a namespace orphans every link registered under it.
- Removing a registrar, removing its last scheme, or renaming `registrars[].namespace` stops that namespace being sent at all, so the old registration stays in the IDR. The seed never deletes a namespace. Leave the stale namespace in place by default, and remove it (`DELETE /api/v4/identifiers?namespace=<namespace>`) only after confirming that no other system registers against it or resolves through it and that no registered links still depend on it. That confirmation sits with the operator of the IDR, outside this application's tooling. To inspect what the IDR currently holds, use `GET /api/v4/identifiers?namespace=<namespace>`.

An IDR can be shared by multiple systems, and the Reference Implementation does not own the namespaces it registers. The seed does not yet account for that: because each run replaces the whole application-identifier list for a namespace, application identifiers added to a seed-managed namespace by another system or by hand are removed by the next seed run. Until that is addressed, register other systems' schemes under namespaces the seed does not manage, or they will not survive a re-seed.

IDR failures never affect the database reconcile, which commits in its own transaction before IDR registration runs. A per-namespace validation rejection from the IDR is logged and that namespace is skipped, without failing the seed. Any other registration failure (the IDR unreachable, an authentication error, a server error) exits the seed with code 1 so the failure is visible rather than leaving namespaces silently unregistered; re-run the seed once the IDR is available, and it registers every namespace again.

## Important Notes

- **Runs after core seed** — custom seed depends on core data models and service instances already existing. It runs as the final database-seeding step of the seed process described in [Startup](./startup.md), followed only by IDR registration.
- **Idempotent** — re-running the seed with an unchanged manifest performs no deletions and converges to the same state.
- **Atomic (database)** — registrar, scheme, qualifier, data model, and render template writes and deletions happen in a single database transaction. If any write fails or a removal is refused, the entire batch is rolled back. Render template files are uploaded to the storage service before that transaction, so a rolled-back run can leave uploaded template objects in storage with no database row; they are harmless and can be cleaned up manually.
- **System tenant ownership** — all custom seed entities are owned by the system tenant.
- **Storage service required for templates** — if your manifest includes render templates, the storage service must be configured and reachable at seed time.
- **Network access required for URL-sourced conformity schemes** — any `conformitySchemes` entry with a `url` field must be reachable at seed time. File-sourced entries are read directly from the mount directory and do not need network access.
- **Exit on error** — validation failures cause the seed process to exit with code 1, preventing the application from starting with invalid data.
