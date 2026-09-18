---
sidebar_position: 12
title: Batch issuance
---

# Batch issuance

An issuer can submit many credential requests at once to `POST /api/v1/credentials/batches` and poll one status resource while they are issued. The [Credentials API page](../api/credentials#batch-issuance) describes the request and the response. This page is for the person running the deployment.

The work itself belongs to the worker. The web process writes the batch, the encrypted item requests and the first `credentials.issue-batch` job in one database transaction. The worker then issues one item at a time, records each outcome, and queues a continuation before its job budget runs out. A continuation is ordinary progress, not a retry.

Three queues are involved. `credentials.issue-batch` carries the issuance work. `credentials.reconcile-batches` picks up a batch whose job vanished, and runs on the same schedule as the library reconciliation sweep, `LIBRARY_RECONCILE_PENDING_RUNS_CRON`, every ten minutes by default. `credentials.expire-batches` deletes retained item data and runs every `BATCH_EXPIRY_SWEEP_MINUTES`, hourly by default.

The settings sit with the other boot-validated settings on the [Startup page](./startup#batch-issuance-settings). The first job uses the web process's `WORKER_JOB_TIMEOUT_SECONDS`; continuations use the worker process's value, so keep that setting identical in both roles when the same job budget is required.

## Routine monitoring

Poll the batch status resource returned by the submission. A healthy batch moves from `QUEUED` through `RUNNING` to `COMPLETED`. A failed item is a definitive refusal of that one item and does not stop the rest of the batch.

A growing `credentials.issue-batch` queue means work is arriving faster than the configured `BATCH_JOB_CONCURRENCY` allows, or a dependency is faulting. That setting controls how many batches one worker process runs at once. It never makes the items inside a batch concurrent.

The reconciliation sweep looks at batches that are still `QUEUED` or `RUNNING` and whose last progress is older than twice `WORKER_JOB_TIMEOUT_SECONDS`. Before it acts it asks the queue whether an issuance job for that batch is still active, retrying or scheduled. Only when there is none does it take the ownership fence. For an ordinary batch it queues a continuation. For a cancellation-requested batch it converts abandoned processing to `OUTCOME_UNKNOWN` and settles without enqueueing issuance. It never fails an item merely because a queue job disappeared.

The reconciliation summary counts `settled` batches that reached a terminal state, `requeued` batches given a new issuance job, `superseded` batches whose ownership had changed, and `unsettled` batches whose settlement did not apply; `unsettled` is the outcome that needs a human.

## Cancellation

Upgrade every worker before exposing `POST /api/v1/credentials/batches/{id}/cancel`. An old worker does not check cancellation between items. Apply the migration and rollout order in the [v0.6 migration guide](../../migration-guides/ri-v0.6#batch-cancellation).

An issuer sends a bodyless POST to cancel a queued or running batch. Every queued item, including deferred retries, becomes `CANCELLED` atomically. The item already processing finishes its current attempt, and credentials already issued remain issued. The `202` response includes the batch projection and this message:

> Queued items are cancelled. An item already processing may still be issued. Cancellation does not revoke any credentials.

Poll GET for `counts.cancelled`, `cancelRequestedAt` and the ordered item outcomes. The timestamp is null before cancellation and otherwise contains the first request time as ISO 8601 text. While an item is processing the batch remains `RUNNING`. Once nothing is queued or processing, unknown outcomes take precedence as `NEEDS_ATTENTION`; otherwise a positive cancelled count gives `CANCELLED`, and zero cancelled gives `COMPLETED`. For example, cancelling a batch whose only remaining item is in flight can end `COMPLETED` with cancelled 0 if that item issues.

A repeated cancellation while the batch remains `QUEUED` or `RUNNING` returns `202` without another write. `COMPLETED`, `NEEDS_ATTENTION` and settled `CANCELLED` return `409 BATCH_NOT_CANCELLABLE`. Expired batches return `410 BATCH_EXPIRED` with the tombstone; unknown or foreign ids return `404`. The [API refusal table](../api/credentials#cancel-a-batch) gives the exact messages and body validation responses.

The worker claims no further item and queues no continuation after cancellation. Reconciliation still recovers cancellation-requested `QUEUED` or `RUNNING` batches whose job vanished. It records an abandoned processing item as unknown, then settles without enqueueing issuance. A duplicate delivery cannot resume cancelled work.

Resolve a held unknown item using the commands below. Cancellation does not resolve uncertainty about an external effect. Resolving the last unknown produces `CANCELLED` when cancelled items remain, otherwise `COMPLETED`; it never queues issuance.

## `NEEDS_ATTENTION`

`NEEDS_ATTENTION` means nothing is left to run, but at least one item is `OUTCOME_UNKNOWN`. The state is deliberately cautious. A worker may have signed and published a credential and then crashed before it could record that outcome, so the system will not guess either way.

Start with the durable recovery record for the unknown item. From a source checkout, in `packages/reference-implementation`:

```bash
pnpm batch:inspect-item -- --tenant TENANT --batch BATCH --index INDEX --reason TICKET
```

The published image carries no package manifest for the Reference Implementation, so inside the image run the script directly:

```bash
docker compose run --rm -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
  app node_modules/.bin/tsx scripts/inspect-credential-batch-item.ts \
  --tenant TENANT --batch BATCH --index INDEX --reason TICKET
```

The command prints the item state, the batch state and version, the timestamps, any recorded error, the known `credentialId` and the batch request digest. It is scoped to one tenant and it does not print the stored request. `--reason` defaults to `item inspection`, though a ticket reference is worth recording.

The inspect command prints the item and batch state; it exits non-zero only when the tenant-owned batch or item is missing. The resolve command prints an outcome word and exits non-zero on every refusal: `missing`, `not-settled`, `version-mismatch`, `item-missing`, `not-unknown`, `credential-recorded`, `reason-missing`, `credential-not-found`, or `evidence-missing`.

Add `--disclose-request` only when an investigation genuinely needs the original request. The access audit line is written before any plaintext is printed.

A late worker write can appear after inspection. It advances the batch version, so a resolution using the inspected version is refused; if the item now carries a credential id, the resolution also returns `credential-recorded` without changing it. Treat the absence of a credential as evidence of failure only after the former attempt can no longer produce an effect.

If the item carries a `credentialId`, look at that record in the tenant's library first. When the investigation shows the credential exists, resolve the item as issued:

```bash
pnpm batch:resolve-item -- --tenant TENANT --batch BATCH --index INDEX --version VERSION --issued CREDENTIAL_ID --reason TICKET [--dry-run]
```

Inside the published image, use the script path with the maintenance steps disabled:

```bash
docker compose run --rm -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
  app node_modules/.bin/tsx scripts/resolve-credential-batch-item.ts \
  --tenant TENANT --batch BATCH --index INDEX --version VERSION --issued CREDENTIAL_ID --reason TICKET [--dry-run]
```

When the evidence shows no credential was created, resolve it as failed:

```bash
pnpm batch:resolve-item -- --tenant TENANT --batch BATCH --index INDEX --version VERSION --failed --evidence EVIDENCE_REF --reason TICKET [--dry-run]
```

The published image form is:

```bash
docker compose run --rm -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
  app node_modules/.bin/tsx scripts/resolve-credential-batch-item.ts \
  --tenant TENANT --batch BATCH --index INDEX --version VERSION --failed --evidence EVIDENCE_REF --reason TICKET [--dry-run]
```

`VERSION` is the batch version the inspection printed. The resolution is fenced on it, so a resolution written against a stale version is refused rather than applied. Resolution never queues issuance, and it refuses a credential belonging to another tenant or an item that is no longer unknown. Both commands print the state before and after, and `--dry-run` rolls the change back after showing what it would have done.

The `--evidence` value stays on the item record as the audit trail for operators. The inspection command prints it as the stored error. The non-empty `--reason` is also persisted with the resolution and its timestamp. The tenant sees the code `OPERATOR_CONFIRMED_FAILED` and a fixed message instead.

Inspection and resolution audit lines are emitted at `warn`, so keep `LOG_LEVEL=warn` or a more verbose level for these commands. Request disclosure refuses to print plaintext when `LOG_LEVEL=error`, because that setting filters the required audit line.

### Faults and deferred batches

A fault affecting every item, such as an unusable data encryption key, no longer fails the job; each item is retried up to the attempt limit with backoff and the batch settles with those items `FAILED`, so an operator watching for failed jobs should watch the batch counts instead. A batch parked at the top of the backoff ladder is protected from the reconciliation sweep only by its pending delayed job.

An unknown item is never replayed automatically. An item that reached its attempt limit was already written `FAILED` with `ITEM_ATTEMPTS_EXHAUSTED` before cancellation; a later pre-dispatch fault becomes `CANCELLED` instead of retrying. Do not edit counters or item state by hand, because that breaks the attempt-token fence and the audit trail.

## Retention

A `COMPLETED` or `CANCELLED` batch is retained for `BATCH_RETENTION_DAYS` from `settledAt`, thirty days by default.

A `NEEDS_ATTENTION` batch has no expiry deadline while any item is still unknown, so its encrypted request evidence is kept for the investigation. When the last unknown item is resolved the batch becomes `CANCELLED` if cancelled items remain, otherwise `COMPLETED`, and a fresh retention window starts from `resolvedAt`.

The sweep only expires a `COMPLETED` or `CANCELLED` batch that is past its deadline. It deletes the batch's items, which is where the encrypted requests and the per-item outcomes live, and leaves an `EXPIRED` tombstone holding the submission key, the body digest and the counts. The status resource then answers `410`. Issued credentials in the library are not touched by batch expiry.
