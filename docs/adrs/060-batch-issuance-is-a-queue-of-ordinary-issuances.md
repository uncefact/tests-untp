# ADR-060: Batch issuance is a queue of ordinary issuances

- **Date:** 2026-09-17
- **Status:** proposed

Update (2026-09-19): The hook classifies the fault of an attempt that is still running: a caught fault before the hook takes the item ladder, a fault after it settles the item as `OUTCOME_UNKNOWN`, and an attempt interrupted before it settles is taken over as `OUTCOME_UNKNOWN` whatever point it had reached, because the takeover has no evidence either way.

Update 2026-09-18: Decisions 4 to 7 now include cancellation (#1080). A tenant-authenticated bodyless cancel request atomically cancels queued items and returns 202 with the projection and a non-revocation warning; the current attempt may still issue. Claims and continuation checkpoints respect cancellation, and recovery settles without enqueueing issuance. Settlement gives unknown outcomes NEEDS_ATTENTION, then positive cancelled counts CANCELLED, otherwise COMPLETED; resolution uses the same rule. CANCELLED follows completed-batch retention and expiry. GET includes counts.cancelled and cancelRequestedAt. Settled batches refuse cancellation with 409 BATCH_NOT_CANCELLABLE, expired batches with 410 and missing or foreign batches with 404. Workers must be upgraded before the route is exposed.

Update 2026-09-17: `NEEDS_ATTENTION` batches are held until each unknown item is resolved through the audited operator command; resolution is fenced by the batch version, never enqueues issuance, and starts a fresh retention window only when the last unknown is resolved. The audited item inspection command exposes identifiers by default and requires explicit `--disclose-request` before it prints the decrypted request.

Update 2026-09-17: Decision 3's per-item recovery wording is replaced by attempt-token fencing. A previous `PROCESSING` item whose progress is older than the job budget becomes `OUTCOME_UNKNOWN` and is never re-issued automatically; the worker does not promise that an external issuance was completed without repetition.

Update 2026-09-18: The external-effect boundary is the `onDispatch` hook immediately before the ordinary issuance use case, and service-instance absence is a definitive refusal while provider faults remain uncertain. Pre-dispatch faults stop retrying at the bounded item-attempt limit and settle as `FAILED` with `ITEM_ATTEMPTS_EXHAUSTED`. Batch submission applies the single-issuance `credentialStatus` refusal to the whole request before issuance.

Update 2026-09-18: Batch submission uses `MAX_BATCH_REQUEST_BODY_BYTES` (default 50 MiB) for the raw batch body, requires it to be at least `MAX_REQUEST_BODY_BYTES`, and keeps each serialised item within `MAX_REQUEST_BODY_BYTES`; the web boot validator and indexed 400 or 413 responses name the applicable bound.

Update 2026-09-18: Pre-dispatch faults use per-item backoff with never-attempted items preferred over deferred retries; the worker continues through claimable items and schedules the next job for the earliest deferred item. Post-dispatch faults still use queue retry for outcome recovery.

Update (2026-09-19): The external-effect boundary is now the credential request inside the VC adapter's `sign`, immediately before it is sent. Status-list minting is a pre-dispatch fault, so the item ladder retries it and settles it as `FAILED`; only a fault from the credential request onwards can settle `OUTCOME_UNKNOWN`. Each retried item attempt allocates a fresh status-list index set on the VC service, and failed attempts' indices are never reclaimed, so one item costs at most `BATCH_JOB_RETRY_LIMIT` sets.

Update (2026-09-19): A batch item may carry a caller-supplied `reference`, unique within the batch, stored beside the encrypted request and echoed on status; it is omitted when not supplied and is removed with the item at expiry.

Update (2026-09-19): The batch stores its submission correlation id, each item runs under a derived per-item correlation id, and a job payload may carry the batch correlation id for re-enqueues raised outside the batch's request context.

Update (2026-09-19): The worker budget can be tuned with `BATCH_SETTLEMENT_ALLOWANCE_MS` and `BATCH_MINIMUM_ITEM_COST_MS`; the allowance is checked against the job timeout at worker boot. `BATCH_JOB_RETRY_LIMIT` (default `4`), `BATCH_JOB_RETRY_BACKOFF_SECONDS` (default `30`) and `BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS` (default `600`) configure the shared queue retry and per-item fault ladder; both web and worker validate them at boot.

## Context

Issuance is one synchronous request per credential. Issuers certifying a product range run that loop themselves, and every one of them rebuilds retry, progress and result collection. The reference implementation has a Postgres job queue and worker (ADR-054), idempotency claims (ADR-051), and a single callable issuance use case. A server-side batch can therefore be a durable ordered container around the existing issuance path.

Two properties decide the shape. A credential must not differ by how it was submitted, so the batch cannot be a second issuance path. An accepted batch must survive process death without issuing anything twice, so per-item progress and the request needed for the worker are durable and protected.

## Decision

1. **A batch is an ordered list of ordinary issuance requests.** The endpoint accepts an array of the exact per-credential body accepted by `POST /api/v1/credentials`. The boundary validates request shape, byte size, item count and non-empty input, and refuses the whole batch on any shape error. DID ownership, service resolution, JSON-LD and schema conformance remain per-item worker work. Item indices are zero-based and validation pointers use `items[<index>].<field>`. Ordering is promised within one batch only.

2. **Batch and item rows are the source of durable progress.** `CredentialBatch` stores tenant scope, the required idempotency key, raw-body digest, lifecycle state, counts, timestamps, attempt fencing and settlement retention. `CredentialBatchItem` stores one encrypted validated request and its state and outcome. The item request is tenant data stored encrypted under `DATA_ENCRYPTION_KEY`, like a queued job payload, and is deleted with the item at retention. The worker job carries only `{ batchId, tenantId }`.

3. **Submission idempotency belongs to the batch.** `(tenantId, idempotencyKey)` is unique on `CredentialBatch`. The same key and raw-body digest replay the same 202 response. The same key with a different digest returns 422. An expired batch remains as a tombstone and replays answer 410 `BATCH_EXPIRED`; it never creates a second issuance. The batch does not use the `IdempotencyKey` table, whose record link is reserved for library records. Items retain a nullable `attemptToken` for worker fencing; this is not a provider-side idempotency guarantee, so an interrupted `PROCESSING` item is taken over as `OUTCOME_UNKNOWN` and never re-issued automatically.

4. **The batch and its queue job commit together.** In one transaction the application inserts the batch, all items and the `credentials.issue-batch` job through `enqueueWithin`. The job has four capped retries for faults; normal budget exhaustion is a transactional continuation with the same batch. The records remain the source of truth for status.

5. **The worker owns item progression and settlement.** Item states are `QUEUED`, `PROCESSING`, `ISSUED`, `FAILED` and `OUTCOME_UNKNOWN`. Batch states are `QUEUED`, `RUNNING`, `COMPLETED`, `NEEDS_ATTENTION` and `EXPIRED`. Every item transition updates the stored batch counts in the same transaction. `COMPLETED` means every item is `ISSUED` or `FAILED`, including an all-failed batch. `NEEDS_ATTENTION` means at least one item is `OUTCOME_UNKNOWN` and nothing remains to run. Attempt tokens and versions fence duplicate deliveries and let reconciliation distinguish queued, active, stalled and absent work.

6. **Retention starts at settlement.** A settled batch receives `expiresAt = settledAt + BATCH_RETENTION_DAYS`. Expiry deletes items, including encrypted request bodies and outcomes, while retaining an `EXPIRED` batch tombstone with its key, digest and counts. `GET` on that tombstone returns 410 with the counts. Issued credentials are unaffected.

7. **Status is a tenant-scoped read of the batch rows.** `GET /api/v1/credentials/batches/{id}` reports the stored state, counts, timestamps and ordered item outcomes. It never reaches the queue. A missing or cross-tenant id is 404. There is no cancellation in this release. A batch runs to settlement.

## Consequences

Issuers get one submission and one polling resource with partial failure reported per item. The request body and the queue payload are protected from plaintext leakage, while the worker can load the exact validated request it must issue. Sequential work remains bounded by the existing worker budget and concurrency. A batch of hundreds can take minutes, so clients must poll and operators must monitor active and stalled work.

The additional tables, stored counters and fencing fields require migration and reconciliation discipline. An external effect can still be left uncertain by a worker crash after it commits upstream, so the worker's per-item claims and `OUTCOME_UNKNOWN` state must not be confused with exactly-once external effects.

## Alternatives considered

- **Fan out one job per item.** Rejected because it multiplies queue rows, loses the batch's ordering promise and makes batch state a derived aggregate.
- **Streaming upload.** Deferred because it changes the client contract. Several bounded batches provide a simpler first release.
- **Synchronous batch issuance.** Rejected because hundreds of items exceed reasonable request timeouts and hide progress.
- **All-or-nothing rollback.** Rejected because a signed credential, status entries and storage copy cannot be rolled back safely. Revocation is the issuer's decision.
- **The existing `IdempotencyKey` table for submission.** Rejected because its `recordId` must reference a library record, whereas a batch is a separate durable resource and must remain as an expiry tombstone.

## References

- ADR-024
- ADR-037
- ADR-051
- ADR-054
- ADR-060 planning artefacts: bulk issuance epic and stories B and C
