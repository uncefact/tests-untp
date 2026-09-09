---
sidebar_position: 8
title: Library
---

# Library API

The library holds every credential a tenant has, whether the tenant issued it through this Reference Implementation or received it from someone else. A record for a credential the tenant issued is a **native** record. A record for a credential received from a third party is an **external** record: the tenant gives the credential's location, the Reference Implementation fetches it, checks it, and keeps its own copy, so the credential is still available if the supplier later takes it offline.

This page covers listing the library, fetching several records by id, registering an external credential, retrieving one record, updating its recipient annotations and re-verifying a record. Deleting a record is a separate operation that arrives with the rest of the library epic.

:::tip[Interactive API documentation]
The Swagger UI at [`/api-docs`](http://localhost:3003/api-docs) carries the exact request and response schemas for the operations on this page. This page explains the behaviour, and Swagger carries the payload shapes. Every library endpoint requires authentication. See [Authentication](../authentication#obtaining-a-token) for how to obtain a Bearer token.
:::

## Concepts

### What registration does

A register call takes a URL and does most of its work before it answers. It fetches the credential through the same guarded fetch the [verify endpoint](./credentials#verify-a-credential) uses, so a private or reserved network address is refused. If the body is an encrypted envelope and the caller supplied a key, it opens the envelope with that key. It reads the credential's descriptive fields (name, issuer, subject, validity window) from the signed artefact. It stores a durable copy with the tenant's [storage service](./services), encrypted by that service, and keeps the key the service returns. Then it writes the record and answers `201`.

What is left for later runs in the background, on the worker process. The worker reads the durable copy back from storage, checks it against the digest recorded when it was stored, and only then asks the [verifiable credential service](../services/verifiable-credential-service) to check the signature and status. A copy that cannot be read back as the document that was stored settles the generation as `STORED_COPY_UNAVAILABLE`, a copy that reads back but does not match its digest settles it as `STORED_COPY_CORRUPT`, and in both cases the verifier is never asked. The record's `verification` envelope moves from `pending` to `complete` or `failed` when the worker finishes. A deployment with no worker process running leaves records `pending` until one starts. Where a worker is running and a generation has not settled within the sweep's bound, its reconciliation sweep settles that generation as `VERIFICATION_UNAVAILABLE`. The bound is a policy of at least 30 minutes, not proof the job is gone, and the sweep does not re-enqueue the job. The Compose stack runs one as `ri-worker` (see [Worker Boot](../operations/startup#worker-boot)). Re-poll `GET /api/v1/library/{id}` to read the settled state.

The fetch follows redirects. The record keeps the URL the caller supplied, in its canonical form, as `sourceUrl`; the bytes are whatever the final location returned.

### The verification envelope

Every record carries a `verification` object describing its newest verification generation. It has one of three states.

| `state`    | Meaning                                                                                                                                                                                    | `summary`                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `pending`  | The in-request work finished and the background signature check has not. With a worker running, a generation that has not settled within the sweep's bound is settled by the worker sweep. | `pending`                      |
| `complete` | The checks reached a conclusion.                                                                                                                                                           | `verified` or `not_conformant` |
| `failed`   | Something stopped the checks from reaching a conclusion; `failure` says what and whether to retry.                                                                                         | `failed`                       |

The `checks` object always lists seven checks (`retrieval`, `decryption`, `digest`, `proof`, `status`, `temporal`, `schemaConformance`), each `pass`, `fail` or `not_run`. The summary of a `complete` generation is derived from those published checks. Any failed blocking check makes it `not_conformant`. Otherwise it is `verified`, as long as at least one check ran. A generation where nothing ran is `not_conformant`. The blocking checks are `retrieval`, `decryption`, `digest`, `proof` and `status`. `temporal` is recorded as evidence and does not block, so a genuine credential that has expired is still `verified`. Its currency is reported separately in `currencyStatus`. `schemaConformance` is advisory.

Every generation of an external record is an executed check. A native record's generation 1 is an issuance assertion instead, described under [Retrieve one library record](#retrieve-one-library-record). A re-verification generation records the worker's actual acquisition, custody and verification results. For a native record, every response projects those acquisition and custody checks as `not_run`, whichever route returned it, because they describe acquiring a credential from someone else. The executed proof, status, temporal and `schemaConformance` results stay visible.

Re-verification also checks the supplier source against a stored `sourceDigest`, for an external record with a protected durable copy and, when one exists, for an external record recovering a missing one. A settled generation includes `sourceChanged` and `lastSourceCheckAt` when that comparison was attempted. `sourceChanged` is `false` when the source is unchanged, `true` when it differs and `null` when the source could not be checked. These fields are absent from a pending envelope.

### What each outcome looks like

The table below is the register call's branch matrix. Every row that creates a record answers `201` with the record; the rows that create nothing answer with the error shown.

| What happened                                                                                                                   | Answer | Record | Durable copy                                             | `verification`                                                                                                                                                                                                                              | `encrypted` / `hasKey` |
| ------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| The URL is malformed, not http(s), or points at a private address                                                               | `400`  | no     | no                                                       | none                                                                                                                                                                                                                                        | none                   |
| The source could not be reached (DNS, timeout, 408, 429, 500, 502, 503, 504)                                                    | `201`  | yes    | no                                                       | `failed`, `RETRIEVAL_FAILED`, `retryable: true`                                                                                                                                                                                             | `null` / `false`       |
| The source refused (any other status, too many redirects, too large)                                                            | `201`  | yes    | no                                                       | `failed`, `RETRIEVAL_FAILED`, `retryable: false`                                                                                                                                                                                            | `null` / `false`       |
| The source is encrypted and no key was supplied                                                                                 | `201`  | yes    | the ciphertext, exactly as fetched                       | `failed`, `DECRYPTION_REQUIRED`, `retryable: true`                                                                                                                                                                                          | `true` / `false`       |
| The source is encrypted and the key did not open it                                                                             | `201`  | yes    | the ciphertext, exactly as fetched                       | `failed`, `DECRYPTION_FAILED`, `retryable: true`                                                                                                                                                                                            | `true` / `false`       |
| The source is encrypted and its envelope is corrupt, so no key can open it                                                      | `201`  | yes    | the ciphertext, exactly as fetched                       | `failed`, `DECRYPTION_FAILED`, `retryable: false`                                                                                                                                                                                           | `true` / `false`       |
| The opened signed credential is already registered as an external record in this tenant                                         | `409`  | no     | none created by the rejection, but see the note below    | none                                                                                                                                                                                                                                        | none                   |
| The copy could not be written to storage (for an unopened ciphertext too, in which case the message also names the key problem) | `201`  | yes    | no                                                       | `failed`, `STORAGE_FAILED`, `retryable: true`                                                                                                                                                                                               | observed / `false`     |
| Fetched, opened if needed, extracted and stored                                                                                 | `201`  | yes    | yes                                                      | `pending`, then `complete` once the signature check settles                                                                                                                                                                                 | observed / `true`      |
| Fetched, but the body is not a signed credential                                                                                | `201`  | yes    | the body as fetched, encrypted by this service's storage | `pending`, then `complete` with `summary: not_conformant`                                                                                                                                                                                   | observed / `true`      |
| The signature check itself could not run                                                                                        | later  | yes    | yes                                                      | `pending`, then `failed`, `VERIFICATION_UNAVAILABLE`, `retryable: true`                                                                                                                                                                     | observed / `true`      |
| The stored copy could not be read back, or did not match its digest                                                             | later  | yes    | yes                                                      | `pending`, then `failed`: `STORED_COPY_UNAVAILABLE` with `retryable: false` when the copy is absent and `true` when storage was unreachable, or `STORED_COPY_CORRUPT` with `retryable: false` when it read back but failed its digest check | observed / `true`      |

The `409` row creates no durable copy of its own. A request that loses a race to another registration of the same credential may already have stored one before the database refused its record, which the register section describes under duplicate detection.

`retryable: false` means the same request, unchanged, will not succeed unless the source itself changes. `retryable: true` means a later attempt may succeed, whether unchanged (an outage cleared) or after a correction (the right key). It is a classification of what was observed, never a promise about the source.

### Encrypted sources

A supplier may publish a credential encrypted. Register accepts the key in `sourceEncryption.decryptionKey`. The key is used to open the fetched body for this one request and is then forgotten: it is never stored, never logged, never placed on the job queue and never returned. Serve this endpoint over HTTPS so the key is protected in transit.

When no key is supplied, or the key does not work, the Reference Implementation still keeps the credential. It stores the ciphertext exactly as fetched, with no key of its own, and the record says so: `encrypted: true`, `hasKey: false`, and a `failed` generation naming `DECRYPTION_REQUIRED` or `DECRYPTION_FAILED`. Re-verifying such a record is refused with `400 DECRYPTION_REQUIRED`, because that operation takes no body and this service holds no key that opens the copy. That refusal turns on the stored copy, not on the `encrypted` flag. A record whose copy was never written, because storage was unavailable at the time, is re-verified normally. It fetches its source again, and what that fetch returns decides the outcome, as [Re-verify a library record](#re-verify-a-library-record) describes. Supplying a key against a stored copy is tracked by [uncefact/tests-untp#958](https://github.com/uncefact/tests-untp/issues/958).

Most credentials are published in plain text and need no key at all; that is the ordinary case and it needs nothing extra. One odd combination is worth knowing about: if a caller sends a key and the fetched body turns out not to be encrypted, the call still succeeds. The key is simply not used, and the record carries a `DECRYPTION_KEY_UNUSED` warning so the caller can see it was never applied.

### Descriptive fields

`credential.name`, `credential.issuerName`, `credential.issuerDid`, `credential.subjectName`, `credential.subjectId`, `credential.validFrom` and `credential.validUntil` are read from the signed artefact the moment it is in hand, on the same terms as a credential this Reference Implementation issues. `detailsStatus` says whether that read has happened: `EXTRACTED` once it ran (so a `null` field is a real absence), `EXTRACTION_PENDING` while the artefact has not been reached (a failed fetch, an unopened ciphertext), `EXTRACTION_FAILED` when it was reached and could not be read, with `detailsError` saying why. `credential.credentialType` is the core UNTP type the artefact names; when it disagrees with the `declaredCredentialType` the caller supplied, the record carries a `DECLARED_TYPE_MISMATCH` warning rather than failing.

## List and search the library

```
GET /api/v1/library
```

This returns both native and external records in the standard paginated envelope. v1 has no supersession or versioning filter, so a record is returned whenever it matches the filters supplied, including one a later credential functionally replaces.

```json
{
  "data": [
    {
      "id": "cred_ext_05",
      "origin": "external",
      "credential": {
        "name": "Cobalt Shipment DFR",
        "credentialType": "DFR",
        "issuerName": "Cobalt Traders Ltd",
        "issuerDid": "did:web:cobalt-traders.example",
        "subjectName": "Cobalt shipment CB-2201",
        "subjectId": "https://cobalt-traders.example/shipments/CB-2201",
        "validFrom": "2026-07-20T10:00:00Z",
        "validUntil": null
      },
      "annotations": {
        "annotationVersion": 1,
        "displayName": "Cobalt shipment DFR",
        "declaredCredentialType": "DFR",
        "dateReceived": "2026-07-30",
        "notes": ""
      },
      "organisationId": null,
      "facilityId": null,
      "productId": null,
      "sourceUrl": "https://supplier.example/credential-d",
      "sourceDigest": "zQm-cobalt-digest",
      "resolverUri": null,
      "issuedAt": "2026-07-20T10:00:00Z",
      "encrypted": false,
      "hasKey": true,
      "verification": {
        "generation": 1,
        "state": "complete",
        "requestedAt": "2026-07-30T09:00:00Z",
        "completedAt": "2026-07-30T09:00:06Z",
        "checks": {
          "retrieval": "pass",
          "decryption": "not_run",
          "digest": "pass",
          "proof": "pass",
          "status": "pass",
          "temporal": "pass",
          "schemaConformance": "pass"
        },
        "summary": "verified"
      },
      "currencyStatus": "current",
      "detailsStatus": "EXTRACTED",
      "detailsError": null,
      "capabilities": { "deletable": true, "annotatable": true, "verifiable": true },
      "warnings": [],
      "createdAt": "2026-07-30T09:00:00Z",
      "updatedAt": "2026-07-30T09:00:06Z"
    },
    {
      "id": "cjld2cyuq0000qzrmf1w70eq3",
      "origin": "native",
      "credential": {
        "name": "Battery Pack DPP",
        "credentialType": "DPP",
        "issuerName": "Acme Battery Co",
        "issuerDid": "did:web:acme.example",
        "subjectName": "Battery Pack Model X",
        "subjectId": "https://acme.example/products/battery-x",
        "validFrom": "2026-07-15T09:00:00Z",
        "validUntil": "2029-07-15T09:00:00Z"
      },
      "annotations": null,
      "organisationId": "cjld2cyuq0001qzrmf1w70eq4",
      "facilityId": "cjld2cyuq0002qzrmf1w70eq5",
      "productId": "cjld2cyuq0003qzrmf1w70eq6",
      "sourceUrl": null,
      "sourceDigest": null,
      "resolverUri": null,
      "issuedAt": "2026-07-15T09:00:00Z",
      "encrypted": true,
      "hasKey": true,
      "verification": {
        "generation": 1,
        "state": "complete",
        "requestedAt": "2026-07-15T09:00:00Z",
        "completedAt": "2026-07-15T09:00:00Z",
        "checks": {
          "retrieval": "not_run",
          "decryption": "not_run",
          "digest": "not_run",
          "proof": "pass",
          "status": "not_run",
          "temporal": "not_run",
          "schemaConformance": "not_run"
        },
        "summary": "verified"
      },
      "currencyStatus": "current",
      "detailsStatus": "EXTRACTED",
      "detailsError": null,
      "capabilities": { "deletable": false, "annotatable": false, "verifiable": true },
      "warnings": [],
      "createdAt": "2026-07-15T09:00:00Z",
      "updatedAt": "2026-07-15T09:00:00Z"
    }
  ],
  "pagination": { "total": 2, "limit": 20, "offset": 0, "hasMore": false }
}
```

List rows are keyless for both origins. They also omit `storageUri` and `digestMultibase`. Use [Retrieve one library record](#retrieve-one-library-record) when a durable-copy location or receiver-side key is required. The response is sent with `Cache-Control: no-store`.

The route accepts these filters. All supplied filters are combined with `AND`, and a value that matches no record returns an empty page rather than an error.

| Parameter                                   | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                                      | Repeatable OR filter, for example `?type=DPP&type=DFR`. When `credential.credentialType` is present, it is the only authority. When it is null, the external record's `annotations.declaredCredentialType` is used. The two values are never OR-matched for one record. The declared-type fallback is external-only, so a native record with a null recorded core type matches no `type` value. Rows that predate descriptive-field capture take that type from the [credential details backfill](../operations/backfills/credential-details) when their types name a core kind; a row whose types do not stays without one. |
| `origin`                                    | `native` or `external`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `organisationId`, `facilityId`, `productId` | Exact non-blank ids for native master-data associations. External records never match these filters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `issuer`                                    | Exact non-blank issuer name, case-insensitively, or exact issuer DID. It is not a substring or fuzzy match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `encrypted`                                 | Exact boolean match. For external records, an unobserved `null` encryption value matches neither `true` nor `false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `status`                                    | The derived verification summary: `pending`, `verified`, `not_conformant` or `failed`. Native generation 1 with no stored run is `verified`. Native acquisition and custody checks are masked before the summary is derived.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `issuedFrom`, `issuedTo`                    | Inclusive UTC calendar-day bounds over the effective date used for sorting: the credential's `validFrom`, falling back to `createdAt` when it is null. `issuedFrom` starts at `00:00:00.000Z` and `issuedTo` ends at `23:59:59.999Z`. A reversed range is a `400` validation error. The response's `issuedAt` remains `validFrom` and stays null when that is null.                                                                                                                                                                                                                                                          |
| `sort`                                      | `issuedAt:asc`, `issuedAt:desc`, `createdAt:asc` or `createdAt:desc`. The default is `issuedAt:desc`. Every order uses `id` ascending as its tie-breaker. A page is a snapshot of its own request only, so a record registered between two fetches, or a backfill that changes a legacy row's effective date, can move a row between offset pages, repeat it or skip it.                                                                                                                                                                                                                                                     |
| `limit`, `offset`                           | Positive page size and non-negative skip. A `limit` above the deployment maximum returns `400 PAGE_LIMIT_EXCEEDED` naming that maximum. It is never silently clamped.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

The `q` parameter is documented for the future free-text search lane, but is deliberately not implemented in v1. Any presence of `q`, including `?q`, `?q=` or a repeated value, returns `400 FREE_TEXT_SEARCH_DEFERRED` rather than an unfiltered result. Unknown query keys are ignored according to the API's request parsing convention. `type` is the only key that may be supplied more than once, and any other repeated key returns a `400` naming it. A NUL byte in an issuer or association filter returns an empty page after validation so it cannot reach the database as invalid text.

## Fetch several library records by id

```
POST /api/v1/library/batch-get
```

```json
{
  "ids": ["record-external-1", "record-native-1", "record-external-1"]
}
```

Use this endpoint when a caller already knows the record ids it needs. The request must contain a non-empty `ids` array of non-empty strings. Unknown body fields are ignored. Request validation runs before the submitted-id limit, so a malformed element is reported as a validation error even when the same request also exceeds the limit.

The maximum counts ids as submitted, before duplicate removal. It defaults to `500`, or the [configured maximum](../operations/api-pagination#maximum-page-size) where a deployment sets one. A request above the effective maximum returns `400 BATCH_GET_LIMIT_EXCEEDED` naming that maximum. The request is rejected rather than truncated, and duplicate ids still count towards the limit. A NUL-bearing id passes the string validation but is omitted before the database read. If every id is omitted this way, the response is an empty result.

Exact duplicate ids are read once. The response has one row per matching id, in the order each id first appeared in the request. Missing ids and ids owned by another tenant are omitted without revealing which case occurred. Native and external records can be returned together.

The response is always the keyless `CredentialRecord` shape. It does not include `tenantId`, `storageUri`, `digestMultibase` or `decryptionKey`. Use [Retrieve one library record](#retrieve-one-library-record) for the durable-copy location or receiver-side key. Every successful response, including an empty result, carries `Cache-Control: no-store`.

```json
{
  "data": [
    {
      "id": "record-external-1",
      "origin": "external",
      "credential": {
        "name": "Example credential",
        "credentialType": "DPP",
        "issuerName": "Example issuer",
        "issuerDid": "did:web:issuer.example",
        "subjectName": "Example subject",
        "subjectId": "https://issuer.example/subject-1",
        "validFrom": "2026-07-20T10:00:00Z",
        "validUntil": null
      },
      "annotations": {
        "annotationVersion": 1,
        "displayName": "Example credential",
        "declaredCredentialType": "DPP",
        "dateReceived": "2026-07-30",
        "notes": null
      },
      "organisationId": null,
      "facilityId": null,
      "productId": null,
      "sourceUrl": "https://issuer.example/credentials/1",
      "sourceDigest": "zQmExampleSourceDigest",
      "resolverUri": null,
      "issuedAt": "2026-07-20T10:00:00Z",
      "encrypted": false,
      "hasKey": true,
      "verification": {
        "generation": 1,
        "state": "complete",
        "requestedAt": "2026-07-30T09:00:00Z",
        "completedAt": "2026-07-30T09:00:06Z",
        "checks": {
          "retrieval": "pass",
          "decryption": "not_run",
          "digest": "pass",
          "proof": "pass",
          "status": "pass",
          "temporal": "pass",
          "schemaConformance": "pass"
        },
        "summary": "verified"
      },
      "currencyStatus": "current",
      "detailsStatus": "EXTRACTED",
      "detailsError": null,
      "capabilities": { "deletable": true, "annotatable": true, "verifiable": true },
      "warnings": [],
      "createdAt": "2026-07-30T09:00:00Z",
      "updatedAt": "2026-07-30T09:00:06Z"
    },
    {
      "id": "record-native-1",
      "origin": "native",
      "credential": {
        "name": "Native example",
        "credentialType": "DCC",
        "issuerName": "Example issuer",
        "issuerDid": "did:web:issuer.example",
        "subjectName": "Native subject",
        "subjectId": "https://issuer.example/subject-2",
        "validFrom": "2026-07-15T09:00:00Z",
        "validUntil": null
      },
      "annotations": null,
      "organisationId": null,
      "facilityId": null,
      "productId": null,
      "sourceUrl": null,
      "sourceDigest": null,
      "resolverUri": null,
      "issuedAt": "2026-07-15T09:00:00Z",
      "encrypted": false,
      "hasKey": false,
      "verification": {
        "generation": 1,
        "state": "complete",
        "requestedAt": "2026-07-15T09:00:00Z",
        "completedAt": "2026-07-15T09:00:00Z",
        "checks": {
          "retrieval": "not_run",
          "decryption": "not_run",
          "digest": "not_run",
          "proof": "pass",
          "status": "not_run",
          "temporal": "not_run",
          "schemaConformance": "not_run"
        },
        "summary": "verified"
      },
      "currencyStatus": "current",
      "detailsStatus": "EXTRACTED",
      "detailsError": null,
      "capabilities": { "deletable": false, "annotatable": false, "verifiable": true },
      "warnings": [],
      "createdAt": "2026-07-15T09:00:00Z",
      "updatedAt": "2026-07-15T09:00:00Z"
    }
  ]
}
```

Malformed JSON, a missing or invalid `ids` array, and an over-limit request return `400`. An oversized body returns `413 REQUEST_BODY_TOO_LARGE`. Authentication and tenant-assignment failures keep the shared `401` and `403` responses. A database or projection failure returns a sanitised `500` with a correlation id.

## Register a credential received from a third party

```
POST /api/v1/library
Idempotency-Key: <caller-chosen value>
```

```json
{
  "sourceUrl": "https://supplier.example/credentials/dpp-42",
  "sourceEncryption": { "decryptionKey": "<supplier's key>" },
  "annotations": {
    "displayName": "Battery pack DPP from Supplier Ltd",
    "declaredCredentialType": "DPP",
    "dateReceived": "2026-08-30",
    "notes": "Received by email"
  }
}
```

`sourceUrl`, `annotations.displayName` and `annotations.declaredCredentialType` are required. `sourceEncryption` is optional and, when present, must carry `decryptionKey`; its `encryptionMethod` is accepted for compatibility with the contract and not currently used, because the envelope names its own algorithm. `dateReceived` is a calendar date. Bounds: `sourceUrl` at most 2048 characters, `displayName` at most 200, `notes` at most 2000, `decryptionKey` must be an AES-256-GCM key as 64 hexadecimal characters; an over-long value is a `400` naming the field.

The `Idempotency-Key` header is required. A register call creates a durable copy, so it cannot be retried safely without one. The value is caller-chosen and unique per attempt (a UUID is a good choice), 1 to 255 printable ASCII characters. A retry with the same key and the same body returns the record as it is now, with `201` again: not the original response body, but the current record, so a retried caller sees settled verification state rather than a stale `pending`. The same key with a different body is `422 IDEMPOTENCY_KEY_MISMATCH`. A key whose request was still running when the retry arrived is `409 IDEMPOTENCY_KEY_IN_FLIGHT`. A key whose request was rejected before a record was written (any `400`, the duplicate `409` below, and any `500` other than a failure to present a record that was already written) is not consumed by that request and may be reused once the problem is corrected.

Duplicate detection compares the signed JWT content of an opened credential with external records in the same tenant. Different envelopes around the same signed credential therefore match, while native records do not participate. The comparison runs after decryption and credential detail extraction, before the durable copy is stored. Identity is the exact text of the accepted signed JWT, so two spellings of one credential that a verifier would both accept are two identities and neither matches the other. A duplicate creates no new record, and the request's `Idempotency-Key` is not consumed by this rejection, so the same key may be reused once the duplicate is resolved. When two registrations of the same credential race, the losing request may already have stored its durable copy before the database refuses its record. That copy is left in the storage service with no record pointing at it, and the rejection is logged for the operator. Duplicate detection applies to external records registered by this version of the Reference Implementation onwards, because records registered before it carry no content identity for a later registration to match.

A record that holds a credential's content identity keeps it whatever state the record is in. A record whose durable copy failed to store, or whose credential could not be read, therefore still blocks a fresh registration of that credential. Re-verifying that record repairs it. A repeat registration of the same credential is answered with the `409` naming that record for as long as it holds the identity.

The record contract also publishes a `DUPLICATE_CONTENT` warning. It is raised when a re-verification re-reads a source whose signed content identity belongs to another external record in the tenant. The recovered record keeps its new durable copy and points at the record that already holds the identity.

Responses:

- `201` with the record; see the outcome table above for which branch applied.
- `400 VALIDATION_FAILED` for a body that fails validation, a malformed `sourceUrl`, or a missing or malformed `Idempotency-Key`; `400 SOURCE_NOT_PERMITTED` for a source on a private or reserved network address; `400` with no code when the request body could not be read at all; `413 REQUEST_BODY_TOO_LARGE` when the body exceeds the configured request size limit.
- `409 IDEMPOTENCY_KEY_IN_FLIGHT` and `422 IDEMPOTENCY_KEY_MISMATCH` as above. `409 IDEMPOTENCY_KEY_RECORD_DELETED` when the record a replayed key produced was deleted while the request was being answered; retrying the request registers afresh.
- `409 DUPLICATE_CREDENTIAL` when the opened signed credential is already registered as an external record in this tenant. The response names the existing record and includes its relative `Location` header. The request's `Idempotency-Key` remains available for a later fresh registration.
- `500` with no code for any other server failure; the message carries a correlation id for the operator. `500 CREDENTIALS_ENCRYPTION_UNAVAILABLE` when this deployment cannot protect the storage key a copy of an opened credential needs. The fetch and any decrypt already ran; no copy is stored and no record is created. This is a deployment problem (the encryption key configuration), not a caller problem; see [Startup](../operations/startup).

The response is the full record. Key material is never in it; the record's own decryption key is only returned by [the detail route](#retrieve-one-library-record), for a record of either origin.

A duplicate response looks like this:

```
HTTP/1.1 409 Conflict
Location: /api/v1/library/clw0dup1ic4terecord000001
Content-Type: application/json

{
  "error": "This credential is already registered as record clw0dup1ic4terecord000001.",
  "code": "DUPLICATE_CREDENTIAL"
}
```

## Retrieve one library record

```
GET /api/v1/library/{id}
```

This returns one record of either origin. It carries the same fields the register call answers with, plus `storageUri`, `digestMultibase` and `decryptionKey`. The three added fields are always present in the JSON object, but each value can be `null`.

The route is also the verification polling target. A record with `verification.state: pending` is read again later until the newest generation is `complete` or `failed`. Each read reports the stored record and custody state. The route does not fetch the durable copy, verify it, change custody columns or create a verification run.

The custody fields describe the copy held by this Reference Implementation. For an external record, `sourceUrl` is the supplier's fetch location and `sourceDigest` is the digest of the raw bytes as fetched. `storageUri` is the location of the Reference Implementation's durable copy and `digestMultibase` is the storage service's content digest for that copy. Do not substitute `sourceUrl` for `storageUri`.

| Record state                               | `storageUri` | `digestMultibase` | `decryptionKey`               |
| ------------------------------------------ | ------------ | ----------------- | ----------------------------- |
| Native credential, encrypted copy          | set          | set               | the native storage key        |
| Native credential, unencrypted copy        | set          | set               | `null`                        |
| External credential, protected copy        | set          | set               | the receiver-side storage key |
| External credential, unopened ciphertext   | set          | set               | `null`                        |
| External credential without a durable copy | `null`       | `null`            | `null`                        |

What `digestMultibase` covers depends on the copy. For a copy the storage service encrypted, meaning a native encrypted credential or an external protected copy, it covers the content before encryption. For an unencrypted copy, and for unopened ciphertext stored exactly as fetched, it covers the stored bytes. A caller fetching an encrypted copy must decrypt it before comparing the digest.

What that decryption yields depends on the kind of copy. An encrypted credential decrypts to the credential JSON, and its digest covers the compact form of that JSON. Every other encrypted copy, meaning an HTML page, a JSON body that is not a credential, or opaque bytes, decrypts to the base64 text of the stored bytes, and its digest covers those bytes. So a caller comparing the digest of a non-credential copy base64-decodes the decrypted text first.

`storageUri` and `digestMultibase` travel together: both are set whenever a durable copy exists, and the digest is `null` whenever the URI is `null`. `decryptionKey` is non-null exactly when `hasKey` is `true`, and a key is only ever returned alongside a `storageUri`. A native record always has a durable copy, so its URI and digest are never `null`.

`hasKey` and `decryptionKey` report the stored custody columns as they are. A re-verification that proves the durable copy lost leaves them unchanged, and the record's newest verification generation carries that state instead. So a key can still be returned for a copy that no longer answers, and the record's `verification` envelope is where that loss is reported, as `STORED_COPY_UNAVAILABLE` or `STORED_COPY_CORRUPT` with `retryable: false`.

An external record with unopened ciphertext has `encrypted: true`, `hasKey: false` and normally `detailsStatus: EXTRACTION_PENDING`. The key is `null` because the service has no key that opens that copy. The supplier's original key lives only for the length of the registration or re-verification request that carried it, and is never returned by this route.

For a native record with no stored verification run, `verification.generation: 1` is the issuance assertion. It is synthesised from the native record and has `state: complete`, `proof: pass`, six `not_run` checks, and matching `requestedAt` and `completedAt` values from the record's creation time. Once a stored run exists, the newest stored generation is returned, including when it is `pending` or `failed`.

The response carries `Cache-Control: no-store` for every custody state. Serve this endpoint over HTTPS so the returned key is protected in transit.

The example below shows the custody fields alongside the record id and origin. Every other record field is omitted.

```json
{
  "id": "clw0ext3rn4lprotect000003",
  "origin": "external",
  "storageUri": "https://storage.internal.example/credentials/clw0ext3rn4lprotect000003",
  "digestMultibase": "zQm-storage-digest",
  "decryptionKey": "<receiver-side key>"
}
```

An unknown id and an id belonging to another tenant both return `404 NOT_FOUND` with the same body. The detail route does not distinguish those cases.

If a stored key cannot be revealed, or a stored value resembles an encryption envelope but is invalid, the route returns a sanitised `500` with the request correlation id. The settled response for that case is tracked by [uncefact/tests-untp#769](https://github.com/uncefact/tests-untp/issues/769).

## Update recipient annotations

```
PATCH /api/v1/library/{id}
If-Version: <annotationVersion>
```

This operation updates the recipient-owned annotations on an external record. The request may include any combination of `displayName`, `declaredCredentialType`, `dateReceived` and `notes`. `displayName` and `declaredCredentialType` are required on the stored record and cannot be cleared. `dateReceived` and `notes` accept an explicit `null` to clear their current values. Omitting either field leaves it unchanged. An empty body and a body containing only unknown fields are `400 VALIDATION_FAILED`, and unknown fields are stripped.

The body bounds are the same as registration: `displayName` is between 1 and 200 characters and cannot be only whitespace, `notes` is at most 2000 characters, and `dateReceived` is a real `YYYY-MM-DD` calendar date. The two text fields cannot contain a NUL character. The declared type is one of `DFR`, `DCC`, `DPP`, `DTE` or `DIA`.

An empty string is a valid `notes` value. It is stored and returned as an empty string, which is a different state from `null`. Send `null`, not `""`, to clear the field.

The `If-Version` header is required and is compared with `annotations.annotationVersion`. It accepts a signed decimal integer after trimming whitespace, including leading zeroes and a leading `+`, within `1` to `2147483647`. Missing, malformed and out-of-range values return `400 INVALID_IF_VERSION`. A well-formed value that does not match the stored version returns `409 VERSION_CONFLICT`. Re-read the record and retry with its current version. A successful update advances the version by one.

The tenant-scoped lookup happens before header or body validation. An absent or foreign-tenant id returns the same `404 NOT_FOUND`. A native record is visible but read-only and returns `403 NATIVE_CREDENTIAL_NOT_ANNOTATABLE`. No request body is read for either of those earlier outcomes. The header is validated before the body, so a request whose `If-Version` and body are both invalid reports `400 INVALID_IF_VERSION`.

The response is the keyless `CredentialRecord` shape. Updating an annotation never changes `credential.*`, custody fields, verification runs or the verification queue.

Two things beyond the annotations themselves do move. A successful update advances the record's `updatedAt`, so a client using that timestamp to detect change or key a cache sees an annotation edit. And changing `declaredCredentialType` adds or removes the `DECLARED_TYPE_MISMATCH` warning in the record the request returns, because that warning is derived at projection time by comparing the declared type with the type extracted from the credential. Neither of those writes anything else. A response projection failure can happen after the database transaction has committed and is returned as a sanitised `500`. Re-read the record to discover its advanced version before retrying. Retrying with the old version then returns `409 VERSION_CONFLICT`.

A `500` covers three cases: the record could not be read, so nothing was attempted; the update failed and rolled back, so nothing was committed; or the response projection failed after the update had committed. Only the last leaves a new stored version behind, which is why a retry with the old token would answer `409`. Re-read the record first and retry with the version it reports. Under heavy contention an update can also exceed its lock wait and answer `500`. The same re-read and retry applies.

Responses:

- `200` with the updated keyless record.
- `401` when the request carries no valid token, as on every library operation.
- `400 INVALID_IF_VERSION` for a missing, malformed or out-of-range header; `400 VALIDATION_FAILED` for an invalid body; `413 REQUEST_BODY_TOO_LARGE` when the body exceeds the configured request size limit.
- `403 NATIVE_CREDENTIAL_NOT_ANNOTATABLE` with `This is a native credential record; it has no recipient annotations to update.` for a native record, or the shared tenant-assignment refusal from authentication.
- `404 NOT_FOUND` for an absent or foreign-tenant id.
- `409 VERSION_CONFLICT` for a stale version, with no annotation change.
- Sanitised `500` for a read failure, an update that rolled back, or a projection failure after a committed update. A record that has reached its maximum annotation version cannot be annotated further and answers this response. Contact the operator.

## Re-verify a library record

```
POST /api/v1/library/{id}/verify
```

The request body must be empty. Any bytes, including whitespace, return `400 VALIDATION_FAILED`. A body that cannot be read and an over-sized body keep the inherited `400` and `413 REQUEST_BODY_TOO_LARGE` responses described in the Swagger operation. The key-bearing form is not part of this operation yet.

The route applies these checks in order.

1. It rejects a present body before reading the record.
2. It reads the record in the caller's tenant. An unknown id and an id owned by another tenant return `404 NOT_FOUND`.
3. A pending generation is returned with `202` and is joined. No second generation or queue job is created.
4. A native record gets the next generation, and the worker reads its stored copy.
5. An external record without a durable copy always reserves generation N+1 as `PENDING` first, then re-fetches its source in the request, outside any transaction. A concurrent request that reads the reservation joins it and starts no second fetch. Recovery readies the job queue immediately after a successful reservation and before the fetch. A queue that will not start _before_ this reservation exists (the native and protected-copy branches above and below, which enqueue before locking anything) still answers a sanitised `500` with no generation created. A queue that will not start _after_ the reservation exists instead settles it `FAILED VERIFICATION_UNAVAILABLE` (retryable) with no fetch or store ever attempted, and answers `202` with that settled generation, because the reservation itself already exists; a later re-verify reserves a fresh one. That `202` is only truthful once the settle write itself actually committed: if the settle write itself also fails (a transient database fault, separate from the queue failure that triggered it), the reservation stays `PENDING` and the request answers the queue's own sanitised `500` instead of a false promise of a settled generation, with the reconciliation sweep as the eventual backstop for a reservation neither path could settle. What the fetch returns, not the record's prior state, decides everything from here:
   - A response that opens the credential the record already holds, or a different one, replaces identity and details and, when storage succeeds, custody too, then finalises the reservation as pending for the worker, promoting an advisory pointer if the identity being replaced had one and keeping content identity singular under a race. When storage fails instead, the reservation settles `FAILED STORAGE_FAILED`, retryable, with custody left empty and identity and details still written from what was observed. A payload the storage service refused outright, because its upload rules do not accept this content, is the one exception. It settles the same code with `retryable: false`, since the same request will not succeed until an operator changes the service's rules.
   - A response that does not open a credential (an unopened envelope, or any other body) on a record that already holds a content identity is refused: the reservation settles `FAILED` with `DECRYPTION_REQUIRED` (an envelope) or `SOURCE_NOT_CREDENTIAL` (anything else), and custody, identity and details are left exactly as they were. Nothing is stored for this response in the first place, so there is no copy to orphan.
   - A response that does not open a credential on a record with no identity to protect is stored exactly as a fresh registration would store it: an unopened envelope keeps its ciphertext, `EXTRACTION_PENDING`, and `DECRYPTION_REQUIRED` for this generation, so a later bodyless call then meets the already-holds-a-copy `DECRYPTION_REQUIRED` case below. Any other body is stored and settles like registration's own non-credential row instead (`EXTRACTION_PENDING`, or `EXTRACTION_FAILED` if extraction itself failed); that body is not ciphertext, so a later bodyless call does not meet the stored-ciphertext `400`. It instead takes the protected-copy branch (step 7), which re-checks the stored body's freshness and lets the worker report on it, including a possible proof failure if it is still not a credential.
   - A retrieval failure (the source could not be reached at all) settles the reservation `FAILED RETRIEVAL_FAILED` and leaves custody and details exactly as they were, because the source was never actually read this time.
   - A response that does not open a credential, on a record whose identity was cleared by another write while this fetch was running, is neither of the two cases above. The premise the refusal rested on is gone, so the reservation settles `FAILED VERIFICATION_UNAVAILABLE` (retryable) saying the record's identity changed while its source was being fetched, and nothing else is written. A later re-verify fetches the source again on the record's current terms.
   - Finalisation locks every `LibraryRecord` parent this recovery's identity reconciliation touches, and if the set it needs to lock keeps changing (concurrent recoveries of the same new content moving the digest's holder among themselves) it restarts, discovering the set fresh under lock each time, up to a bounded number of restarts. A set that still has not settled once that bound is spent settles the reservation `FAILED VERIFICATION_UNAVAILABLE` (retryable) naming a moving identity set, answered `202` with that settled generation exactly like the queue-unavailable case above (again, only once the settle write itself commits; an unconfirmed settle answers the sanitised `500` instead). A later re-verify tries again against whatever the set looks like next.
6. An external record that already holds a durable copy of unopened ciphertext (`encrypted: true`, no usable receiver-side key) returns `400 DECRYPTION_REQUIRED` before any fetch and creates no generation. This is the only synchronous refusal left: a no-copy record with the same `encrypted` flag still fetches, per step 5, because that flag describes what was last observed, not what the source will return now. Recovering an existing durable copy of ciphertext is not possible in this release; it needs a key-bearing route this service does not offer yet.
7. For an external record with a protected copy, the supplier source is checked for freshness in the request, then the generation is created and the worker reads the pinned copy.
8. A record whose durable copy or newest generation moved while the request was being prepared starts no new generation. The request returns `202` with the record's current generation, which may already be settled. During no-copy finalisation this is not "no generation": the reservation from step 5 already exists, and this request returns `superseded` for it rather than attaching to it; the run itself keeps whatever state actually settled it, and nothing further is written on this path. `superseded` is what this request reports, not a state the run is ever recorded in.

Every accepted request returns `202` with the current keyless record. It may already show `complete` or `failed` when the worker settles the generation before the response is read. Re-poll the detail route to observe the final state. A stored-copy loss is discovered by the worker and settles as `STORED_COPY_UNAVAILABLE` when the copy cannot be read back as the document that was stored, or `STORED_COPY_CORRUPT` when it reads back but fails its digest check. The generation carries `retryable: false`, while the record's custody coordinates and `hasKey` remain unchanged.

One case is not observable on that poll. When the service cannot unlock the key it holds for the durable copy, the generation settles as `STORED_COPY_UNAVAILABLE` with `retryable: true`, and the detail route returns the sanitised `500` described above until an operator restores access to the encryption key. That gap is tracked by [uncefact/tests-untp#769](https://github.com/uncefact/tests-untp/issues/769).

A no-copy recovery that opens a credential can reach the same encryption preflight the register endpoint runs. If this service cannot protect the storage key a durable copy of that opened credential would need, the request answers `500 CREDENTIALS_ENCRYPTION_UNAVAILABLE`, the same code and cause the [register endpoint](#register-a-credential-received-from-a-third-party) uses. Unlike the register endpoint, a generation _is_ created here: the reservation this recovery already made is settled `FAILED STORAGE_FAILED` (retryable) before the coded 500 is answered. Any other unexpected failure while fetching or finalising a no-copy recovery also settles the reservation before answering, as a retryable `VERIFICATION_UNAVAILABLE` rather than as `STORAGE_FAILED`, and answers a sanitised `500`, except the queue-unavailable-after-reservation case and the lock-discovery exhaustion case in step 5, both of which answer `202` with the settled generation instead, once their own settle write commits. Either way the reservation itself is settled, not left `PENDING`, so a later re-verify reserves a fresh generation rather than joining a stuck one.

| Situation                                                                                           | Response and verification result                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native re-verification has created generation 2                                                     | `202`; `verification` is `pending`, generation `2`, and `retrieval`, `decryption` and `digest` shown as `not_run`.                                                                                                                                                                                  |
| A second request arrives while that generation is pending                                           | `202`; the same pending generation is returned and no second job is created.                                                                                                                                                                                                                        |
| The protected supplier source differs from `sourceDigest`                                           | `202`; the settled external generation carries `sourceChanged: true` and the pinned `storageUri` stays unchanged.                                                                                                                                                                                   |
| The protected supplier source is unchanged                                                          | `202`; the settled external generation carries `sourceChanged: false`.                                                                                                                                                                                                                              |
| The supplier source cannot be checked                                                               | `202`; the settled external generation carries `sourceChanged: null` and a non-null `lastSourceCheckAt`.                                                                                                                                                                                            |
| The pinned durable copy is proven absent or corrupt                                                 | `202`; the worker settles `STORED_COPY_UNAVAILABLE` (absent) or `STORED_COPY_CORRUPT` (digest mismatch) with `retryable: false`, and the next request reads the same custody tuple again.                                                                                                           |
| A no-copy source opens the credential and is stored                                                 | `202`; custody, identity and details are replaced, and a pending generation is queued. Two requests racing this way join one reservation; only the winner fetches.                                                                                                                                  |
| A no-copy source opens a credential already held elsewhere                                          | `202`; the new copy is queued and the record carries a `DUPLICATE_CONTENT` warning naming the current holder. The former identity's oldest advisory is promoted if the record recovering was its canonical holder.                                                                                  |
| A no-copy source does not open a credential, and the record already holds an identity               | `202`; a failed `DECRYPTION_REQUIRED` (an envelope) or `SOURCE_NOT_CREDENTIAL` (any other body) generation is recorded. Custody, `contentDigest`, `duplicateOfRecordId` and details are left exactly as they were; nothing is stored, so there is no copy to orphan.                                |
| A no-copy source does not open a credential, and the record holds no identity                       | `202`; stored exactly as a fresh registration would store it (an unopened envelope keeps `DECRYPTION_REQUIRED`; any other body settles like registration's own non-credential row), `EXTRACTION_PENDING` details, or `EXTRACTION_FAILED` if extraction itself failed.                               |
| A record already holds a durable copy of unopened ciphertext                                        | `400 DECRYPTION_REQUIRED`; no fetch is attempted and no generation is created. This is the only case still refused before a fetch.                                                                                                                                                                  |
| A no-copy record's identity changed while its source was being fetched                              | `202`; the reservation settles `FAILED VERIFICATION_UNAVAILABLE` (retryable) naming the identity change. Custody, identity and details are untouched, and a later re-verify fetches again.                                                                                                          |
| A no-copy source cannot be fetched at all                                                           | `202`; a failed `RETRIEVAL_FAILED` generation is recorded, with `sourceChanged: null` when an earlier source digest existed. Name, issuer, subject, validity, type and `detailsStatus` are left unchanged, whatever they held before this attempt.                                                  |
| The job queue will not start before a no-copy fetch                                                 | `202`; the reservation settles `FAILED VERIFICATION_UNAVAILABLE` (retryable), naming the queue. No fetch or store is ever attempted. This `202` holds only once that settle write itself commits; if it does not, the reservation stays `PENDING` and the sanitised `500` is answered instead.      |
| Concurrent no-copy recoveries of the same content keep moving the lock set past the bounded restart | `202`; the reservation settles `FAILED VERIFICATION_UNAVAILABLE` (retryable) naming a moving identity set. Answered the same way once that settle write commits; an unconfirmed settle answers the sanitised `500` instead. A later re-verify tries again against whatever the set looks like next. |
| The record moved while the request was being prepared                                               | `202`; no new generation is created and the record's current generation is returned, settled or pending. For a no-copy reservation, this request reports that reservation as `superseded` rather than attaching to it; the run keeps whatever state actually settled it.                            |

The freshness comparison is separate from verification of the pinned copy. A source outage therefore does not set the generation's `retrieval` check to `fail`. It records instead that freshness was not checked. Recovery compares a successful re-fetch with an earlier `sourceDigest` when one exists. The freshness fields appear only on a settled external generation that attempted the comparison. For a protected copy (step 7), `lastSourceCheckAt` is stamped when the source fetch starts, which happens before the generation is created, so it can precede the generation's `requestedAt` by however long that fetch took. For a no-copy recovery (step 5), the ordering is fixed rather than variable: `requestedAt` is stamped inside the reservation transaction, and `lastSourceCheckAt` is stamped afterwards, once the job queue is readied and just before the fetch itself runs, so `lastSourceCheckAt` can only follow `requestedAt`, by however long that reservation-and-queue-preparation interval took, never by the fetch's own duration.
