---
sidebar_position: 11
title: Credentials
---

# Credentials API

Credentials are the core output of the Reference Implementation. Everything else in the system — [DIDs](./dids), [services](./services), [data models](./data-models), [identifiers](./identifiers), and [master data](./organisations) — exists to support one goal: **issuing trusted, verifiable digital documents about products, facilities, organisations, and supply chain events**.

A credential is a digitally signed statement. A company issues a credential that says "this product was made sustainably" or "this facility passed a conformity assessment". Because the credential is cryptographically signed, anyone who receives it can verify that the statement hasn't been tampered with and that it really came from the company that claims to have issued it, without needing to contact the issuer directly.

The Credentials API has two sides:

- **Issuance** (authenticated) — a tenant creates a credential, the system validates it, signs it, stores it, and optionally publishes it so it can be discovered by resolving an identifier.
- **Verification** (public, no login required) — anyone with a link to a stored credential can check whether it's genuine, untampered, and still valid.

:::tip[Interactive API documentation]
The Reference Implementation includes a Swagger UI at [`/api-docs`](http://localhost:3003/api-docs) with full request/response schemas you can try directly from the browser. The endpoint descriptions below focus on behaviour and internal logic. Refer to Swagger for exact payload shapes. All endpoints except [Verify](#verify-a-credential) require authentication. See [Authentication](../authentication#obtaining-a-token) for how to obtain a Bearer token.
:::

## Concepts

### What's Inside a Credential?

Every credential issued by the Reference Implementation follows the [W3C Verifiable Credentials Data Model](https://www.w3.org/TR/vc-data-model-2.0/) and the [UNTP Verifiable Credential profile](https://untp.unece.org/docs/specification/VerifiableCredentials). In plain terms, a credential contains:

- **Who issued it** — the issuer's [DID](./dids) (a cryptographic identity)
- **What it says** — the credential subject (e.g., product sustainability data, conformity assessment results)
- **When it was issued** — a timestamp
- **A digital signature** — proof that the issuer really signed it and that nobody changed it afterwards
- **A credential status** — a mechanism for the issuer to revoke or suspend the credential later if needed (managed via [BitstringStatusList](https://www.w3.org/TR/vc-bitstring-status-list/) by the [VC service](../services/verifiable-credential-service))

### How Credentials Are Packaged

UNTP credentials use the [**enveloped** form](https://www.w3.org/TR/vc-data-model-2.0/#enveloped-verifiable-credentials): the credential payload is signed as a [JWT (JSON Web Token)](https://datatracker.ietf.org/doc/html/rfc7519), and the JWT is wrapped inside a [JSON-LD](https://www.w3.org/TR/json-ld11/) envelope. This means you get the best of both worlds — compact, efficient JWT signatures with the semantic richness of linked data.

When the Reference Implementation issues a credential, the result is an `EnvelopedVerifiableCredential` that looks like this:

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "type": "EnvelopedVerifiableCredential",
  "id": "data:application/vc+jwt,eyJhbGciOiJFZDI1NTE5..."
}
```

The `id` field contains the actual JWT. The verification endpoint knows how to unwrap this and decode the original credential payload.

### Credential Types

The type of credential determines what kind of data it contains and which schema is used to validate it. Credential types are defined by [data models](./data-models) — see the [Data Models API](./data-models) for the full list of core UNTP types and how extension data models work.

### Encryption and Privacy

When a credential is issued, two things are created: the **signed credential** (stored externally by the [storage service](./services)) and a **credential record** (stored in the Reference Implementation's database, tracking metadata like the storage URI, hash, and published status).

By default, the [storage service](./services) **encrypts** the signed credential before storing it, so the file at the storage URI is unreadable on its own. The storage service returns the decryption key once, when the credential is stored, and the Reference Implementation saves it on the credential record. Reading the record through this API includes that key, so it can be presented alongside the storage URI during [verification](#verify-a-credential).

This matters for privacy: a credential about a product's supply chain might contain commercially sensitive information. Encryption ensures that only someone with the key can read it, even if they have the storage URL.

| Setting | What Happens |
|---------|-------------|
| `encrypt: true` (default) | Credential encrypted before storage. A `decryptionKey` is returned. |
| `encrypt: false` | Credential stored in plaintext. Anyone with the URL can read it. |

### Integrity Hashing

Every stored credential has a **content hash** — a fingerprint computed from the credential's contents. If even one character changes, the hash changes. This allows anyone to detect that the credential at a storage URI hasn't been swapped or modified after being stored. During [verification](#verify-a-credential), the computed hash is compared against the expected hash.

### Discoverability via the Identity Resolver

A credential on its own is just a file at a URL. To make it useful, it needs to be **discoverable** — someone who knows a product's identifier should be able to find the credential. This is the role of the [UNTP Identity Resolver](https://untp.unece.org/docs/specification/IdentityResolver) and [Decentralised Access Control](https://untp.unece.org/docs/specification/DecentralisedAccessControl) specifications.

This is where the [Identity Resolver](./identifiers#links) comes in. When a credential is published, the Reference Implementation registers a link with the Identity Resolver that connects the entity's identifier (e.g., a GS1 GTIN) to the credential's storage URL. Now anyone who resolves that identifier can find the credential.

Publishing is optional and requires the credential's primary entity (product, facility, or organisation) to have a configured [identifier scheme](./identifiers#identifier-schemes) with an IDR service.

### CVC Compliance (Conformity Credentials Only)

For [Digital Conformity Credentials](./data-models), the issuance pipeline performs an extra advisory check: it compares the conformity scheme, profile, and criteria referenced in the credential against the locally known [Conformity Vocabulary Catalogue (CVC)](https://untp.unece.org/docs/specification/ConformityVocabularyCatalog) schemes. This helps catch mistakes like referencing a non-existent scheme or omitting a required criterion.

CVC validation is **advisory only** — it never blocks issuance. If issues are found, the credential is still issued but the response includes warnings.

### The Issuance Pipeline

Issuing a credential involves eight stages. Each stage can fail independently, and failures at different stages produce different HTTP status codes and warning codes. See the [Issue a Credential](#issue-a-credential) endpoint for the full request and response reference.

```mermaid
sequenceDiagram
    participant Client
    participant RI as Reference Implementation
    participant DB as Database
    participant VC as VC Service
    participant Storage as Storage Service
    participant IDR as Identity Resolver

    Client->>RI: POST /api/v1/credentials
    RI->>RI: 1. Validate request fields
    RI->>DB: 2. Resolve data model + bridge
    DB-->>RI: Data model config + schema URLs
    RI->>RI: 3. Validate payload (JSON Schema + JSON-LD)
    RI->>RI: 3.5. CVC validation (advisory, DCC only)
    RI->>DB: 4. Validate issuer DID ownership
    DB-->>RI: DID record (tenant-owned or system default)
    RI->>RI: 5. Validate DID has service association
    RI->>DB: 6. Resolve services (VC from DID, storage + IDR by tenant)
    DB-->>RI: Decrypted service configs
    RI->>VC: 7a. Issue credential status
    VC-->>RI: Credential status (BitstringStatusList entry)
    RI->>VC: 7b. Sign credential (with status)
    VC-->>RI: Enveloped verifiable credential
    RI->>Storage: 7c. Store credential (optional encryption)
    Storage-->>RI: Storage URI + hash + decryption key
    RI->>DB: 7d. Resolve primary entity from refs
    RI->>DB: 7e. Save credential record
    DB-->>RI: Credential ID
    opt publish = true
        RI->>IDR: 8. Publish links for primary identifier
        IDR-->>RI: Link registration
        RI->>DB: Update isPublished = true
    end
    RI-->>Client: 201 { credentialId, warnings? }
```

#### Stage 1: Request Validation

The three required fields are validated:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentialPayload` | object | Yes | The full credential payload conforming to the UNTP schema for the specified type and version |
| `credentialType` | string | Yes | Must match a registered [data model](./data-models) (e.g., `DigitalProductPassport`) |
| `version` | string | Yes | Must match a registered data model version (e.g., `0.6.1`) |

#### Stage 2: Data Model Resolution

The `credentialType` and `version` are used to look up a registered [data model](./data-models). The data model provides the JSON Schema URL(s) for validation, the JSON-LD context URL, and the [bridge](./data-models#data-model-bridges) that extracts entity references from the payload.

For [extension data models](./data-models#extension-data-models), both the parent schema and the extension schema are validated.

#### Stage 3: Payload Validation

The credential payload is validated in two passes:

1. **JSON Schema validation** against the data model's schema URL(s). This catches structural issues such as missing required fields, incorrect types, or invalid enum values.
2. **JSON-LD expansion** to verify the payload is valid linked data with a resolvable `@context`.

If either check fails, the request is rejected with HTTP 400, the error message says why, and a `code` field distinguishes the two things that can go wrong at each pass. `SCHEMA_DOCUMENT_INVALID` and `JSONLD_DOCUMENT_INVALID` mean the payload itself is invalid; the message carries the detail to fix, such as the missing property or the undefined term. `SCHEMA_FETCH_FAILED` and `JSONLD_CONTEXT_FETCH_FAILED` mean a remote schema or `@context` document could not be fetched or used. The schema message names the schema URL; the context message carries the HTTP status or timeout where one applies, and collapses to a general message when the URL itself was rejected. A document failure is fixed by correcting the payload; a fetch failure usually reflects an upstream or network condition rather than a problem with the credential.

#### Stage 3.5: CVC Compliance Validation (Advisory)

For [Digital Conformity Credentials](./data-models) (DCC), the issuance pipeline performs an advisory check against the locally known conformity schemes (operator-seeded in this release). This check verifies that the conformity scheme, profile, and criteria referenced in the credential payload correspond to entries in the catalogue, and that the claimed criteria line up with what the profile defines.

CVC validation is advisory only. It never blocks issuance. If the check fails or no matching scheme is available, the credential is issued with warnings in the response. Warning codes include:

| Code | Meaning |
|------|---------|
| `conformity-scheme.not-found` | A referenced conformity scheme URI is not in the locally known catalogue |
| `conformity-profile.not-found` | A referenced profile URI is not found within the scheme |
| `conformity-profile.not-specified` | The claim references no profile, so criterion and topic checks were not performed (criteria are published per versioned profile) |
| `conformity-criterion.not-in-profile` | A claimed criterion is not one the referenced profile publishes |
| `conformity-criterion.missing` | A criterion the profile defines is absent from the claim |
| `conformity-criterion.topic-mismatch` | A criterion's declared conformity topics do not match those the criterion defines |
| `conformity-assessment.topic-mismatch` | An assessment declares a conformity topic that none of its assessed criteria define |
| `conformity-claim.validation-error` | Validation could not be performed (extraction or infrastructure failure) |

Criterion and topic warnings name the versioned profile URI they were checked against in their message, since profile URIs carry a version segment and the same criterion can differ between profile versions.

The assessment-level topic check runs only when the assessment references at least one criterion and every referenced criterion resolves in the profile. An assessment that references no criteria is not warned, because its own `conformityTopic` is then the claim's only classification (the intended modelling when, for example, a scheme publishes no digital vocabulary of criteria); an unresolved criterion is reported as `conformity-criterion.not-in-profile` instead of producing a topic verdict from incomplete evidence.

#### Stage 4: Issuer DID Ownership Validation

The `issuer.id` field in the credential payload must contain a [DID](./dids) that the authenticated tenant is authorised to use. The Reference Implementation looks up the DID and verifies that it either:

- belongs to the authenticated tenant, or
- is a [system default DID](./dids#system-dids-vs-tenant-dids) — available to all tenants as part of the [incremental adoption ramp](../overview#incremental-adoption)

**If the DID is not registered to the tenant and is not a system default DID, the request is rejected with HTTP 400.** A tenant cannot issue credentials using a DID that belongs to another tenant.

#### Stage 5: DID Service Association Check

The issuer DID must have an associated [VC service instance](./services) — this is the service that holds the DID's key material and will perform signing. If the DID has no association (e.g., the service instance was [force-deleted](./services#delete-a-service-instance)), the request is rejected with HTTP 400. The DID must be re-imported or re-created to restore the association.

#### Stage 6: Service Resolution

The **VC service** is resolved from the issuer DID's associated service instance. This ensures signing always happens on the VC service that holds the DID's key material, regardless of whether the DID is a tenant-owned DID or a [system default DID](./dids#system-dids-vs-tenant-dids). The caller does not need to specify which VC service to use; the DID determines it.

The **storage service** and **IDR service** follow the standard [resolution chain](../services/service-architecture#system-services-vs-tenant-services):

| Service | Purpose | How Resolved |
|---------|---------|-------------|
| **VC Service** | Signs the credential payload | From the issuer DID's associated service instance |
| **Storage Service** | Stores the signed credential | `storageOptions.serviceInstanceId`, or tenant primary, or system default |
| **IDR Service** | Publishes links (only when `publish: true`) | From the entity's scheme configuration |

#### Stage 7: Sign, Store, and Record

The credential payload is signed by the VC service, producing an [Enveloped Verifiable Credential](https://www.w3.org/TR/vc-data-model-2.0/#enveloped-verifiable-credentials). The signed credential is then stored by the storage service.

**Encryption**: By default, the stored credential is encrypted with AES-GCM. The decryption key is returned in the credential record and must be provided when [verifying](#verify-a-credential) encrypted credentials. Set `storageOptions.encrypt` to `false` to store the credential unencrypted.

**Entity linking**: The data model bridge extracts entity references (organisations, facilities, products) from the credential payload. The primary entity (priority: product > facility > organisation) is linked to the credential record in the database. This link enables the optional publishing step.

#### Stage 8: IDR Publishing (Optional)

When `publishingOptions.publish` is `true`, the Reference Implementation publishes a link to the stored credential on the [Identity Resolver](./identifiers#links) for the primary entity's identifier. This makes the credential discoverable via the entity's identifier scheme (e.g., resolving a GS1 GTIN leads to the credential).

Publishing requires the primary entity to have:
- A primary identifier with a configured [identifier scheme](./identifiers#identifier-schemes)
- The scheme must have a registrar with a namespace
- An IDR service instance (configured on the scheme, or the tenant/system default)

If any of these are missing, publishing is silently skipped and a `PUBLISH_SKIPPED` warning is included in the response. Three further publishing-related warnings can appear on a 201: `REFS_EXTRACTION_FAILED` (the payload's entity references could not be extracted, so publishing was skipped), `IDR_PUBLISH_FAILED` (the Identity Resolver rejected or failed the publish; the credential is stored but not discoverable), and `DB_STATUS_UPDATE_FAILED` (the publish succeeded but recording the published status failed, so the credential record may show unpublished).

The IDR entry's `description` field is taken from the primary entity's `description`, falling back to the entity's `name` if no description is set.

**Human verification link**: When publishing without an explicit `humanVerificationUrl`, the published link set includes a link to this Reference Implementation's own verify page. The base is derived from the `RI_APP_URL` environment variable, which is parsed as a URL with `/verify` appended to its path (any query or fragment is dropped, a base path is preserved, and a trailing slash is trimmed); for the default `http://localhost:3003` the link is `http://localhost:3003/verify`. `RI_APP_URL` is configured in the RI's environment (the shipped `.env.example` and Docker Compose files default it to `http://localhost:3003`) and is the same base URL that backs the OIDC post-logout redirect (see [Identity provider requirements](../authentication/idp-requirements)). Supplying `humanVerificationUrl` overrides the default, for deployments that host verification elsewhere.

The published link does **not** carry the credential's decryption key. The key is not registered on the Identity Resolver; it is shared out of band, so access to an encrypted credential does not travel with its discovery link (regardless of whether a given resolver is publicly readable). A credential stored encrypted (the storage default) therefore needs its decryption key supplied out of band to verify, and the published link alone verifies a credential stored unencrypted. The issuing tenant can retrieve that decryption key from the credential's [Get a Credential](#get-a-credential) response and share it through a channel of its choosing. This differs from a link shared directly as a single-link capability, which may embed the key (see [the verify page](../verify-page#decryption)).

`RI_APP_URL` is validated when the application starts (see [Startup](../operations/startup#base-url-validation)), so a deployment that could not build a safe default link fails at boot rather than at request time. Omitting `humanVerificationUrl` is always a valid request; supplying it overrides the default for deployments that host verification elsewhere.

| Publishing Option | Type | Description |
|-------------------|------|-------------|
| `publish` | boolean | Whether to publish to the identity resolver |
| `linkType` | string | Link relation type (defaults to the IDR service's configured default link type) |
| `linkTitle` | string | Human-readable title for the link (defaults to the data model name) |
| `qualifierPath` | string | Qualifier path for sub-identifiers, e.g., `/10/LOT123/21/SER456` (defaults to `/`) |
| `machineVerificationUrl` | string | URL for machine-readable verification of the credential. Must be a well-formed HTTP(S) URL without embedded credentials |
| `humanVerificationUrl` | string | URL for human-readable verification of the credential (defaults to `${RI_APP_URL}/verify`, this RI's verify page, when publishing). Must be a well-formed HTTP(S) URL without embedded credentials |
| `hreflang` | string[] | Well-formed BCP 47 language tags for the link's target content |
| `additionalRels` | string[] | Additional link relation types to attach beyond `linkType` |
| `public` | boolean | Whether the published link is publicly resolvable |
| `accessRole` | string[] | UNTP access roles allowed to retrieve the published links, from the [UNTP access role vocabulary](https://untp.unece.org/docs/specification/DecentralisedAccessControl) (e.g. `untp:accessRole#Regulator`); attached to the credential and human verification links |

## Issuance Endpoints

### Issue a Credential

```
POST /api/v1/credentials
```

Validates, signs, stores, and optionally publishes a verifiable credential. Returns the credential's database ID and any advisory warnings.

**Request body fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentialPayload` | object | Yes | Full credential payload conforming to the UNTP schema for the specified type and version |
| `credentialType` | string | Yes | Registered data model type (e.g., `DigitalProductPassport`) |
| `version` | string | Yes | Registered data model version (e.g., `0.6.1`) |
| `storageOptions.serviceInstanceId` | string | No | Explicit storage service instance |
| `storageOptions.encrypt` | boolean | No | Whether to encrypt (default: `true`) |
| `publishingOptions.publish` | boolean | No | Whether to publish to IDR |
| `publishingOptions.linkType` | string | No | Link relation type |
| `publishingOptions.linkTitle` | string | No | Link title (defaults to data model name) |
| `publishingOptions.qualifierPath` | string | No | Qualifier path (default: `/`) |
| `publishingOptions.machineVerificationUrl` | string | No | Machine verification URL |
| `publishingOptions.humanVerificationUrl` | string | No | Human verification URL (defaults to `${RI_APP_URL}/verify` when publishing) |
| `publishingOptions.hreflang` | string[] | No | BCP 47 language tags for the link's target content |
| `publishingOptions.additionalRels` | string[] | No | Additional link relation types beyond `linkType` |
| `publishingOptions.public` | boolean | No | Whether the published link is publicly resolvable |
| `publishingOptions.accessRole` | string[] | No | UNTP access roles governing who the published links are surfaced to (e.g. `untp:accessRole#Regulator`) |

Every field is shape-checked at the boundary: a missing or mistyped field is rejected with a 400 that names it, and unknown fields are ignored. The verification URLs must be well-formed HTTP(S) URLs without embedded credentials, `hreflang` entries must be well-formed [BCP 47](https://www.rfc-editor.org/rfc/rfc5646.html) language tags, and `linkType` must not be blank. Passing `null` for `storageOptions` or `publishingOptions` is rejected; omit them instead.

---

### List Credentials

```
GET /api/v1/credentials
```

Returns a paginated list of credentials for the authenticated tenant.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `credentialType` | string | none | Filter by credential type (case-sensitive exact match) |
| `isPublished` | `"true"` or `"false"` | none | Filter by published status |
| `limit` | integer | Defaults to 20, or the [configured maximum](../operations/api-pagination#maximum-page-size) when it is lower | A value above the maximum is rejected with a 400 that names the maximum |
| `offset` | integer | `0` | Number of results to skip |

Pagination values must be plain decimal integers, and a repeated query parameter is rejected with a 400.

---

### Get a Credential

```
GET /api/v1/credentials/{id}
```

Retrieves a specific credential record by its database ID. The response includes the storage URI, hash, decryption key (if encrypted), credential type, published status, and linked entity IDs.

## Verification Endpoint

### Verify a Credential

```
POST /api/v1/credentials/verify
```

**This endpoint does not require authentication.** It is designed for third-party verification of credentials using parameters typically encoded in a QR code or [verification link](../verify-page#verify-link).

```mermaid
sequenceDiagram
    participant Client
    participant RI as Reference Implementation
    participant Storage as Storage URI
    participant VC as System VC Service

    Client->>RI: POST /api/v1/credentials/verify { uri, digestMultibase?, hash?, decryptionKey? }
    RI->>RI: Validate input
    RI->>Storage: Guarded fetch (SSRF check per redirect hop, 10s timeout)
    Storage-->>RI: Credential (possibly encrypted)
    opt encrypted
        RI->>RI: Check envelope structure, decrypt with decryptionKey
    end
    opt digest provided
        RI->>RI: Compute digest and compare
    end
    RI->>RI: Validate credential type (EnvelopedVerifiableCredential)
    RI->>VC: Verify credential signature
    VC-->>RI: Verification result
    RI->>RI: Decode JWT payload
    RI-->>Client: 200 { verified, credential, decodedCredential?, warnings?, error? }
```

**Request body fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uri` | string (URL) | Yes | Storage URI where the credential is stored. Must be HTTP(S) without embedded userinfo credentials. |
| `digestMultibase` | string | No | Expected multibase-encoded digest of the credential content. If provided, the fetched credential's digest is verified against it. |
| `hash` | string | No | Expected SHA-256 hash (64-character hex string), accepted for links created before [the digest migration](../../migration-guides/v0.7.0#dependent-service-updates). Prefer `digestMultibase`. |
| `decryptionKey` | string | No | AES-GCM decryption key (64-character hex string). Required for encrypted credentials. |

The endpoint always returns HTTP 200 for a completed verification attempt, even if the credential fails verification. Check the `verified` field for the outcome. Processing errors that prevent a verification attempt return 422 with a `code` field:

| Code | Meaning |
|------|---------|
| `INVALID_RESPONSE` | The storage URI's response is not valid JSON, or is valid JSON that is not an object (a literal `null`, an array, or a primitive), before or after decryption. |
| `DECRYPTION_REQUIRED` | The credential is encrypted and no `decryptionKey` was supplied. The [verify page](../verify-page#decryption) prompts for the key in this case. |
| `ENVELOPE_INVALID` | The stored encrypted envelope is structurally corrupted (wrong IV or auth-tag length). Re-supplying the key will not help. |
| `DECRYPTION_FAILED` | The decryption key does not match the credential. This is almost always a wrong key, but AES-GCM cannot distinguish a wrong key from ciphertext tampered at valid lengths. |
| `DECRYPTED_NOT_JSON` | Decryption succeeded but the content is not valid JSON, so the stored credential is corrupted. |
| `DIGEST_MISMATCH` | The fetched credential does not match the digest in the request. |
| `UNSUPPORTED_CREDENTIAL_TYPE` | The credential is not an `EnvelopedVerifiableCredential`. |

Upstream failures (storage unreachable, non-2xx, oversized response, VC service failure) return 502 with `UPSTREAM_ERROR` or `VC_SERVICE_ERROR`.

The storage URI is fetched through a guarded resolver that validates the hostname against private and reserved ranges on every redirect hop and pins the connection to the validated address, so neither a redirect nor a DNS change between check and connect can reach a private network.

Decryption happens on the server, so a `decryptionKey` travels in the request body. Production deployments must serve this endpoint over HTTPS so the key is protected in transit.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VERIFY_ALLOW_PRIVATE_URLS` | `false` | Set to `true` to bypass SSRF checks (development only) |
| `VERIFY_MAX_CREDENTIAL_SIZE` | `10485760` (10 MB) | Maximum credential response size in bytes |
