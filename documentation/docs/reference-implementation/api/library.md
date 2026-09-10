---
sidebar_position: 8
title: Library
---

# Library API

The library holds every credential a tenant has, whether the tenant issued it through this Reference Implementation or received it from someone else. A record for a credential the tenant issued is a **native** record. A record for a credential received from a third party is an **external** record: the tenant gives the credential's location, the Reference Implementation fetches it, checks it, and keeps its own copy, so the credential is still available if the supplier later takes it offline.

This page covers listing the library, fetching several records by id, registering an external credential, retrieving one record, updating its recipient annotations, re-verifying a record and deleting a record.

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

The `checks` object always lists seven checks (`retrieval`, `decryption`, `digest`, `proof`, `status`, `temporal`, `schemaConformance`), each `pass`, `fail` or `not_run`. `digest` answers a different question depending on how the generation acquired its bytes: on a source acquisition (a registration, or a recovery that fetched the supplier source) it reports whether the acquired body is a signed credential, and on a stored-copy acquisition (a key-bearing recovery of the record's own unopened copy) it reports whether that copy matched the integrity digest recorded for it. Both are blocking, and a record can carry one meaning at one generation and the other at the next. The summary of a `complete` generation is derived from those published checks. Any failed blocking check makes it `not_conformant`. Otherwise it is `verified`, as long as at least one check ran. A generation where nothing ran is `not_conformant`. The blocking checks are `retrieval`, `decryption`, `digest`, `proof` and `status`. `temporal` is recorded as evidence and does not block, so a genuine credential that has expired is still `verified`. Its currency is reported separately in `currencyStatus`. `schemaConformance` is advisory.

Every generation of an external record is an executed check. A native record's generation 1 is an issuance assertion instead, described under [Retrieve one library record](#retrieve-one-library-record). A re-verification generation records the actual acquisition, custody and verification results of the attempt that produced it. Verification always runs on the worker. Acquisition and custody are the worker's on a native or protected-copy generation, and the request's own on a recovery, which reads or fetches the bytes before the generation is finalised. For a native record, every response projects those acquisition and custody checks as `not_run`, whichever route returned it, because they describe acquiring a credential from someone else. The executed proof, status, temporal and `schemaConformance` results stay visible.

Re-verification checks the supplier source against a stored `sourceDigest` when it reads a protected copy or recovers a record with no durable copy. A recovery of an unopened durable copy reads that copy instead. It never fetches the supplier, calculates a new source digest or writes `sourceChanged` or `lastSourceCheckAt`. A settled generation includes the freshness pair only when a supplier comparison was attempted. `sourceChanged` is `false` when the source is unchanged, `true` when it differs and `null` when the source could not be checked. These fields are absent from a pending envelope.

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

`retryable: false` means the same request, unchanged, will not succeed until whatever the outcome turned on changes, and the failure message names which that is. It may be what the source serves, the record's own retained copy once that copy is what every later attempt reads, or the storage service's upload rules, which only an operator can change. `retryable: true` means a later attempt may succeed, whether unchanged (an outage cleared) or after a correction (the right key). It is a classification of what was observed, never a promise about the source.

### Encrypted sources

A supplier may publish a credential encrypted. Register accepts the key in `sourceEncryption.decryptionKey`. The key is used to open the fetched body for this one request and is then forgotten: it is never stored, never logged, never placed on the job queue and never returned. Serve this endpoint over HTTPS so the key is protected in transit.

When no key is supplied, or the key does not work, the Reference Implementation still keeps the credential. It stores the ciphertext exactly as fetched, with no key of its own, and the record says so: `encrypted: true`, `hasKey: false`, and a `failed` generation naming `DECRYPTION_REQUIRED` or `DECRYPTION_FAILED`. A bodyless re-verification of that stored ciphertext is refused with `400 DECRYPTION_REQUIRED`. A key-bearing re-verification reads the stored copy, checks its raw digest and opens it with the request's key. On success it replaces the raw copy with a receiver-protected copy and queues verification. A wrong key leaves the raw copy and the existing record metadata unchanged, and settles the new generation as `DECRYPTION_FAILED`. A record whose copy was never written, because storage was unavailable at the time, is re-verified normally. A key-bearing request fetches its source with the key, while a bodyless request fetches it without one. What that fetch returns decides the outcome, as [Re-verify a library record](#re-verify-a-library-record) describes.

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
  "pagination": { "total": 2, "limit": 20, "offset": 0, "hasMore": false },
  "failures": []
}
```

List rows are keyless for both origins. They also omit `storageUri` and `digestMultibase`. Use [Retrieve one library record](#retrieve-one-library-record) when a durable-copy location or receiver-side key is required. The response is sent with `Cache-Control: no-store`.

The response always includes `failures`. A row whose stored state cannot be represented is left out of `data` and named there as `{ "id": "<selected id>", "code": "RECORD_UNREADABLE", "message": "..." }`; all other rows still return. The message says the record exists and belongs to this tenant, which is what separates the code from `NOT_FOUND`, and tells the caller to quote the record id and the `x-correlation-id` response header when contacting support. Stored state this contract cannot represent is the usual cause, but the code covers any fault local to that one record, so it is not by itself proof that the stored record is damaged. Database, transaction and selection-boundary failures remain whole-response `500` errors. `pagination.total` includes unreadable rows, and `pagination.hasMore` counts the page as consumed by `data.length + failures.length`, not by `data.length`. Advance to the next request by `limit`, even when every row on the current page is in `failures`.

For example, a first page with twenty unreadable rows out of forty has `data: []`, twenty `RECORD_UNREADABLE` failures and `hasMore: true`. The next page can contain nineteen readable rows and one failure with `hasMore: false`; no extra readable rows are pulled forward to fill either page.

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

The maximum counts ids as submitted, before duplicate removal. It defaults to `500`, or the [configured maximum](../operations/api-pagination#maximum-page-size) where a deployment sets one. A request above the effective maximum returns `400 BATCH_GET_LIMIT_EXCEEDED` naming that maximum. The request is rejected rather than truncated, and duplicate ids still count towards the limit. A NUL-bearing id passes the string validation but is reported as `NOT_FOUND` without reaching the database. If every id is NUL-bearing, the response is `200` with an empty `data` array and one `NOT_FOUND` failure per distinct submitted id.

Exact duplicate ids are read once. The response has one row per readable matching id, in the order each id first appeared in the request. `failures` keeps that same first-appearance order, so a caller can pair its request list against either array by walking it once. Every distinct submitted id appears exactly once across `data` and the required `failures` array. Missing ids, ids owned by another tenant and NUL-bearing ids have the same `{ "id": "<submitted id>", "code": "NOT_FOUND", "message": "No such credential record." }` outcome, so the response does not reveal which case occurred. A selected row that cannot be represented has `RECORD_UNREADABLE` instead. Native and external records can be returned together.

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
  ],
  "failures": []
}
```

Malformed JSON, a missing or invalid `ids` array, and an over-limit request return `400`. An oversized body returns `413 REQUEST_BODY_TOO_LARGE`. Authentication and tenant-assignment failures keep the shared `401` and `403` responses. A database, transaction or selection-boundary failure returns a sanitised `500` with a correlation id; a row-local read or projection failure is a `RECORD_UNREADABLE` entry in `failures`.

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

`sourceUrl`, `annotations.displayName` and `annotations.declaredCredentialType` are required. `sourceEncryption` is optional and, when present, must carry `decryptionKey`; its `encryptionMethod` is accepted for compatibility with the contract and not currently used, because the envelope names its own algorithm. `dateReceived` is a calendar date.

Bounds: `sourceUrl` at most 2048 characters, `displayName` at most 200, `notes` at most 2000, `decryptionKey` must be an AES-256-GCM key as 64 hexadecimal characters; an over-long value is a `400` naming the field. `displayName` and `notes` cannot contain a NUL character. The declared credential type must be one of `DFR`, `DCC`, `DPP`, `DTE` or `DIA`, and a missing or invalid value returns a `400` naming the permitted values without repeating the submitted value. The read routes treat a NUL differently. There, a NUL in a record id or in one of the text filters (`organisationId`, `facilityId`, `productId`, `issuer`) matches nothing, while typed query parameters keep their own validation.

The `Idempotency-Key` header is required. A register call creates a durable copy, so it cannot be retried safely without one. The value is caller-chosen and unique per attempt (a UUID is a good choice), 1 to 255 printable ASCII characters. A retry with the same key and the same body returns the record as it is now, with `201` again: not the original response body, but the current record, so a retried caller sees settled verification state rather than a stale `pending`. The same key with a different body is `422 IDEMPOTENCY_KEY_MISMATCH`. A key whose request was still running when the retry arrived is `409 IDEMPOTENCY_KEY_IN_FLIGHT`. A key whose request was rejected before a record was written (any `400`, the duplicate `409` below, and any `500` other than a failure to present a record that was already written) is not consumed by that request and may be reused once the problem is corrected.

Duplicate detection compares the signed JWT content of an opened credential with external records in the same tenant. Different envelopes around the same signed credential therefore match, while native records do not participate. The comparison runs after decryption and credential detail extraction, before the durable copy is stored. Identity is the exact text of the accepted signed JWT, so two spellings of one credential that a verifier would both accept are two identities and neither matches the other. A duplicate creates no new record, and the request's `Idempotency-Key` is not consumed by this rejection, so the same key may be reused once the duplicate is resolved. When two registrations of the same credential race, the losing request may already have stored its durable copy before the database refuses its record. That copy is left in the storage service with no record pointing at it, and the rejection is logged for the operator. Duplicate detection applies to external records registered by this version of the Reference Implementation onwards, because records registered before it carry no content identity for a later registration to match.

A record that holds a credential's content identity keeps it whatever state the record is in. A record whose durable copy failed to store, or whose credential could not be read, therefore still blocks a fresh registration of that credential. Re-verifying that record repairs it. A repeat registration of the same credential is answered with the `409` naming that record for as long as it holds the identity.

The record contract also publishes a `DUPLICATE_CONTENT` warning, on every route that returns a record. It is raised when a re-verification re-reads a source whose signed content identity belongs to another external record in the tenant. The recovered record keeps its new durable copy and points at the record that already holds the identity.

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

| Record state                                               | `storageUri` | `digestMultibase` | `decryptionKey`                                   |
| ---------------------------------------------------------- | ------------ | ----------------- | ------------------------------------------------- |
| Native credential, encrypted copy                          | set          | set               | the native storage key                            |
| Native credential, unencrypted copy                        | set          | set               | `null`                                            |
| External credential, protected copy                        | set          | set               | the receiver-side storage key                     |
| External credential, unopened ciphertext                   | set          | set               | `null`                                            |
| External credential without a durable copy                 | `null`       | `null`            | `null`                                            |
| Native or external record with a held key it cannot return | set          | set               | `null`, with `DECRYPTION_KEY_UNAVAILABLE` warning |

What `digestMultibase` covers depends on the copy. For a copy the storage service encrypted, meaning a native encrypted credential or an external protected copy, it covers the content before encryption. For an unencrypted copy, and for unopened ciphertext stored exactly as fetched, it covers the stored bytes. A caller fetching an encrypted copy must decrypt it before comparing the digest.

What that decryption yields depends on the kind of copy. An encrypted credential decrypts to the credential JSON, and its digest covers the compact form of that JSON. Every other encrypted copy, meaning an HTML page, a JSON body that is not a credential, or opaque bytes, decrypts to the base64 text of the stored bytes, and its digest covers those bytes. So a caller comparing the digest of a non-credential copy base64-decodes the decrypted text first.

`storageUri` and `digestMultibase` travel together: both are set whenever a durable copy exists, and the digest is `null` whenever the URI is `null`. `decryptionKey` is non-null exactly when `hasKey` is `true` and the held key can be returned. When the service holds a key but cannot return it, whatever the record's origin, `hasKey` remains `true`, `decryptionKey` is `null`, and the detail response carries exactly one `DECRYPTION_KEY_UNAVAILABLE` warning. That warning code appears on the detail response only: the list and batch rows carry no key, and their schema forbids it, so a client's warning handler will never meet it there. A non-null key is only ever returned alongside a `storageUri`. A native record always has a durable copy, so its URI and digest are never `null`.

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

If a stored key cannot be revealed, or a stored value resembles an encryption envelope but is invalid, the route still returns the complete detail record with `200`, `hasKey: true`, `decryptionKey: null` and exactly one `DECRYPTION_KEY_UNAVAILABLE` warning. If the record itself cannot be built, the route returns `500 RECORD_UNREADABLE` with the requested id; the message tells the caller to quote that id and the `x-correlation-id` response header. That coded response carries `Cache-Control: no-store`, because it is the only error on this route that names one of the tenant's record ids. Database and transaction failures keep the shared sanitised `500`.

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

The body is optional. Omit it for ordinary re-verification, or send JSON in the form below for a key-bearing recovery:

```json
{
  "sourceEncryption": {
    "decryptionKey": "<64 hexadecimal characters>"
  }
}
```

The body is read once. Zero bytes are bodyless, regardless of the request headers. Any non-zero body must resolve a usable key. An empty object, unknown fields, malformed JSON, whitespace, an invalid key, or a padded key returns `400 VALIDATION_FAILED` before the record is read. A body that cannot be read and an over-sized body keep the inherited uncoded `400` and `413 REQUEST_BODY_TOO_LARGE` responses described in the Swagger operation. The supplied key is used only for this request and is never stored, logged, queued or returned.

The route applies these checks in order.

1. It validates any non-empty body before reading the record. `sourceEncryption.decryptionKey` is the only field this operation reads. Unlike register, it does not accept `sourceEncryption.encryptionMethod`: that field is stripped rather than validated, so a value register would reject is accepted and ignored here.
2. It reads the record in the caller's tenant. An unknown id and an id owned by another tenant return `404 NOT_FOUND`.
3. A key on a native record returns `400 SOURCE_ENCRYPTION_NOT_ALLOWED`, even when a generation is pending. A native record's copy was issued here and this service already holds its key, so there is nothing for a supplier key to open.
4. A key on an external record that already holds a key of this service's own returns `400 SOURCE_ENCRYPTION_NOT_ALLOWED` too, again even when a generation is pending. The condition is the held key, not the `encrypted` flag and not the presence of a durable copy: a record this service can already open needs no supplier key. This is re-checked under the reservation's own lock in step 9, so a record that was still eligible when the caller read it, and became receiver-protected before that lock was taken, is refused here too rather than reserving a generation for a key it could not use.
5. A key-bearing request on an eligible record whose newest generation is still pending returns `409 VERIFICATION_IN_PROGRESS` and a relative `Location: /api/v1/library/{id}`. It never joins a generation that cannot consume its key. A bodyless request in the same situation returns `202` with the pending generation and creates no second generation or queue job.

   A recovery that was interrupted leaves its own generation pending, so a caller whose earlier key-bearing attempt died is held off their own record by it. Nothing else clears that reservation: the reconciliation sweep does, once the run crosses the abandonment bound, which the deployment sets to at least thirty minutes. Until then every further key-bearing request on that record is refused here. The sweep's own settlement then tells the caller to send the key again.

   The same `409` also answers a rarer case with a different message: a key-bearing request that lost the generation-index race twice, and whose winner had already settled by the time it was read. Nothing is in progress then, and the supplied key was never used, so it can be sent again immediately rather than waited on.
6. A **bodyless** request for an external record that already holds a durable copy of unopened ciphertext (`encrypted: true`, no usable receiver-side key) returns `400 DECRYPTION_REQUIRED` before any acquisition and creates no generation. Bodylessness is the deciding condition: the same record with a key on the request takes step 9's mode B instead. A no-copy record with the same `encrypted` flag is never refused this way, because that flag describes what was last observed, not what the source will return now.
7. A native record gets the next generation, and the worker reads its stored copy.
8. For an external record with a protected copy, the supplier source is checked for freshness in the request, then the generation is created and the worker reads the pinned copy.
9. Otherwise the record is recovered in the request. It always reserves generation N+1 as `PENDING` first, under the parent's lock, then acquires the bytes outside any transaction. A concurrent **bodyless** request that reads the reservation joins it and starts no second acquisition; a concurrent key-bearing one is refused by step 5 instead. A bodyless request that read the record *before* the reservation existed does not reach that join: it evaluates step 6 against the copy it read, so on a record holding unopened ciphertext it is refused `400 DECRYPTION_REQUIRED` and its next step is to send the key, not to poll the generation that won. The reservation returns the custody it observed under that lock, and **that** snapshot chooses the mode, not the read the request entered with, so a record that acquired a durable copy between the two takes mode B against the copy that now exists. A generation that completed while the record stayed eligible reserves the **next** generation rather than answering with the superseding one, so a supplied key is always consumed or refused by name. Recovery readies the job queue immediately after a successful reservation and before the acquisition. A queue that will not start _before_ this reservation exists (the native and protected-copy branches above, which enqueue before locking anything) still answers a sanitised `500` with no generation created. A queue that will not start _after_ the reservation exists instead settles it `FAILED VERIFICATION_UNAVAILABLE` (retryable) with nothing acquired or stored, and answers `202` with that settled generation, because the reservation itself already exists; a later re-verify reserves a fresh one. That `202` is only truthful once the settle write itself actually committed: if the settle write itself also fails (a transient database fault, separate from the queue failure that triggered it), the reservation stays `PENDING` and the request answers the queue's own sanitised `500` instead of a false promise of a settled generation, with the reconciliation sweep as the eventual backstop for a reservation neither path could settle.

   **Mode A**, a record with no durable copy, fetches `sourceUrl` in the request, with the supplied key when one was sent. **Mode B**, a record holding an unopened durable copy, reads the reserved `storageUri` through the storage transport, checks the raw bytes against `storageDigestMultibase`, and opens them with the supplied key. Mode B never fetches `sourceUrl` and never performs a freshness check. What the acquisition returns, not the record's prior state, decides everything from here:

   - A body that opens the credential the record already holds, or a different one, replaces identity and details and, when storage succeeds, custody too, then finalises the reservation as pending for the worker, promoting an advisory pointer if the identity being replaced had one and keeping content identity singular under a race. When storage fails instead, the reservation settles `FAILED STORAGE_FAILED`, retryable, with custody left as it was and identity and details still written from what was observed. A payload the storage service refused outright, because its upload rules do not accept this content, is the one exception. It settles the same code with `retryable: false`, since the same request will not succeed until an operator changes the service's rules.
   - A body that does not open a credential (an unopened envelope, or any other body) on a record that already holds a content identity is refused: the reservation settles `FAILED`, and custody, identity and details are left exactly as they were. Nothing is stored for this body in the first place, so there is no copy to orphan. The code says how far the bytes got. `SOURCE_NOT_CREDENTIAL` covers everything that was read and yielded no credential, whether it arrived as plaintext or came out of an envelope a supplied key opened. The other two are for bytes that could not be opened at all: `DECRYPTION_REQUIRED` for an envelope no key was supplied for, and `DECRYPTION_FAILED` for one a supplied key did not open, retryable for a wrong key and not retryable for a corrupt one.
   - A **mode A** body that does not open a credential, on a record with no identity to protect, is stored exactly as a fresh registration would store it: an unopened envelope keeps its ciphertext and `EXTRACTION_PENDING`, settling `DECRYPTION_REQUIRED` for this generation when no key was supplied and `DECRYPTION_FAILED` when one was and did not open it, so a later bodyless call then meets the already-holds-a-copy `DECRYPTION_REQUIRED` case in step 6. Any other body is stored and settles like registration's own non-credential row instead (`EXTRACTION_PENDING`, or `EXTRACTION_FAILED` if extraction itself failed); that body is not ciphertext, so a later bodyless call does not meet that `400`. It instead takes the protected-copy branch (step 8), which re-checks the stored body's freshness and lets the worker report on it, including a possible proof failure if it is still not a credential.
   - A retrieval failure (the source could not be reached at all, in mode A) settles the reservation `FAILED RETRIEVAL_FAILED` and leaves custody and details exactly as they were, because the source was never actually read this time.
   - A **mode A** body that is an envelope names which of the three unopened readings it was, because the caller's next move differs for each. No key at all settles `DECRYPTION_REQUIRED`, retryable. A supplied key that did not open it settles `DECRYPTION_FAILED`, retryable, so another key can be sent. An envelope too damaged for any key settles `DECRYPTION_FAILED`, not retryable. Those three codes hold where the ciphertext was stored, and where the store was skipped for an identity the record holds. A store that failed takes the code instead, settling `STORAGE_FAILED` with its own retryability, and its message names the key problem alongside the storage one. Where the ciphertext was retained as this record's durable copy, the message names an operator rather than the supplier, because every later attempt reads that retained copy and never touches the source again. Where no copy was retained, because the store failed or was skipped for an identity the record holds, the message still names the source, which is then the only way forward.
   - A **mode A** body that does not open a credential, on a record whose identity was cleared by another write while this acquisition was running, is neither of the two cases above. The premise the refusal rested on is gone, so the reservation settles `FAILED VERIFICATION_UNAVAILABLE` (retryable) saying the record's identity changed while its source was being fetched, and nothing else is written. A later re-verify acquires again on the record's current terms. A **mode B** acquisition that meets the same cleared identity keeps the failure it already prepared against the stored copy, because no source was read and nothing about the supplier changed.
   - Finalisation locks every `LibraryRecord` parent this recovery's identity reconciliation touches, and if the set it needs to lock keeps changing (concurrent recoveries of the same new content moving the digest's holder among themselves) it restarts, discovering the set fresh under lock each time, up to a bounded number of restarts. A set that still has not settled once that bound is spent settles the reservation `FAILED VERIFICATION_UNAVAILABLE` (retryable) naming a moving identity set, answered `202` with that settled generation exactly like the queue-unavailable case earlier in this step (again, only once the settle write itself commits; an unconfirmed settle answers the sanitised `500` instead). A later re-verify tries again against whatever the set looks like next.

10. A record whose durable copy or newest generation moved while the request was being prepared starts no new generation. The request returns `202` with the record's current generation, which may already be settled. During recovery finalisation this is not "no generation": the reservation from step 9 already exists, and this request returns `superseded` for it rather than attaching to it; the run itself keeps whatever state actually settled it, and nothing further is written on this path. `superseded` is what this request reports, not a state the run is ever recorded in.

Every accepted request returns `202` with the current keyless record. It may already show `complete` or `failed` when the worker, or a key-bearing recovery's own settlement, settles the generation before the response is read. Re-poll the detail route to observe the final state. A stored-copy loss found by the worker settles as `STORED_COPY_UNAVAILABLE` when the copy cannot be read back as the document that was stored, or `STORED_COPY_CORRUPT` when it reads back but fails its digest check. The generation carries `retryable: false`, while the record's custody coordinates and `hasKey` remain unchanged.

When the service cannot unlock the key it holds for the durable copy, the generation settles as `STORED_COPY_UNAVAILABLE` with `retryable: true`, and the detail poll reports that state on the record: `200`, `hasKey: true`, `decryptionKey: null` and one `DECRYPTION_KEY_UNAVAILABLE` warning, until an operator restores access to the encryption key.

Mode B's own acquisition failures settle before anything is opened, and none of them uploads or writes a content column. A failed stored read settles `STORED_COPY_UNAVAILABLE` with `retrieval`, `digest` and `decryption` all `not_run`, and the message names what the read reported so an operator can tell a missing object from a timeout. A successful read reports `retrieval: pass`. A stored digest that is missing, or recorded in a form that cannot be read, settles `STORED_COPY_UNAVAILABLE` too, non-retryable, keeping that `retrieval: pass` because the copy did come back; the message says the copy cannot be proven intact rather than that it could not be read. A digest mismatch settles `STORED_COPY_CORRUPT`, with `digest: fail` and decryption `not_run`. After a matching digest, a wrong key settles `DECRYPTION_FAILED`, retryable, with `decryption: fail`; a corrupt envelope settles `DECRYPTION_FAILED`, not retryable. The raw copy and the existing metadata stay exactly as they are, available for a later attempt with a different key.

When mode B opens a credential, the receiver-protected replacement is attached only in the finalisation transaction, after the stored bytes have been read and the replacement prepared. That transaction checks the reserved record, generation and custody tuple, writes the replacement and the observed metadata, and enqueues the reference-only worker job together. If the opened content is a duplicate, the record is kept and carries the advisory `DUPLICATE_CONTENT` warning.

A successful key-bearing recovery removes the supplier's original ciphertext object. The record's row is repointed at the receiver-protected replacement, so the retired object is named by nothing, and it is deleted from the storage instance and bucket the row recorded for it, once the replacement has been committed. The removal is best effort and never affects the answer: a storage service that is unreachable, refuses the delete, or is named by incomplete coordinates leaves the object in place, the recovery still succeeds, and the operator log line names the location and the object id so the object can be reclaimed by hand. The line says which of the two happened. Nothing is removed by a recovery that stored no replacement, and the replacement itself is never removed.

A key-bearing recovery whose key opened a source that turned out to be plaintext attaches a `DECRYPTION_KEY_UNUSED` warning to the record, reading "A supplied decryption key was not needed on an earlier attempt." That warning is never cleared, so it describes the attempt that raised it rather than the record's current state: a record whose source later serves ciphertext, and whose ciphertext a subsequent recovery opens, keeps it. It is also attached by the two recovery outcomes that settle a failure and change nothing else about the record, a rejected replacement and a cleared identity, so a caller who sent an unnecessary key is told so whichever way the attempt ended.

Either mode can reach the same encryption preflight the register endpoint runs, because both submit opened plaintext to this service's storage. If the service cannot protect the storage key the durable copy would need, the request answers `500 CREDENTIALS_ENCRYPTION_UNAVAILABLE`, the same code and cause the [register endpoint](#register-a-credential-received-from-a-third-party) uses. Unlike the register endpoint, a generation _is_ created here: the reservation this recovery already made is settled `FAILED STORAGE_FAILED` (retryable) before the coded 500 is answered. Other failures while acquiring or finalising a recovery also settle the reservation before answering, and which code they settle depends on the class of failure. A storage or encryption failure settles `STORAGE_FAILED`: the encryption preflight above, a store that came back without the key it must return, and a storage service this tenant's configuration could not resolve, decrypt or validate. A content identity that collided twice with a concurrent writer, and any unexpected fault, settle a retryable `VERIFICATION_UNAVAILABLE` instead. All of them answer a sanitised `500`, except the queue-unavailable-after-reservation case and the lock-discovery exhaustion case in step 9, both of which answer `202` with the settled generation instead, once their own settle write commits. Either way the reservation itself is settled, not left `PENDING`, so a later re-verify reserves a fresh generation rather than joining a stuck one.

If a key-bearing request never returns at all, because the process handling it died between the reservation and the finalisation, the reservation is left `PENDING` and the reconciliation sweep settles it once it crosses the abandonment bound. The record still holds its unopened copy, so a plain re-verify of it is refused `400 DECRYPTION_REQUIRED` as in step 6. The sweep's failure message says so, and names the key-bearing form: send the key again on `POST /api/v1/library/{id}/verify`. The key itself is never retained, so the request has to carry it a second time.

If an opened credential is not stored, the raw custody remains authoritative and a later key-bearing request can retry. A wrong key, a digest mismatch, an invalid envelope and a failed stored read never enter the replacement-rejection path. They retain the attempt's own failure code, retryability and checks, and do not call identity reconciliation. A decrypted non-credential follows the registration rule: it can be stored when the record has no identity to protect, but a record with an existing identity refuses that replacement without changing its identity, details or custody.

| Situation                                                                                         | Response and verification result                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A non-empty body has no usable key                                                                | `400 VALIDATION_FAILED`; the record is never read and no generation is created.                                                                                                                                                                                                                     |
| A key is sent for a native record, or for an external record this service already holds a key for | `400 SOURCE_ENCRYPTION_NOT_ALLOWED`; no generation is created, even if another generation is pending.                                                                                                                                                                                               |
| Native re-verification has created generation 2                                                   | `202`; `verification` is `pending`, generation `2`, and `retrieval`, `decryption` and `digest` shown as `not_run`.                                                                                                                                                                                  |
| A second bodyless request arrives while that generation is pending                                | `202`; the same pending generation is returned and no second job is created.                                                                                                                                                                                                                        |
| A key-bearing request arrives while an eligible generation is pending                             | `409 VERIFICATION_IN_PROGRESS` with `Location: /api/v1/library/{id}`; the request neither joins nor consumes another request's generation. The message says to wait for that generation to settle.                                                                                                  |
| A key-bearing request loses the generation race twice and the winner has already settled          | `409 VERIFICATION_IN_PROGRESS` with the same `Location`; the message says another generation was recorded first and the supplied key was not used, so it can be sent again straight away rather than waited on.                                                                                     |
| The protected supplier source differs from `sourceDigest`                                         | `202`; the settled external generation carries `sourceChanged: true` and the pinned `storageUri` stays unchanged.                                                                                                                                                                                   |
| The protected supplier source is unchanged                                                        | `202`; the settled external generation carries `sourceChanged: false`.                                                                                                                                                                                                                              |
| The supplier source cannot be checked                                                             | `202`; the settled external generation carries `sourceChanged: null` and a non-null `lastSourceCheckAt`.                                                                                                                                                                                            |
| The pinned durable copy is proven absent or corrupt                                               | `202`; the worker settles `STORED_COPY_UNAVAILABLE` (absent) or `STORED_COPY_CORRUPT` (digest mismatch) with `retryable: false`, and the next request reads the same custody tuple again.                                                                                                           |
| A bodyless request targets an unopened durable copy                                               | `400 DECRYPTION_REQUIRED`; nothing is acquired and no generation is created.                                                                                                                                                                                                                        |
| A key opens an unopened durable copy                                                              | `202`; `retrieval`, `digest` and `decryption` all pass, the raw copy is replaced atomically with receiver-protected custody, and verification is queued.                                                                                                                                            |
| The stored copy cannot be read back                                                               | `202`; `STORED_COPY_UNAVAILABLE` with `retrieval`, `digest` and `decryption` all `not_run`, retryable only when the read failed transiently. "Transiently" means the read failed in a way that may clear, including a fault the reader could not classify at all, which is treated as transient rather than terminal to match the worker. The raw copy and its metadata are untouched.                                                                                                           |
| The stored copy has no recorded integrity digest, or one that cannot be read                      | `202`; `STORED_COPY_UNAVAILABLE`, not retryable, with `retrieval: pass` and the rest `not_run`. The copy came back and cannot be proven intact, so it is never opened.                                                                                                                              |
| The stored copy's digest does not match                                                           | `202`; `STORED_COPY_CORRUPT`, `retrieval: pass`, `digest: fail`, decryption `not_run`, raw custody retained and nothing uploaded.                                                                                                                                                                   |
| The stored copy opens with the wrong key                                                          | `202`; `DECRYPTION_FAILED`, retryable, `retrieval: pass`, `digest: pass`, `decryption: fail`, raw custody retained and nothing uploaded.                                                                                                                                                            |
| A no-copy source is fetched and the supplied key does not open it                                 | `202`; `DECRYPTION_FAILED`, retryable, `retrieval: pass`, `decryption: fail`, unless the store itself failed, in which case `STORAGE_FAILED` takes the code and its own retryability. The fetched ciphertext is kept as this record's durable copy only where the store succeeded and the record held neither a content identity nor a duplicate pointer; a record that already holds either of those skips the store, so nothing is retained and a later request fetches the source again. |
| A no-copy source is fetched and its envelope is corrupt                                           | `202`; `DECRYPTION_FAILED`, not retryable, unless the store itself failed, in which case `STORAGE_FAILED` takes the code and its own retryability. Where the ciphertext was retained as the durable copy, the message names an operator to inspect that copy; where no copy was retained, because the store failed or was skipped for an identity the record holds, it names the source, which has to change before any attempt can succeed. |
| The stored copy opens to a credential already held by another external record                     | `202`; custody is replaced and the record carries an advisory `DUPLICATE_CONTENT` warning naming the current holder.                                                                                                                                                                                |
| A no-copy source opens the credential and is stored                                               | `202`; custody, identity and details are replaced, and a pending generation is queued. Two bodyless requests racing this way join one reservation; only the winner fetches.                                                                                                                         |
| A no-copy source opens a credential already held elsewhere                                        | `202`; the new copy is queued and the record carries a `DUPLICATE_CONTENT` warning naming the current holder. The former identity's oldest advisory is promoted if the record recovering was its canonical holder.                                                                                  |
| A no-copy source does not open a credential, and the record already holds an identity             | `202`; a failed generation is recorded, `SOURCE_NOT_CREDENTIAL` whenever the bytes were read and yielded no credential, including an envelope a supplied key opened to something else, `DECRYPTION_REQUIRED` for an envelope no key was supplied for, and `DECRYPTION_FAILED` for one a supplied key did not open, retryable for a wrong key and not retryable for a corrupt envelope. Custody, `contentDigest`, `duplicateOfRecordId` and details are left exactly as they were; nothing is stored, so there is no copy to orphan. |
| A no-copy source does not open a credential, and the record holds no identity                     | `202`; stored exactly as a fresh registration would store it (an unopened envelope keeps `DECRYPTION_REQUIRED` when no key was supplied and `DECRYPTION_FAILED` when one was and did not open it; any other body settles like registration's own non-credential row), `EXTRACTION_PENDING` details, or `EXTRACTION_FAILED` if extraction itself failed. A store that fails settles `STORAGE_FAILED` with its own retryability instead, and nothing is retained. |
| A no-copy record's identity changed while its source was being fetched                            | `202`; the reservation settles `FAILED VERIFICATION_UNAVAILABLE` (retryable) naming the identity change. Custody, identity and details are untouched, and a later re-verify fetches again.                                                                                                          |
| A no-copy source cannot be fetched at all                                                         | `202`; a failed `RETRIEVAL_FAILED` generation is recorded, with `sourceChanged: null` when an earlier source digest existed. Name, issuer, subject, validity, type and `detailsStatus` are left unchanged, whatever they held before this attempt.                                                  |
| A recovery reaches the storage encryption preflight and it fails                                  | `500 CREDENTIALS_ENCRYPTION_UNAVAILABLE`; the reserved generation is settled `FAILED STORAGE_FAILED` before the response, in either acquisition mode.                                                                                                                                               |
| The job queue will not start before a recovery acquires anything                                  | `202`; the reservation settles `FAILED VERIFICATION_UNAVAILABLE` (retryable), naming the queue. Nothing is acquired or stored. This `202` holds only once that settle write itself commits; if it does not, the reservation stays `PENDING` and the sanitised `500` is answered instead.            |
| Concurrent recoveries of the same content keep moving the lock set past the bounded restart       | `202`; the reservation settles `FAILED VERIFICATION_UNAVAILABLE` (retryable) naming a moving identity set. Answered the same way once that settle write commits; an unconfirmed settle answers the sanitised `500` instead. A later re-verify tries again against whatever the set looks like next. |
| A key-bearing recovery never returned, and the sweep settled its reservation                      | `VERIFICATION_UNAVAILABLE` (retryable) on the abandoned generation, whose message names the key-bearing form, because the record still holds its unopened copy and a bodyless re-verify of it is refused.                                                                                           |
| The record moved while the request was being prepared                                             | `202`; no new generation is created and the record's current generation is returned, settled or pending. For a recovery reservation, this request reports that reservation as `superseded` rather than attaching to it; the run keeps whatever state actually settled it.                           |

The freshness comparison is separate from verification of the pinned copy. A source outage therefore does not set the generation's `retrieval` check to `fail`. It records instead that freshness was not checked. Mode A compares a successful re-fetch with an earlier `sourceDigest` when one exists. The freshness fields appear only on a settled external generation that attempted the comparison. For a protected copy (step 8), `lastSourceCheckAt` is stamped when the source fetch starts, which happens before the generation is created, so it can precede the generation's `requestedAt` by however long that fetch took. For a mode A recovery, the ordering is fixed rather than variable: `requestedAt` is stamped inside the reservation transaction, and `lastSourceCheckAt` is stamped afterwards, once the job queue is readied and just before the fetch itself runs, so `lastSourceCheckAt` can only follow `requestedAt`, by however long that reservation-and-queue-preparation interval took, never by the fetch's own duration. Mode B never reads the source, so it never writes a new `sourceDigest`, `sourceChanged` or `lastSourceCheckAt`.

The accepting `202` is the record's current envelope. The generation settled by this request is visible there unless a later generation has already replaced it, in which case the response shows the later generation's current `hasKey` and custody state. The detail route exposes only the newest envelope, so callers that need to act on the current state should use that state rather than assuming the request's generation remains current.

## Delete a library record

```
DELETE /api/v1/library/{id}
```

This removes an external record owned by the caller's tenant. It is allowed in any verification or custody state, including a pending verification, a record with no durable copy and a no-copy record that still holds a content identity. The record, its verification history and its registration claim are removed together. A replay of the record's original registration key after deletion registers afresh, and a replay that races the delete can return `409 IDEMPOTENCY_KEY_RECORD_DELETED`.

A native record is a read-only view of a credential issued by this service. It returns `403 NATIVE_CREDENTIAL_NOT_DELETABLE` and the message `This is a native credential record; it cannot be removed from the library.` An id that is absent, was already deleted, or belongs to another tenant, whether native or external, returns the same empty `204`. Repeating a successful delete is therefore safe. The deleted record is absent from subsequent list and detail reads.

Deleting a library record never revokes or otherwise affects the credential at its source. Verification already in progress is not cancelled. It may finish or be retried, but it cannot restore the deleted record. A run that settles after its record has gone is recorded as missing and nothing is recreated.

The database deletion is complete once its transaction commits. The Reference Implementation then attempts to delete the durable copy named on that row, using the service instance, object id and bucket recorded there, and answers once that attempt has finished. It is the copy the row names that is deleted, and only that one: a raw ciphertext object retired by an earlier key-bearing recovery is no longer named by the row, and that recovery removed it at the point it was retired, as [Re-verify a library record](#re-verify-a-library-record) describes. The response is `204` whether or not it succeeds: a missing object, an unreachable storage service, or a row whose recorded coordinates are incomplete all leave the record deleted and the copy, if any, in place for an operator-run sweep, which this release does not install. The operator sees each such case as a warning carrying the recorded coordinates. A missing stored object cannot resurrect the database record, and the route never chooses a storage instance the row did not name.

When the deleted record held a content identity and advisory records point at it, the oldest of those advisory records takes the identity and the rest are repointed at it. The promoted record gains the identity and loses its own pointer, and its last-modified time changes, as does the last-modified time of every record repointed at it. No durable copy is moved or altered by the promotion. Only the copy the deleted holder's row named is cleaned.

Responses:

- `204` with no body, in four indistinguishable cases: the record was deleted by this call, was deleted earlier, never existed, or exists only in another tenant (whatever its origin there).
- `401` when the request carries no valid token, as on every library operation.
- `403 NATIVE_CREDENTIAL_NOT_DELETABLE` for a native record in the caller's tenant, with the message `This is a native credential record; it cannot be removed from the library.` Authentication can separately answer the shared tenant-assignment refusal.
- Sanitised `500` when the transaction failed and rolled back, or when its commit outcome could not be confirmed. Nothing was partially deleted in the first case, and the request is safe to repeat in both. After an uncertain commit a repeat answers whatever the record's state now warrants: `204` once an external record is gone, whether that earlier attempt committed or not, or `403` for a native record. While the underlying fault persists, a repeat answers this `500` again.
