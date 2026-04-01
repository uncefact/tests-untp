---
sidebar_position: 2
title: Custom Seed
---

# Custom Seed

The Reference Implementation ships with a set of [default seed data](./startup.md#step-2-database-seed) — registrars, identifier schemes, data models, render templates, and service instances. These defaults cover common UNTP use cases out of the box.

Deployers who need additional data — custom registrars, identifier schemes, data models, render templates, or CVC catalogues — can supply a YAML manifest via a Docker volume mount, without modifying the source code or rebuilding the image.

## How It Works

After the core seed completes (see [Startup](./startup.md)), the seed script looks for a custom seed manifest at a well-known path inside the container:

```
/app/seed/custom/seed.yaml
```

If the file exists, it is parsed, validated, and its contents are upserted into the database. If the file does not exist, the custom seed step is silently skipped.

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

Setting `SKIP_CUSTOM_SEED=true` prevents the custom seed from running even if a manifest file is present.

## ID Format

Every entity in the manifest requires an `id` field in **CUID v1** format. CUIDs (Collision-resistant Unique Identifiers) are used throughout the Reference Implementation as primary keys.

A CUID v1 looks like: `clxyz1234567890abcdef` — a 25-character lowercase string starting with `c`.

To generate CUIDs for your manifest, use any CUID v1 library or online generator:

```bash
node -e "const s='cdefghijklmnopqrstuvwxyz',t=Date.now().toString(36),r=()=>Math.random().toString(36).slice(2);console.log('c'+t+r()+r())"
```

Each ID must be unique across the entire manifest. If an ID matches a record already in the database owned by the system tenant, it will be updated (upserted). If it matches a record owned by a different tenant, validation will fail.

## Manifest Structure

The manifest is a YAML file with four top-level arrays. All are optional — omit any section you do not need.

```yaml
registrars: []        # Identifier registrars with nested schemes and qualifiers
dataModels: []        # Data model extension configurations
renderTemplates: []   # HTML render templates (files referenced by relative path)
cvcCatalogues: []     # Remote CVC catalogue endpoints to import
```

### Registrars

A registrar represents an identifier-issuing authority (e.g. GS1, a national business register). Each registrar can contain nested identifier schemes, and each scheme can contain nested qualifiers.

```yaml
registrars:
  - id: "clxyz1234567890abcdef"
    name: "My Registrar"
    namespace: "my-registrar.example.com"
    url: "https://my-registrar.example.com"              # optional
    idrServiceInstanceId: "clxyz0000000000000001"         # optional — links to an IDR service instance
    identifierSchemes:
      - id: "clxyz1234567890scheme1"
        name: "Product ID"
        primaryKey: "01"
        validationPattern: "^\\d{14}$"
        linkTemplate: "https://id.example.com/01/{value}"
        qualifiers:                                       # optional
          - id: "clxyz1234567890qual01"
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
  - id: "clxyz1234567890model1"
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
| DigitalConformityCredential | 0.6.0 | `c3imzyum0txv1y9xkww88aktp` |
| DigitalConformityCredential | 0.6.1 | `cttpz40pfgcfeue2wmbc3jti8` |
| DigitalFacilityRecord | 0.6.0 | `ctfgtrsuiwv1fedo9t5swxhnk` |
| DigitalFacilityRecord | 0.6.1 | `csrtste8ai2llop7ui8u6n11l` |
| DigitalIdentityAnchor | 0.6.0 | `cz9raijqcay5nzmq59geoggrk` |
| DigitalIdentityAnchor | 0.6.1 | `cn5u63huxvqgdwppebaxmqt9l` |
| DigitalTraceabilityEvent | 0.6.0 | `crqvpwffc0k2p4bvr8za1ii6j` |
| DigitalTraceabilityEvent | 0.6.1 | `cwb7m3k0hpz9xqft6rjn2oe4s` |

These IDs are defined in [`prisma/seed.ts`](https://github.com/uncefact/tests-untp/blob/main/packages/reference-implementation/prisma/seed.ts). New core data models may be added in future releases.

### Render Templates

Render templates define how credentials are displayed. Each template references an HTML file (typically a Handlebars `.hbs` file) by relative path from the mount directory.

```yaml
renderTemplates:
  - id: "clxyz1234567890templ1"
    name: "AU DPP Default Template"
    file: "templates/au-dpp.hbs"
    dataModelId: "clxyz1234567890model1"
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

### CVC Catalogues

CVC (Conformity Verification Certificate) catalogues define remote endpoints from which conformity credential catalogues are imported.

```yaml
cvcCatalogues:
  - id: "clxyz1234567890cvc01"
    name: "Example CVC Catalogue"
    version: "0.6.0"
    endpointUrl: "https://example.com/api/cvc-catalogue"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | CUID v1 | Yes | Unique identifier |
| `name` | string | Yes | Display name |
| `version` | string | Yes | CVC specification version (must be a supported version) |
| `endpointUrl` | URL | Yes | Remote endpoint to fetch the catalogue from |

The endpoint is fetched during seed processing (with automatic retry on failure). The remote service must be reachable at seed time.

## Complete Example

Below is a full example manifest that provisions a custom registrar with an identifier scheme, a data model extension, a render template, and a CVC catalogue.

Mount directory structure:

```
my-seed/
  seed.yaml
  templates/
    au-dpp.hbs
```

`seed.yaml`:

```yaml
registrars:
  - id: "clxyz1234567890abreg1"
    name: "Australian Business Register"
    namespace: "abr.gov.au"
    url: "https://abr.gov.au"
    identifierSchemes:
      - id: "clxyz1234567890abnsc"
        name: "Australian Business Number"
        primaryKey: "abn"
        validationPattern: "^\\d{11}$"
        linkTemplate: "https://abr.business.gov.au/ABN/View?abn={value}"

dataModels:
  - id: "clxyz1234567890aumod"
    name: "AU Digital Product Passport"
    credentialType: "DigitalProductPassport"
    version: "1.0.0"
    parentConfigId: "c1pxfzzkeb86jgeel7hrvmcle"
    schemaUrl: "https://example.com/schemas/au-dpp-v1.json"
    contextUrl: "https://example.com/contexts/au-dpp-v1.jsonld"
    websiteUrl: "https://example.com/docs/au-dpp"

renderTemplates:
  - id: "clxyz1234567890autpl"
    name: "AU DPP Template"
    file: "templates/au-dpp.hbs"
    dataModelId: "clxyz1234567890aumod"
    renderMethodType: "RenderTemplate2024"
    isDefault: true

cvcCatalogues:
  - id: "clxyz1234567890cvcau"
    name: "AU Conformity Catalogue"
    version: "0.6.0"
    endpointUrl: "https://example.com/api/cvc-catalogue"
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
- **CVC version support** — catalogue versions must be supported by the system

If any validation error is detected, the seed process exits with code 1 and logs the specific errors. No data is written.

## Processing Order

Once validation passes, the custom seed processes entities in the following order:

1. **Upload render template files** to the storage service
2. **Fetch CVC catalogues** from remote endpoints (with retry)
3. **Upsert all entities** (registrars, schemes, qualifiers, data models, render templates) in a single atomic database transaction
4. **Import CVC catalogues** (outside the main transaction)

## Important Notes

- **Runs after core seed** — custom seed depends on core data models and service instances already existing. It runs as the final step of the seed process described in [Startup](./startup.md).
- **Idempotent** — all operations use upsert. Re-running the seed with the same manifest is safe and will update existing records.
- **Atomic** — registrars, schemes, qualifiers, data models, and render templates are written in a single database transaction. If any write fails, the entire batch is rolled back.
- **System tenant ownership** — all custom seed entities are owned by the system tenant.
- **Storage service required for templates** — if your manifest includes render templates, the storage service must be configured and reachable at seed time.
- **Network access required for CVC catalogues** — catalogue endpoints must be reachable at seed time.
- **Exit on error** — validation failures cause the seed process to exit with code 1, preventing the application from starting with invalid data.
