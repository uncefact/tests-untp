---
sidebar_position: 0
title: Reference Implementation v0.6
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

This guide covers upgrading a Reference Implementation deployment from v0.5 to v0.6.

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

New issuance defaults to the existing `revocation` purpose, and callers may request `revocation`, `suspension`, or both through `statusPurposes` when multiple purposes are enabled. The issuance default is configurable with `CREDENTIAL_STATUS_DEFAULT_PURPOSES`; leaving it unset keeps the built-in `revocation` default, while `none` alone issues without status entries. `CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED` defaults to `false`, so one status purpose is issued by default because UNTP v0.7.0 schemas accept one `credentialStatus` object. Set it to `true` to allow multiple purposes. A request with more than one status purpose otherwise returns `400 VALIDATION_FAILED`, and a multi-purpose `CREDENTIAL_STATUS_DEFAULT_PURPOSES` refuses web boot until the opt-in is enabled.

When `CREDENTIAL_STATUS_DEFAULT_PURPOSES=none`, credentials issued without an explicit statusPurposes carry no status entry and can never be revoked or suspended.

Deleting `DELETE /api/v1/credentials/{id}` now returns `409 STATUS_OPERATION_IN_PROGRESS` while a credential status operation is pending. The caller must wait for the operation to complete or ask an operator to reconcile it before retrying. `PATCH /api/v1/services/{id}` and `DELETE /api/v1/services/{id}` also return `409 SERVICE_INSTANCE_STATUS_PENDING` when a pending status operation uses the service instance. The PATCH guard applies only when effective configuration changes. `force=true` on service deletion does not bypass this status-operation guard.

Run the `pnpm` forms from `packages/reference-implementation`; the packaged `docker compose` form needs no working directory.

After deployment, take the normal database backup and run `pnpm backfill:credential-status-entries`. Start with `--dry-run`, then run the write pass and review any reported failures. The job is conditional and idempotent. Once entries are present, run `pnpm backfill:credential-status-attribution --tenant <tenant-id> --instance <service-instance-id> --reason "historical service mapping"` for each operator-approved attribution. Use `--reassign` to reverse an operator assertion to the correct instance. Attribution is an operator assertion supported by bounded provider reads.

During a rolling upgrade, an older application version that reaches a new status-operation trigger sees an unmapped `500`, because it does not know the new conflict code. Drain status operations before rolling back. Do not delete captured rows during rollback. A later forward migration can resume from the recorded capture state.

## Credential-status management and library lifecycle

The issuer API now provides purpose-specific status PUT and reconcile POST routes, plus stored and fresh status GET. Read an entry's version and supply it as `If-Version`; revocation cannot be cleared. Clients must handle unconfirmed outcomes and explicitly reconcile, rather than treating a timeout as a failed change. See [Credential API](../reference-implementation/api/credentials#change-issuer-status) for responses and recovery semantics.

Library list and detail records add `lifecycle`, `status.statusCaptureError`, `capabilities.statusManageable`, `STATUS_CHANGE_UNCONFIRMED` and `ISSUER_STATUS_OBSERVATIONS_DIFFER`. Extend strict response decoders for these additive fields and warnings. Keep the verification `status` filter independent of `lifecycle`; `status=verified&lifecycle=none` does not establish present usability. See [Library API](../reference-implementation/api/library#issuer-lifecycle).

Deploy the additive `20260916171436_credential_status_entries` migration before the new application. Its existing `acceptedReplacementDigest` column supports configuration repair; no further migration is needed for these routes. Keep the migration and its pending-deletion trigger on rollback. The lock identity changes at process start for issuance and status operations. During a rolling deploy, the compatibility lock keeps old and new processes serialised while the new two-key identity is introduced. Stop admission and drain older writers before deploy as a safety measure. Complete capture and attribution backfills for historical credentials that need management.

On the web service, configure `CREDENTIAL_STATUS_OPERATION_BUDGET_MS` (default `30000`) and `CREDENTIAL_STATUS_RECONCILE_GRACE_MS` (default `5000`) if the deployment needs different allowances. Set `CREDENTIAL_STATUS_MUTATION_ENABLED=true` only after confirming that participating writes share the same coordination database and canonical provider identity. Both Compose definitions forward these settings to the web service only. No worker changes are required for credential-status operations. Batch cancellation requires the worker upgrade below. See [Startup](../reference-implementation/operations/startup#credential-status-operation-settings).

For rollback, disable new mutations, stop admission, drain and wait for provider quiescence, then reconcile every pending entry before returning to a version without reconciliation. Do not delete pending rows to force a rollback. If the pinned configuration is unusable, use `pnpm services:repair-config --instance <id> --config <json-file> --allow-pending`, then reconcile with explicit provider-change acceptance. The command refuses live reservations and preserves original pins and attribution. The [recovery runbook](../reference-implementation/operations/credential-status-recovery) is the operational procedure.

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
