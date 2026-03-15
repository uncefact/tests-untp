---
sidebar_position: 6
title: Facilities
---

# Facilities API

The Facilities API manages **facilities** — the physical locations (factories, warehouses, farms, processing plants) where products are manufactured, stored, or processed. Facilities are one of the core [master data](../master-data/) entities referenced when issuing UNTP credentials.

:::tip[Interactive API documentation]
The Reference Implementation includes a Swagger UI at [`/api-docs`](http://localhost:3003/api-docs) with full request/response schemas you can try directly from the browser. The endpoint descriptions below focus on behaviour and internal logic — refer to Swagger for exact payload shapes. All endpoints require authentication — see [Authentication](../authentication#obtaining-a-token) for how to obtain a Bearer token.
:::

## Concepts

### What is a facility?

A facility represents a physical site involved in the production or handling of goods. In the context of UNTP, facilities can be referenced by multiple credential types. The Reference Implementation stores facility records as tenant-scoped master data that can be linked to products and credentials.

### Operating Organisation

Each facility can optionally be linked to an **operating organisation** via `operatingOrganisationId`. This references an [organisation](./organisations) record that represents the business entity responsible for running the facility. The operating organisation must belong to the same tenant.

### Identifiers

Facilities support the same identifier model as [organisations](./organisations#identifiers):

- **Primary identifier** — a single main identifier for the facility. Set via `primaryIdentifierId`.
- **Secondary identifiers** — additional identifiers. Set via `secondaryIdentifierIds`.

Identifiers are managed through the [Identifiers API](./identifiers) and linked to facilities by their database IDs. The primary identifier cannot also appear in the secondary identifiers list.

### Location

The optional `location` field stores a structured JSON object describing the geographical position of the facility. See [Location](../master-data/#location) for the field structure.

### Tenant Scoping

Facilities are scoped to the authenticated tenant. Each tenant manages its own set of facilities independently.

## Endpoints

### Create facilities

```
POST /api/v1/facilities
```

Creates one or more facilities in bulk. The request body is an array of facility objects — each must include a `name`. Optional fields include `description`, `location`, `operatingOrganisationId`, `primaryIdentifierId`, and `secondaryIdentifierIds`.

```mermaid
sequenceDiagram
    participant Client
    participant RI as Reference Implementation
    participant DB as Database

    Client->>RI: POST /api/v1/facilities [{ name, ... }]
    RI->>RI: Validate each item (name required)
    alt optional IDs provided
        RI->>DB: Verify referenced records exist and belong to tenant
        alt referenced record not found
            RI-->>Client: 404 Not Found
        end
    end
    RI->>DB: Insert facility records
    DB-->>RI: Created records
    RI-->>Client: 201 Created (array of facilities)
```

---

### List facilities

```
GET /api/v1/facilities
```

Returns facilities for the authenticated tenant with optional filtering. Results are paginated.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search` | string | — | Search by facility name or identifier value |
| `organisationId` | string | — | Filter by operating organisation ID |
| `limit` | integer | `20` | Maximum results per page (clamped to 100) |
| `offset` | integer | `0` | Number of results to skip |

---

### Get a facility

```
GET /api/v1/facilities/{id}
```

Retrieves a specific facility by its database ID. The response includes the full primary identifier (with scheme and registrar details), secondary identifiers, and the operating organisation.

---

### Update a facility

```
PATCH /api/v1/facilities/{id}
```

Updates one or more fields of an existing facility. At least one updatable field must be provided.

| Updatable Field | Description |
|-----------------|-------------|
| `name` | Facility name (must be non-empty if provided) |
| `description` | Free-text description |
| `location` | UNTP location object (set to `null` to clear) |
| `operatingOrganisationId` | ID of the operating organisation (set to `null` to clear) |
| `primaryIdentifierId` | ID of the primary identifier (set to `null` to clear) |
| `secondaryIdentifierIds` | Array of secondary identifier IDs (replaces existing) |

---

### Delete a facility

```
DELETE /api/v1/facilities/{id}
```

Permanently deletes a facility. Returns `204 No Content` with an empty body.

```mermaid
sequenceDiagram
    participant Client
    participant RI as Reference Implementation
    participant DB as Database

    Client->>RI: DELETE /api/v1/facilities/{id}
    RI->>DB: Fetch facility (tenant-scoped)
    alt not found
        RI-->>Client: 404 Not Found
    end
    RI->>DB: Delete facility
    DB-->>RI: Deleted
    RI-->>Client: 204 No Content
```
