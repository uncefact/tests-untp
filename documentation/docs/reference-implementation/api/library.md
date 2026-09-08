---
sidebar_position: 8
title: Library
---

# Library API

The library holds every credential a tenant has, whether the tenant issued it through this Reference Implementation or received it from someone else. A record for a credential the tenant issued is a **native** record. A record for a credential received from a third party is an **external** record: the tenant gives the credential's location, the Reference Implementation fetches it, checks it, and keeps its own copy, so the credential is still available if the supplier later takes it offline.

This page covers registering an external credential, retrieving one record and re-verifying a record. Listing, annotating and deleting records are separate operations that arrive with the rest of the library epic.

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

For an external record with a protected durable copy, re-verification also checks the supplier source against the stored `sourceDigest`. A settled generation includes `sourceChanged` and `lastSourceCheckAt` when that comparison was attempted. `sourceChanged` is `false` when the source is unchanged, `true` when it differs and `null` when the source could not be checked. These fields are absent from a pending envelope.

### What each outcome looks like

The table below is the register call's branch matrix. Every row that creates a record answers `201` with the record; the rows that create nothing answer with the error shown.

| What happened                                                                                                                   | Answer | Record | Durable copy                                             | `verification`                                                                                                                                     | `encrypted` / `hasKey` |
| ------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| The URL is malformed, not http(s), or points at a private address                                                               | `400`  | no     | no                                                       | none                                                                                                                                               | none                   |
| The source could not be reached (DNS, timeout, 408, 429, 500, 502, 503, 504)                                                    | `201`  | yes    | no                                                       | `failed`, `RETRIEVAL_FAILED`, `retryable: true`                                                                                                    | `null` / `false`       |
| The source refused (any other status, too many redirects, too large)                                                            | `201`  | yes    | no                                                       | `failed`, `RETRIEVAL_FAILED`, `retryable: false`                                                                                                   | `null` / `false`       |
| The source is encrypted and no key was supplied                                                                                 | `201`  | yes    | the ciphertext, exactly as fetched                       | `failed`, `DECRYPTION_REQUIRED`, `retryable: true`                                                                                                 | `true` / `false`       |
| The source is encrypted and the key did not open it                                                                             | `201`  | yes    | the ciphertext, exactly as fetched                       | `failed`, `DECRYPTION_FAILED`, `retryable: true`                                                                                                   | `true` / `false`       |
| The source is encrypted and its envelope is corrupt, so no key can open it                                                      | `201`  | yes    | the ciphertext, exactly as fetched                       | `failed`, `DECRYPTION_FAILED`, `retryable: false`                                                                                                  | `true` / `false`       |
| The opened signed credential is already registered as an external record in this tenant                                         | `409`  | no     | none created by the rejection, but see the note below    | none                                                                                                                                               | none                   |
| The copy could not be written to storage (for an unopened ciphertext too, in which case the message also names the key problem) | `201`  | yes    | no                                                       | `failed`, `STORAGE_FAILED`, `retryable: true`                                                                                                      | observed / `false`     |
| Fetched, opened if needed, extracted and stored                                                                                 | `201`  | yes    | yes                                                      | `pending`, then `complete` once the signature check settles                                                                                        | observed / `true`      |
| Fetched, but the body is not a signed credential                                                                                | `201`  | yes    | the body as fetched, encrypted by this service's storage | `pending`, then `complete` with `summary: not_conformant`                                                                                          | observed / `true`      |
| The signature check itself could not run                                                                                        | later  | yes    | yes                                                      | `pending`, then `failed`, `VERIFICATION_UNAVAILABLE`, `retryable: true`                                                                            | observed / `true`      |
| The stored copy could not be read back, or did not match its digest                                                             | later  | yes    | yes                                                      | `pending`, then `failed`: `STORED_COPY_UNAVAILABLE` with `retryable: false` when the copy is absent and `true` when storage was unreachable, or `STORED_COPY_CORRUPT` with `retryable: false` when it read back but failed its digest check | observed / `true`      |

The `409` row creates no durable copy of its own. A request that loses a race to another registration of the same credential may already have stored one before the database refused its record, which the register section describes under duplicate detection.

`retryable: false` means the same request, unchanged, will not succeed unless the source itself changes. `retryable: true` means a later attempt may succeed, whether unchanged (an outage cleared) or after a correction (the right key). It is a classification of what was observed, never a promise about the source.

### Encrypted sources

A supplier may publish a credential encrypted. Register accepts the key in `sourceEncryption.decryptionKey`. The key is used to open the fetched body for this one request and is then forgotten: it is never stored, never logged, never placed on the job queue and never returned. Serve this endpoint over HTTPS so the key is protected in transit.

When no key is supplied, or the key does not work, the Reference Implementation still keeps the credential. It stores the ciphertext exactly as fetched, with no key of its own, and the record says so: `encrypted: true`, `hasKey: false`, and a `failed` generation naming `DECRYPTION_REQUIRED` or `DECRYPTION_FAILED`. Re-verifying such a record is refused with `400 DECRYPTION_REQUIRED`, because that operation takes no body and this service holds no key that opens the copy. Supplying a key against a stored copy is tracked by [uncefact/tests-untp#958](https://github.com/uncefact/tests-untp/issues/958).

Most credentials are published in plain text and need no key at all; that is the ordinary case and it needs nothing extra. One odd combination is worth knowing about: if a caller sends a key and the fetched body turns out not to be encrypted, the call still succeeds. The key is simply not used, and the record carries a `DECRYPTION_KEY_UNUSED` warning so the caller can see it was never applied.

### Descriptive fields

`credential.name`, `credential.issuerName`, `credential.issuerDid`, `credential.subjectName`, `credential.subjectId`, `credential.validFrom` and `credential.validUntil` are read from the signed artefact the moment it is in hand, on the same terms as a credential this Reference Implementation issues. `detailsStatus` says whether that read has happened: `EXTRACTED` once it ran (so a `null` field is a real absence), `EXTRACTION_PENDING` while the artefact has not been reached (a failed fetch, an unopened ciphertext), `EXTRACTION_FAILED` when it was reached and could not be read, with `detailsError` saying why. `credential.credentialType` is the core UNTP type the artefact names; when it disagrees with the `declaredCredentialType` the caller supplied, the record carries a `DECLARED_TYPE_MISMATCH` warning rather than failing.

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

The record contract also publishes a `DUPLICATE_CONTENT` warning. It is reserved for content found to match after a record already exists, which happens when a late key opens a stored ciphertext or a re-verification re-reads a source, so no record returned by this version of the Reference Implementation carries it.

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
5. An external record without a durable copy is not supported in this release and returns a sanitised `500` until the recovery branch lands.
6. An external record holding unopened ciphertext has `encrypted: true` and no usable receiver-side key. It returns `400 DECRYPTION_REQUIRED` and creates no generation.
7. For an external record with a protected copy, the supplier source is checked for freshness in the request, then the generation is created and the worker reads the pinned copy.
8. A record whose durable copy or newest generation moved while the request was being prepared starts no new generation. The request returns `202` with the record's current generation, which may already be settled.

Every accepted request returns `202` with the current keyless record. It may already show `complete` or `failed` when the worker settles the generation before the response is read. Re-poll the detail route to observe the final state. A stored-copy loss is discovered by the worker and settles as `STORED_COPY_UNAVAILABLE` when the copy cannot be read back as the document that was stored, or `STORED_COPY_CORRUPT` when it reads back but fails its digest check. The generation carries `retryable: false`, while the record's custody coordinates and `hasKey` remain unchanged.

One case is not observable on that poll. When the service cannot unlock the key it holds for the durable copy, the generation settles as `STORED_COPY_UNAVAILABLE` with `retryable: true`, and the detail route returns the sanitised `500` described above until an operator restores access to the encryption key. That gap is tracked by [uncefact/tests-untp#769](https://github.com/uncefact/tests-untp/issues/769).

| Situation                                                 | Response and verification result                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Native re-verification has created generation 2           | `202`; `verification` is `pending`, generation `2`, and `retrieval`, `decryption` and `digest` shown as `not_run`.                              |
| A second request arrives while that generation is pending | `202`; the same pending generation is returned and no second job is created.                                                                    |
| The protected supplier source differs from `sourceDigest` | `202`; the settled external generation carries `sourceChanged: true` and the pinned `storageUri` stays unchanged.                               |
| The protected supplier source is unchanged                | `202`; the settled external generation carries `sourceChanged: false`.                                                                          |
| The supplier source cannot be checked                     | `202`; the settled external generation carries `sourceChanged: null` and a non-null `lastSourceCheckAt`.                                        |
| The pinned durable copy is proven absent or corrupt       | `202`; the worker settles `STORED_COPY_UNAVAILABLE` (absent) or `STORED_COPY_CORRUPT` (digest mismatch) with `retryable: false`, and the next request reads the same custody tuple again. |
| An external record has no durable copy                    | Sanitised `500` in this release. The re-fetch branch will retry the source and report its outcome once the shared recovery helper is available. |
| The record moved while the request was being prepared     | `202`; no new generation is created and the record's current generation is returned, settled or pending.                                        |

The freshness comparison is separate from verification of the pinned copy. A source outage therefore does not set the generation's `retrieval` check to `fail`. It records instead that freshness was not checked. The freshness fields appear only on a settled external generation that attempted the comparison. `lastSourceCheckAt` is stamped when the source is fetched, which happens before the generation is created, so it can precede the generation's `requestedAt` by however long that fetch took.
