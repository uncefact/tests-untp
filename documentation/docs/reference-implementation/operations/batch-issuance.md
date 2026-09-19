---
sidebar_position: 12
title: Batch issuance
---

# Batch issuance

An issuer can submit many credential requests at once to `POST /api/v1/credentials/batches` and poll one status resource while they are issued. The [Credentials API page](../api/credentials#batch-issuance) describes the request and the response. This page is for the person running the deployment.

The work itself belongs to the worker. The web process writes the batch, the encrypted item requests and the first `credentials.issue-batch` job in one database transaction. The worker then issues one item at a time, records each outcome, and queues a continuation before its job budget runs out. A continuation is ordinary progress, not a retry.

Three queues are involved. `credentials.issue-batch` carries the issuance work. `credentials.reconcile-batches` picks up a batch whose job vanished, and runs on the same schedule as the library reconciliation sweep, `LIBRARY_RECONCILE_PENDING_RUNS_CRON`, every ten minutes by default. `credentials.expire-batches` deletes retained item data and runs every `BATCH_EXPIRY_SWEEP_MINUTES`, hourly by default.

The settings sit with the other boot-validated settings on the [Startup page](./startup#batch-issuance-settings). The first job uses the web process's `WORKER_JOB_TIMEOUT_SECONDS`; continuations use the worker process's value, so keep that setting identical in both roles when the same job budget is required.

`BATCH_SETTLEMENT_ALLOWANCE_MS` holds time back for the checkpoint write, while `BATCH_MINIMUM_ITEM_COST_MS` sets the floor for the running item-cost estimate and the first item in a job. Raise the allowance when checkpoint commits are slow, or raise the minimum item cost when the provider chain is slow so the first item is not assumed cheap.

A batch issues its items one at a time. Items in flight across the deployment equal the number of worker containers multiplied by `BATCH_JOB_CONCURRENCY`. On an 8-vCPU host with the bundled VCKit and storage services, five to eight workers at concurrency 1 reached about 600 items per minute. More items in flight per issuer DID beyond about eight raised per-item latency and caused status-list lock timeouts that consume retry attempts. A deployment whose tenants issue under their own DIDs has independent locks and scales further than one that funnels every tenant through the system default DID.

## Routine monitoring

Poll the batch status resource returned by the submission. A healthy batch moves from `QUEUED` through `RUNNING` to `COMPLETED`. A failed item is a definitive refusal of that one item and does not stop the rest of the batch.

A growing `credentials.issue-batch` queue means work is arriving faster than the configured `BATCH_JOB_CONCURRENCY` allows, or a dependency is faulting. That setting controls how many batches one worker process runs at once. It never makes the items inside a batch concurrent.

The reconciliation sweep looks at batches that are still `QUEUED` or `RUNNING` and whose last progress is older than twice `WORKER_JOB_TIMEOUT_SECONDS`. Before it acts it asks the queue whether an issuance job for that batch is still active, retrying or scheduled. Only when there is none does it take the ownership fence and queue a continuation. It never fails an item merely because a queue job disappeared.

## `NEEDS_ATTENTION`

`NEEDS_ATTENTION` means nothing is left to run, but at least one item is `OUTCOME_UNKNOWN`. The state is deliberately cautious. A worker may have signed and published a credential and then crashed before it could record that outcome, so the system will not guess either way. An item whose attempt was interrupted, such as when a worker stopped or a job timed out, is also recorded as `OUTCOME_UNKNOWN` by the takeover whether or not the request had been sent.

The operator commands use these arguments:

| Argument                           | Command | Meaning                                                                                                                                                    |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--tenant TENANT`                  | Both    | Tenant that owns the batch.                                                                                                                                |
| `--batch BATCH`                    | Both    | Batch to inspect or resolve.                                                                                                                               |
| `--index=<n>`                      | Both    | Zero-based item index. Use the equals form when the value begins with `-`; `--index -1` is ambiguous to Node's argument parser.                            |
| `--version=VERSION`                | Resolve | Batch version returned by inspection. Use the equals form when the value begins with `-`; `--version -1` is ambiguous to Node's argument parser.           |
| `--issued CREDENTIAL_ID`           | Resolve | Resolve the item as issued. Use exactly one of this and `--failed`.                                                                                        |
| `--failed --evidence EVIDENCE_REF` | Resolve | Resolve the item as failed and retain the evidence reference. A blank value is refused as `--evidence is required` before the repository is called.        |
| `--reason TICKET`                  | Both    | Optional investigation reason for inspection. Required for resolution; a blank value is refused as `--reason is required` before the repository is called. |
| `--disclose-request`               | Inspect | Print the decrypted item request after the access audit line.                                                                                              |
| `--dry-run`                        | Resolve | Show the proposed resolution and roll back the database change.                                                                                            |

A NUL character in a value for `--tenant`, `--batch`, `--reason`, `--issued` or `--evidence` is refused as `--<name> must not contain a NUL character`. The `--index` and `--version` flags refuse a non-integer with their own message.

Start with the durable recovery record for the unknown item. From a source checkout, in `packages/reference-implementation`:

```bash
pnpm batch:inspect-item -- --tenant TENANT --batch BATCH --index=INDEX [--reason TICKET]
```

The published image carries no package manifest for the Reference Implementation, so inside the image run the script directly:

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/inspect-credential-batch-item.ts \
  --tenant TENANT --batch BATCH --index=INDEX [--reason TICKET]
```

Both maintenance commands derive their database connection from the `RI_POSTGRES_*` variables already present in the container, so either runs under `exec` as well as `run`.

The command prints the item state, the batch state and version, the timestamps, any recorded error, the known `credentialId`, the issuer-supplied item `reference` when set, the batch request digest, `batchCorrelationId` and the derived `itemCorrelationId`, or the batch-and-index fallback when the item id is not derivable. It is scoped to one tenant and it does not print the stored request. Inspect `--reason` is optional and defaults to `item inspection`; it is written to the `Credential batch operator audit` log line so a later reader can identify the investigation and ticket. This matters because `--disclose-request` prints the decrypted request.

Search every service's logs and traces, including the Reference Implementation, worker, storage service, identity resolver and VCKit, for `itemCorrelationId`. Search the worker logs for `batchCorrelationId` as well when following the batch-level claim, checkpoint and settlement lines. When supplied, the inbound `x-correlation-id` becomes the batch's durable identity and the operator's log key; the reconciliation sweep runs each re-enqueued batch under the batch's id rather than the sweep's own.

The inspect command exits non-zero when its arguments are invalid, when the tenant-owned batch or item is missing, or when the inspection or the disclosure cannot complete; the printed line names the cause. The resolve command prints an outcome word and exits non-zero on every repository refusal: `missing`, `not-settled`, `version-mismatch`, `item-missing`, `not-unknown`, `credential-recorded`, or `credential-not-found`. `reason-missing` and `evidence-missing` are repository outcomes, not words printed by the command. A blank `--reason` or `--evidence` is refused as `--<name> is required` before the repository is called.

Add `--disclose-request` only when an investigation genuinely needs the original request. The access audit line is written before any plaintext is printed.

A late worker write can appear after inspection. It advances the batch version, so a resolution using the inspected version is refused; if the item now carries a credential id, the resolution also returns `credential-recorded` without changing it. Treat the absence of a credential as evidence of failure only after the former attempt can no longer produce an effect.

If the item carries a `credentialId`, look at that record in the tenant's library first. When the investigation shows the credential exists, resolve the item as issued:

```bash
pnpm batch:resolve-item -- --tenant TENANT --batch BATCH --index=INDEX --version VERSION --issued CREDENTIAL_ID --reason TICKET [--dry-run]
```

Inside the published image, use the script path with the maintenance steps disabled:

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/resolve-credential-batch-item.ts \
  --tenant TENANT --batch BATCH --index=INDEX --version VERSION --issued CREDENTIAL_ID --reason TICKET [--dry-run]
```

When the evidence shows no credential was created, resolve it as failed:

```bash
pnpm batch:resolve-item -- --tenant TENANT --batch BATCH --index=INDEX --version VERSION --failed --evidence EVIDENCE_REF --reason TICKET [--dry-run]
```

The published image form is:

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/resolve-credential-batch-item.ts \
  --tenant TENANT --batch BATCH --index=INDEX --version VERSION --failed --evidence EVIDENCE_REF --reason TICKET [--dry-run]
```

`VERSION` is the batch version the inspection printed. The resolution is fenced on it, so a resolution written against a stale version is refused rather than applied. Resolution never queues issuance, and it refuses a credential belonging to another tenant or an item that is no longer unknown. Both commands print the state before and after, and `--dry-run` rolls the change back after showing what it would have done.

The `--evidence` value stays on the item record as the audit trail for operators. The inspection command prints it as the stored error. Inspect `--reason` is optional and defaults to `item inspection`; resolve `--reason` is required and is persisted on the item as `resolutionReason`, with its timestamp. The tenant sees the code `OPERATOR_CONFIRMED_FAILED` and a fixed message instead.

Inspection and resolution audit lines are emitted at `warn`, so keep `LOG_LEVEL=warn` or a more verbose level for these commands. Request disclosure refuses to print plaintext when `LOG_LEVEL=error`, because that setting filters the required audit line.

### Faults and deferred batches

A fault affecting every item, such as an unusable data encryption key, no longer fails the job; each item is retried up to `BATCH_JOB_RETRY_LIMIT` (default `4`) fault attempts with a doubling backoff that starts at `BATCH_JOB_RETRY_BACKOFF_SECONDS` (default `30` seconds) and is capped at `BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS` (default `600` seconds). Each retried item attempt allocates a fresh status-list index set on the VC service, and failed attempts' indices are never reclaimed, so one item costs at most `BATCH_JOB_RETRY_LIMIT` sets. The batch settles with those items `FAILED`, so an operator watching for failed jobs should watch the batch counts instead. A batch parked at the top of the backoff ladder is protected from the reconciliation sweep only by its pending delayed job.

A status-list mint failure is a pre-dispatch fault: the item ladder retries it and settles the item as `FAILED`, never `OUTCOME_UNKNOWN`.

There is no cancellation, and an unknown item is never replayed automatically. Do not edit counters or item state by hand, because that breaks the attempt-token fence and the audit trail.

## Retention

A batch that completes normally is retained for `BATCH_RETENTION_DAYS` from `settledAt`, thirty days by default.

A `NEEDS_ATTENTION` batch has no expiry deadline while any item is still unknown, so its encrypted request evidence is kept for the investigation. When the last unknown item is resolved the batch becomes `COMPLETED` and a fresh retention window starts from `resolvedAt`.

The sweep only expires a `COMPLETED` batch that is past its deadline. It deletes the batch's items, which is where the encrypted requests and the per-item outcomes live, and leaves an `EXPIRED` tombstone holding the submission key, the body digest and the counts. The status resource then answers `410`. Issued credentials in the library are not touched by batch expiry.
