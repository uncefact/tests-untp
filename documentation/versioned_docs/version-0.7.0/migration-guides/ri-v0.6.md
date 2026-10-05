---
sidebar_position: 1
title: Reference Implementation v0.6
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

This guide covers upgrading a Reference Implementation deployment from v0.5 to v0.6. A deployment already running v0.6.0 needs [Upgrading from v0.6.0](#upgrading-from-v060) and then [Upgrading from v0.6.1](#upgrading-from-v061). One already running v0.6.1 needs only [Upgrading from v0.6.1](#upgrading-from-v061).

:::warning[Before you upgrade]
Back up the Reference Implementation database before deploying v0.6. The
`20260916171436_credential_status_entries` migration adds captured status metadata and the
pending-deletion guard. Keep the backup when rolling back, and do not delete pending rows to
force a rollback.

Confirm that the service instances used for status operations are reachable and that the
deployment's status settings are ready before enabling mutation. See [Credential status
recovery](../reference-implementation/operations/credential-status-recovery) for the locking
boundary and recovery procedure.
:::

## Credential-status capture and status-operation guards

Newly issued credentials carry `statusListIndex` as an integer to match the published UNTP v0.7.0 schemas. The Bitstring Status List specification requires a string in base 10, while capture canonicalises either wire shape to a decimal string for stored status entries; revert the issued value to a string when the UNTP schema is corrected upstream. Previously issued credentials keep their numeric index and remain readable. A capture warning does not prevent issuance. The new `status` facts and capture state are visible on native library detail records; external records return no issuer-owned status facts.

New issuance defaults to the existing `revocation` purpose, and callers may request `revocation`, `suspension`, or both through `statusPurposes` when multiple purposes are enabled. The issuance default is configurable with `CREDENTIAL_STATUS_DEFAULT_PURPOSES`; leaving it unset keeps the built-in `revocation` default, while `none` alone issues without status entries. `CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED` defaults to `false`, so one status purpose is issued by default because UNTP v0.7.0 schemas accept one `credentialStatus` object. Set it to `true` to allow multiple purposes. A request with more than one status purpose otherwise returns `400 VALIDATION_FAILED`, and a multi-purpose `CREDENTIAL_STATUS_DEFAULT_PURPOSES` refuses web and worker boot until the opt-in is enabled.

When `CREDENTIAL_STATUS_DEFAULT_PURPOSES=none`, credentials issued without an explicit statusPurposes carry no status entry and can never be revoked or suspended.

Deleting `DELETE /api/v1/credentials/{id}` now returns `409 STATUS_OPERATION_IN_PROGRESS` while a credential status operation is pending. The caller must wait for the operation to complete or ask an operator to reconcile it before retrying. `PATCH /api/v1/services/{id}` and `DELETE /api/v1/services/{id}` also return `409 SERVICE_INSTANCE_STATUS_PENDING` when a pending status operation uses the service instance. The PATCH guard applies only when effective configuration changes. `force=true` on service deletion does not bypass this status-operation guard.

Run the `pnpm` forms from `packages/reference-implementation`; the packaged `docker compose` form needs no working directory.

After deployment, take the normal database backup and run `pnpm backfill:credential-status-entries`. Start with `--dry-run`, then run the write pass and review any reported failures. The job is conditional and idempotent. Once entries are present, run `pnpm backfill:credential-status-attribution --tenant <tenant-id> --instance <service-instance-id> --reason "historical service mapping"` for each operator-approved attribution. Use `--reassign` to reverse an operator assertion to the correct instance. Attribution is an operator assertion supported by bounded provider reads.

During a rolling upgrade, an older application version that reaches a new status-operation trigger sees an unmapped `500`, because it does not know the new conflict code. Drain status operations before rolling back. Do not delete captured rows during rollback. A later forward migration can resume from the recorded capture state.

## Credential-status management and library lifecycle

The issuer API now provides purpose-specific status PUT and reconcile POST routes, plus stored and fresh status GET. Read an entry's version and supply it as `If-Version`; missing or malformed values return `400 INVALID_IF_VERSION`, and successful status responses are `Cache-Control: no-store`. Revocation cannot be cleared. Clients must handle unconfirmed outcomes and explicitly reconcile, rather than treating a timeout as a failed change. See [Credential API](../reference-implementation/api/credentials#change-issuer-status) for responses and recovery semantics.

Library list and detail records add `lifecycle`, `status.statusCaptureError`, `capabilities.statusManageable`, `STATUS_CHANGE_UNCONFIRMED` and `ISSUER_STATUS_OBSERVATIONS_DIFFER`. Extend strict response decoders for these additive fields and warnings. Keep the verification `status` filter independent of `lifecycle`; `status=verified&lifecycle=none` does not establish present usability. See [Library API](../reference-implementation/api/library#issuer-lifecycle).

Deploy the additive `20260916171436_credential_status_entries` migration before the new application. Its existing `acceptedReplacementDigest` column supports configuration repair; no further migration is needed for these routes. Keep the migration and its pending-deletion trigger on rollback. The lock identity changes at process start for issuance and status operations. During a rolling deploy, the compatibility lock keeps old and new processes serialised while the new two-key identity is introduced. Stop admission and drain older writers before deploy as a safety measure. Complete capture and attribution backfills for historical credentials that need management.

On the web service, configure `CREDENTIAL_STATUS_OPERATION_BUDGET_MS` (default `30000`) and `CREDENTIAL_STATUS_RECONCILE_GRACE_MS` (default `5000`) if the deployment needs different allowances. Set `CREDENTIAL_STATUS_MUTATION_ENABLED=true` only after confirming that participating writes share the same coordination database and canonical provider identity. Both Compose definitions forward these settings to the web service only. No worker changes are required for credential-status operations. Batch cancellation requires the worker upgrade below. See [Startup](../reference-implementation/operations/startup#credential-status-operation-settings).

For rollback, disable new mutations, stop admission, drain and wait for provider quiescence, then reconcile every pending entry before returning to a version without reconciliation. Do not delete pending rows to force a rollback. If the pinned configuration is unusable, use `pnpm services:repair-config --instance <id> --config <json-file> --allow-pending`, then reconcile with explicit provider-change acceptance. The command refuses live reservations and preserves original pins and attribution. The [recovery runbook](../reference-implementation/operations/credential-status-recovery) is the operational procedure.

## Batch credential issuance

If your integration issues credentials in bulk by calling `POST /api/v1/credentials` many times in parallel, move it to the batch route. In v0.5 those calls ran independently. In v0.6 every single-route issuance acquires the status-list mutex so that status entries are captured consistently. A call that cannot acquire it within `CREDENTIAL_STATUS_LOCK_ACQUIRE_MS` (default 2000 ms) is refused with `503 STATUS_LIST_BUSY`, so a parallel bulk loop that worked on v0.5 now sees refusals under contention and has to retry them itself. A batch issues its items one at a time in the worker, and an item that meets the same contention is retried with backoff up to `BATCH_JOB_RETRY_LIMIT` before the batch is held for an operator, so the client submits once and polls for the outcome.

Before deploying v0.6, apply the `20260917000000_add_credential_batches` migration. It adds the `CredentialBatch` and `CredentialBatchItem` tables. Existing credentials are unchanged, and the new tables start empty.

Batch issuance requires the `ri-worker` deployment. The web role accepts a submission with `202` and records its items, but a deployment without `ri-worker` never issues those items. Upgrade and run the worker before sending batch submissions to the web role. Give the worker the same issuance settings as the web process, as described in [Upgrading from v0.6.0](#upgrading-from-v060).

The worker uses three queues: `credentials.issue-batch` carries issuance work, `credentials.reconcile-batches` recovers batches whose job has disappeared, and `credentials.expire-batches` removes retained batch data. The reconciliation sweep follows `LIBRARY_RECONCILE_PENDING_RUNS_CRON`, which defaults to every ten minutes. The expiry sweep follows `BATCH_EXPIRY_SWEEP_MINUTES`, which defaults to every 60 minutes.

Configure these batch settings before starting the deployment: `MAX_BATCH_ITEMS`, `MAX_BATCH_REQUEST_BODY_BYTES`, `BATCH_RETENTION_DAYS`, `BATCH_EXPIRY_SWEEP_MINUTES`, `BATCH_JOB_RETRY_LIMIT`, `BATCH_JOB_RETRY_BACKOFF_SECONDS`, `BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS`, `BATCH_SETTLEMENT_ALLOWANCE_MS`, `BATCH_MINIMUM_ITEM_COST_MS` and `BATCH_JOB_CONCURRENCY`. The [batch issuance settings](../reference-implementation/operations/startup#batch-issuance-settings) table gives their defaults, readers and validation rules. `MAX_BATCH_REQUEST_BODY_BYTES` must be at least `MAX_REQUEST_BODY_BYTES`. Each item's compact re-serialised JSON remains bounded by `MAX_REQUEST_BODY_BYTES`; this per-item value is measured after parsing, while the whole-request limit measures submitted bytes.

`POST /api/v1/credentials/batches` requires an `Idempotency-Key`; a missing, blank, over-length or non-printable key returns `400 VALIDATION_FAILED`. Reusing it with a different request body returns `422 IDEMPOTENCY_KEY_MISMATCH`; after retention, replaying the key returns `410 BATCH_EXPIRED`. Accepted and replayed `202` responses, as well as status and expired responses, carry `Cache-Control: no-store`. `COMPLETED` and `CANCELLED` batches are retained for `BATCH_RETENTION_DAYS` from settlement. A `NEEDS_ATTENTION` batch has no expiry deadline until its last unknown item is resolved, which starts a fresh retention window. The expiry sweep tombstones due batches as `EXPIRED`; only then does replay return `410 BATCH_EXPIRED`.

If a batch reaches `NEEDS_ATTENTION`, inspect the held item with `batch:inspect-item` and resolve it with `batch:resolve-item`. The [batch issuance runbook](../reference-implementation/operations/batch-issuance) describes the recovery procedure and the required evidence.

## Batch cancellation

Before exposing the cancellation route, apply `20260918120000_credential_batch_cancel` and upgrade every worker. An old worker does not check cancellation between items, so a mixed worker deployment cannot uphold the cancellation contract.

1. Keep the cancellation route unavailable while applying the migration. It adds `CANCELLED` to batch and item states, `cancelledCount` and `cancelRequestedAt`, and updates the counter constraints. Existing batches start with cancelled 0 and a null cancellation timestamp.
2. Stop and drain older workers, then start only the upgraded workers. Complete this step before enabling access to the new web route.
3. Deploy or expose the web route. Update strict client decoders for `CANCELLED`, `counts.cancelled` and nullable ISO 8601 `cancelRequestedAt` in batch projections, including expiry tombstones.

`POST /api/v1/credentials/batches/{id}/cancel` takes no body and returns `202` with the batch projection and this message:

> Queued items are cancelled. An item already processing may still be issued. Cancellation does not revoke any credentials.

An active repeated request returns `202` unchanged. Settled `COMPLETED`, `NEEDS_ATTENTION` and `CANCELLED` batches refuse cancellation with `409 BATCH_NOT_CANCELLABLE`. Expiry returns `410 BATCH_EXPIRED` with the tombstone. Unknown or foreign ids return `404`. Non-empty bodies, including `{}`, return `400`; the bounded reader retains its unreadable-body and oversized-body responses. See the [API reference](../reference-implementation/api/credentials#cancel-a-batch) for exact response messages.

A cancellation-requested batch remains `RUNNING` while its current attempt finishes. Unknown outcomes hold it in `NEEDS_ATTENTION` until resolved. With no unknown outcome, it settles `CANCELLED` when cancelled items remain, otherwise `COMPLETED` with cancelled 0. Recovery settles cancelled work without enqueueing issuance, and settled `CANCELLED` batches follow the existing retention and expiry policy. See the [operations page](../reference-implementation/operations/batch-issuance#cancellation).

This migration adds `CANCELLED` to the batch and item state enums. PostgreSQL cannot remove an enum value, so rows carrying `CANCELLED` remain after any application rollback. An application release whose generated Prisma client predates `CANCELLED` may fail to read a batch or item row carrying it. Keep this migration in place, and do not roll back to a release whose generated Prisma client lacks `CANCELLED` until cancellation admission has stopped, in-flight work has drained, and a database check confirms that no batch or item row carries `CANCELLED`; expiry deletes item rows but retains `EXPIRED` batch tombstones, and retaining the migration alone does not make an older application compatible. A release whose client includes the value avoids the incompatibility.

## Upgrading from v0.6.0

In v0.6.0 the worker issues batch items with the same code as `POST /api/v1/credentials`, but the worker services in the Compose files shipped with v0.6.0 were not given five settings that code reads. A worker given them in its own environment followed them. Without them, a batch item could fail, or come out differently, where the same request on the single route succeeded:

- `RI_APP_URL`: an item with `publish: true` and no `humanVerificationUrl` failed every attempt and ended `ITEM_ATTEMPTS_EXHAUSTED`, with an error that did not name `RI_APP_URL`.
- `CREDENTIAL_STATUS_DEFAULT_PURPOSES`: the worker used the built-in `revocation` default whatever the web process was configured with, without a warning.
- `FETCH_ALLOW_PRIVATE_URLS`: the worker refused a private verification URL that the single route accepted with the setting at `true`.
- `CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED`: the worker refused an item asking for more than one status purpose, even with the setting at `true`.
- `CREDENTIAL_STATUS_LOCK_ACQUIRE_MS`: the worker ignored the configured value and waited the 2000 ms default for the status-list lock.

Both Compose worker services now receive these settings with the same value as the web service. The worker's boot preflight checks them with the web process's rules, and it requires `RI_APP_URL`. The [Worker page](../reference-implementation/operations/worker#worker-settings) lists each setting and its checks.

If you override `RI_APP_URL`, the private-URL setting or a status issuance setting for `ri`, override it for `ri-worker` with the same value. Compose merges `environment` per service, so an override file that changes `ri` alone leaves the worker on the value in `docker-compose.yml`. Both services set `RI_APP_URL` to the literal `http://localhost:3003` there, and a value in `.env` does not change it. A worker left on that value gives a batch item published without `humanVerificationUrl` a verification link on `localhost`.

If you run the bundled Compose stack, the Identity Resolver's object store image also changes, from `quay.io/minio/minio` (which no longer allows anonymous pulls) to `pgsty/minio`. The new image reads an existing `./minio_data`, but once it has written there, the old image cannot read that data. If you may need to return to v0.6.0, stop the stack and copy `./minio_data` before you upgrade. The [Stop the Stack](../reference-implementation/quick-start#stop-the-stack) section of the quick-start describes a full reset.

Upgrade the worker, or change its settings, when no batch is running. A worker restart during a batch can leave the item in flight `OUTCOME_UNKNOWN`, so the batch ends `NEEDS_ATTENTION` and needs an operator (see the [batch issuance runbook](../reference-implementation/operations/batch-issuance#needs_attention)). The batch's remaining items can also wait for the reconciliation sweep, which picks a batch up once its last progress is older than twice `WORKER_JOB_TIMEOUT_SECONDS`. A batch that continues after the restart issues its later items with the worker's new settings. With `CREDENTIAL_STATUS_DEFAULT_PURPOSES=none`, a later item that does not ask for `statusPurposes` carries no status entry. Items that already ended `FAILED` are not issued again.

Before you upgrade the worker, give it these settings:

1. Set `RI_APP_URL` to the web process's value. An upgraded worker without it exits at boot, and Compose's `restart: always` keeps restarting it. Until the value is set, every worker job waits: batch issuance, library verification, the reconciliation sweeps and batch expiry. When the worker returns, a library verification that is still pending and was queued longer ago than the pending-run reconciliation cutoff (60 minutes by default) is settled as failed with `VERIFICATION_UNAVAILABLE`, retryable, by the reconciliation sweep. The sweep runs every ten minutes by default and settles up to 500 runs each time, so a backlog takes several sweeps. Re-verify the records that report it.
2. Copy the web process's effective values of `CREDENTIAL_STATUS_DEFAULT_PURPOSES`, `CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED` and `CREDENTIAL_STATUS_LOCK_ACQUIRE_MS`. Where the web process leaves one of them unset, leave it unset on the worker too, so both processes use the same default. Copy the three together: a v0.6.0 worker does not check that a multi-purpose default has `CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED=true`, so a v0.6.0 worker given `revocation,suspension` without the flag mints two status entries.
3. Set the private-URL setting to the web process's value under one name only, preferably `FETCH_ALLOW_PRIVATE_URLS`, or leave it unset if the web process has neither name. An upgraded worker refuses to boot when both `FETCH_ALLOW_PRIVATE_URLS` and `VERIFY_ALLOW_PRIVATE_URLS` are set, even when the two values are equal.
4. Upgrade the worker.

The worker reads each of these settings when it issues an item. So setting them on a v0.6.0 worker already fixes batch items, and you can do that before the upgrade.

The same upgrade changes one bound on the web process. A key-bearing recovery on `POST /api/v1/library/{id}/verify` reads the record's stored copy inside the request, and that read is now bounded by `FETCH_TIMEOUT_MS` instead of `WORKER_JOB_TIMEOUT_SECONDS`. The default falls from 300 seconds to 10 seconds, with a ceiling of 120 seconds. A read that overruns settles the generation as `STORED_COPY_UNAVAILABLE`, retryable. If your storage needs longer, raise `FETCH_TIMEOUT_MS`. That also lengthens the supplier fetches on the verify, registration and re-verification routes.

The status operation settings stay on the web process only, as described under [Credential-status management and library lifecycle](#credential-status-management-and-library-lifecycle).

## Upgrading from v0.6.1

v0.6.2 changes no setting, database migration or Compose file. When no batch is running, deploy the v0.6.2 image, or rebuild the bundled Compose stack, and restart the web process and every worker. [Upgrading from v0.6.0](#upgrading-from-v060) explains what a worker restart during a batch does.

The worker no longer traces the job queue's background database calls, which normally run with no span active: polling, fetching and settling jobs, maintenance, creating its queues when the worker starts, and its keep-alive and health-probe queries. In v0.6.1 each of those calls became its own root `pg` trace. Review any dashboard or alert built on those traces or on their error status. Queue faults still log "Job queue reported an error". pg calls made inside a job are still traced.

If your collector receives the Reference Implementation's OTLP metrics, the query-duration samples for those background calls stop, and the pool connection-count gauges start on the first job queue call made inside a span. Review any monitoring built on them. The bundled Compose stack does not receive metrics.

No setting traces the background calls again. If you set `OTEL_NODE_DISABLED_INSTRUMENTATIONS=pg` on the worker to stop the v0.6.1 flood, you can remove it to get the pg spans inside jobs back. The [release notes](https://github.com/uncefact/tests-untp/blob/next/packages/reference-implementation/RELEASE_NOTES.md) list every change in v0.6.2, and [Observability](../reference-implementation/operations/observability#what-is-emitted) describes what each process emits.
