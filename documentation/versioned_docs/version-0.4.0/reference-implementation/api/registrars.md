---
sidebar_position: 9
title: Registrars
---

# Registrars API

The Registrars API manages **registrars** — the organisations that maintain identifier schemes (e.g. GS1 for GTIN barcodes, the ATO for Australian Business Numbers). Registrars are one of the foundational configuration entities that underpin [identifier schemes](./identifiers) and, by extension, the identifiers assigned to products, facilities, and organisations.

:::tip[Interactive API documentation]
The Reference Implementation includes a Swagger UI at [`/api-docs`](http://localhost:3003/api-docs) with full request/response schemas you can try directly from the browser. The endpoint descriptions below focus on behaviour and internal logic — refer to Swagger for exact payload shapes. All endpoints require authentication — see [Authentication](../authentication#obtaining-a-token) for how to obtain a Bearer token.
:::

## Concepts

### What is a registrar?

A registrar represents a real-world organisation that defines and governs one or more identifier schemes. For example:

- **GS1** is the registrar for schemes such as GTIN (Global Trade Item Number) and GLN (Global Location Number).
- **Australian Taxation Office (ATO)** is the registrar for the ABN (Australian Business Number) scheme.

In the Reference Implementation, a registrar record groups related identifier schemes together and provides the metadata needed when publishing those schemes to an Identity Resolver (IDR) service.

### Relationship to identifier schemes

A registrar has a one-to-many relationship with [identifier schemes](./identifiers). Each scheme belongs to exactly one registrar. When you create a scheme, you reference its parent registrar by ID. Deleting a registrar will cascade-delete all of its schemes (and their qualifier definitions).

### Namespace

The `namespace` field is the grouping key used when publishing identifier schemes to an IDR service. It typically matches the registrar's well-known abbreviation (e.g. `gs1`, `ato`). All schemes under a registrar share this namespace in the IDR.

### IDR service instance linkage

A registrar can optionally be linked to an **IDR service instance** via `idrServiceInstanceId`. This determines which configured IDR service is responsible for resolving identifiers issued under the registrar's schemes. The referenced instance must be one the tenant can use: its own, or a system default. An ID that does not resolve to such an instance is rejected with a 404. The linkage is optional, and a PATCH with `idrServiceInstanceId: null` clears the association. If the linked service instance is deleted, the reference is automatically cleared.

### Tenant scoping

Registrars are scoped to a tenant (organisation). Each tenant manages its own registrars independently. However, **system default registrars** (those belonging to the system tenant) are visible to all tenants. This means the list endpoint returns both the tenant's own registrars and any system-wide defaults.

System default registrars cannot be updated or deleted by regular tenants — only tenant-owned registrars may be modified.

## Endpoints

### Create a registrar

```
POST /api/v1/registrars
```

Creates a new registrar for the authenticated tenant. The request body must include `name`, `namespace`, and `url`. Optionally, an `idrServiceInstanceId` can be provided to link the registrar to an IDR service instance. Unknown keys are ignored. Sending an optional field as an explicit `null` is rejected with a 400 (omit the field instead).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable name (e.g. "GS1"). Must contain at least one non-whitespace character |
| `namespace` | string | Yes | Grouping key for IDR publishing (e.g. "gs1"). Must contain at least one non-whitespace character |
| `url` | string | Yes | A valid public http(s) URL for the registrar's website. Rejected with a 400 if it is not a valid, public http(s) URL, or if it carries leading or trailing whitespace |
| `idrServiceInstanceId` | string | No | ID of an IDR service instance to link. Must be accessible to the tenant (its own, or a system default); otherwise the request is rejected with a 404 |

```mermaid
sequenceDiagram
    participant Client
    participant RI as Reference Implementation
    participant DB as Database

    Client->>RI: POST /api/v1/registrars { name, namespace, url }
    RI->>RI: Validate body (required fields, formats)
    alt validation fails
        RI-->>Client: 400 Bad Request
    end
    RI->>RI: Validate url is a public http(s) URL
    alt url is not a public http(s) URL
        RI-->>Client: 400 Bad Request
    end
    opt idrServiceInstanceId provided
        RI->>DB: Verify instance is accessible to this tenant (own or system default)
        alt service instance not found
            RI-->>Client: 404 Not Found
        end
    end
    RI->>DB: Insert registrar record
    DB-->>RI: Created record
    RI-->>Client: 201 Created (registrar)
```

---

### List registrars

```
GET /api/v1/registrars
```

Returns registrars for the authenticated tenant, **including system defaults**. Results are paginated and ordered by creation date (newest first).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | Defaults to 20, or the [configured maximum](../operations/api-pagination#maximum-page-size) when it is lower | A value above the maximum is rejected with a 400 that names the maximum |
| `offset` | integer | `0` | Number of results to skip |

```mermaid
sequenceDiagram
    participant Client
    participant RI as Reference Implementation
    participant DB as Database

    Client->>RI: GET /api/v1/registrars?limit=20&offset=0
    RI->>RI: Parse and validate pagination parameters
    RI->>DB: Query registrars (tenant-owned + system defaults)
    DB-->>RI: Registrar records + total count
    RI-->>Client: 200 OK { data, pagination }
```

---

### Get a registrar

```
GET /api/v1/registrars/{id}
```

Retrieves a specific registrar by its database ID. The registrar must belong to the authenticated tenant or be a system default. The response includes nested **schemes** and their **qualifier definitions**.

---

### Update a registrar

```
PATCH /api/v1/registrars/{id}
```

Updates one or more fields of an existing registrar. At least one updatable field must be provided. Only tenant-owned registrars can be updated — system defaults are read-only.

| Updatable Field | Description |
|-----------------|-------------|
| `name` | Registrar name (non-empty and not only whitespace if provided; an explicit `null` is rejected with a 400) |
| `namespace` | Namespace grouping key (non-empty and not only whitespace if provided; an explicit `null` is rejected with a 400) |
| `url` | A valid public http(s) URL for the registrar's website. Rejected with a 400 if provided and not a valid, public http(s) URL, if it carries leading or trailing whitespace, or if it is an explicit `null` (unlike `idrServiceInstanceId`, `url` cannot be cleared through this API) |
| `idrServiceInstanceId` | IDR service instance ID (set to `null` to clear the linkage). A new ID must be accessible to the tenant (its own, or a system default); otherwise the request is rejected with a 404 |

```mermaid
sequenceDiagram
    participant Client
    participant RI as Reference Implementation
    participant DB as Database

    Client->>RI: PATCH /api/v1/registrars/{id} { name, ... }
    RI->>RI: Validate body (at least one recognised field, field formats)
    alt validation fails
        RI-->>Client: 400 Bad Request
    end
    opt url provided
        RI->>RI: Validate url is a public http(s) URL
        alt url is not a public http(s) URL
            RI-->>Client: 400 Bad Request
        end
    end
    opt idrServiceInstanceId provided (non-null)
        RI->>DB: Verify instance is accessible to this tenant (own or system default)
        alt service instance not found
            RI-->>Client: 404 Not Found
        end
    end
    RI->>DB: Find registrar (tenant-owned only)
    alt not found or system default
        RI-->>Client: 404 Not Found
    end
    RI->>DB: Update registrar fields
    DB-->>RI: Updated record
    RI-->>Client: 200 OK (registrar)
```

---

### Delete a registrar

```
DELETE /api/v1/registrars/{id}
```

Permanently deletes a registrar and all of its associated identifier schemes and qualifier definitions (cascade). Only tenant-owned registrars can be deleted — system defaults are protected. If any of the registrar's schemes has identifiers attached, the identifier-to-scheme relationship is `onDelete: Restrict`, so that constraint blocks the whole cascade: the delete fails as a 409 and nothing is removed (not the registrar, not its schemes, not the identifiers).

```mermaid
sequenceDiagram
    participant Client
    participant RI as Reference Implementation
    participant DB as Database

    Client->>RI: DELETE /api/v1/registrars/{id}
    RI->>DB: Find registrar (tenant-owned only)
    alt not found or system default
        RI-->>Client: 404 Not Found
    end
    RI->>DB: Delete registrar (cascades to schemes)
    alt a scheme has identifiers (onDelete: Restrict blocks the cascade)
        DB-->>RI: Foreign key violation
        RI-->>Client: 409 Conflict (nothing deleted)
    end
    DB-->>RI: Deleted
    RI-->>Client: 204 No Content
```
