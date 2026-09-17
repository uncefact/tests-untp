---
sidebar_position: 8
title: Credential status recovery
---

# Recover an unconfirmed status change

A pending status entry records a requested change whose outcome has not been committed. It keeps the last confirmed bit separate from the requested value. Expiry is a recovery threshold, not evidence that the change failed. Read `GET /api/v1/credentials/{id}/status` for each entry's version and pending deadline.

## Enable status changes

Before setting `STATUS_MUTATION_ENABLED=true`, confirm that all participating status-list writers for the provider and issuer use this coordination database. The lock identity changes at process start for issuance and status sets. During a rolling deploy, the compatibility lock is acquired before the new two-key identity, so old and new processes remain serialised. Stop admission and drain older application processes before enabling mutation, and keep a drain as the recommended deploy procedure. The new lock uses two signed 32-bit words from SHA-256 of the provider's canonical serialisation key. Issuance and status sets use the same key and shared application pool; transaction pooling is supported, with one pool slot held for each active provider write.

Leaving `STATUS_MUTATION_ENABLED` unset keeps status sets disabled, but stored status reads and reconciliation remain available. Reconciliation records a provider observation and advances the entry version without setting a bit, so recovery of captured rows does not wait for status mutation to be enabled.

RI locking serialises participating operations sharing one coordination database and canonical provider/list identity. It does not serialise other VCKit clients or establish that an uncertain provider request has stopped.

## Activation checklist

Before enabling new status mutations, confirm each item:

- Complete the lock cutover before issuing with the new version. The compatibility lock must remain in place during the rolling deploy.
- Use one Reference Implementation writer per provider and issuer, with every writer using this coordination database.
- Complete capture and attribution with indexes that the adapter can represent exactly.
- Confirm the status settings were accepted during web startup.
- Read this recovery runbook and confirm the operators who will reconcile pending entries know the procedure.
- Treat `statusManageable` as record eligibility only, not as proof that mutation is enabled. A set can still answer `503 STATUS_MUTATION_DISABLED`; reads and reconciliation remain available.

## Stuck behind an unreadable provider

A dispatched set whose read-back remains invalid keeps its pending intent and fence. Reconciliation answers `422 STATUS_ENTRY_UNSUPPORTED` for an unrepresentable management entry or `502 VC_STATUS_RESPONSE_INVALID` for an invalid provider observation. It does not release the fence. Make the original provider observable, correct the provider-side problem, and retry reconciliation after the recovery grace window. Never retarget another provider merely to obtain a readable status bit.

`STATUS_OPERATION_BUDGET_MS` bounds one operation; `STATUS_RECONCILE_GRACE_MS` adds a delay before reconciliation. Defaults and validation are listed in [Startup](./startup#credential-status-operation-settings). The web process alone needs these settings. `STATUS_LIST_BUSY` means lock contention; `STATUS_COORDINATION_UNAVAILABLE` means the database could not supply coordination capacity. Neither means a bit was set.

## Recover with the original provider

1. Stop admission of new status writes and issuance to the affected provider and issuer. Drain existing requests and wait for provider quiescence.
2. Read stored status. After a `STATUS_PERSISTENCE_UNCERTAIN` response, the commit may already have succeeded, so check the entry version and pending state first.
3. Wait until the pending deadline plus the configured grace window has passed.
4. Call `POST /api/v1/credentials/{id}/status/{purpose}/reconcile`, with the current entry version in `If-Version` and `{}` as its JSON body.
5. Check the returned observation and advanced version. A successful reconciliation clears only the inspected pending token. A failed read or changed reservation clears nothing. A fresh GET reports an observation but never resolves intent.

Reconciliation with no pending intent is also how an operator or issuer obtains a first confirmed observation after [capture](./backfills/credential-status-entries) and [attribution](./backfills/credential-status-attribution).

After the deadline no RI request for this reservation is still on the wire, but a request VCKit had already accepted may still be applied afterwards; reconcile records what it observes, and a later drift check can still differ. The provider offers no outcome lookup or fencing.

## Repair an unreachable pinned configuration

Ordinary service PATCH cannot change effective configuration while an intent is pending. If its endpoint or API key has become unusable, use the repair command after stopping admission and draining. Prepare a JSON file containing the complete replacement configuration for the instance's VC adapter, including its credentials. The command validates it against that adapter's schema and encrypts it for storage. Treat that file as a secret and remove it through your normal secret-handling procedure once the repair is complete.

Run from `packages/reference-implementation`:

```bash
pnpm services:repair-config --instance <service-instance-id> \
  --config /secure/replacement-vc-config.json --allow-pending
```

The packaged image exposes the same command; the file path must be available inside the container:

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/services-repair-config.ts \
  --instance <service-instance-id> --config /secure/replacement-vc-config.json --allow-pending
```

The command refuses while any affected reservation has not passed its deadline. For a system-owned instance it checks pending entries across all tenants. It never clears a token, changes the credential's attribution or overwrites the original pending configuration digest. It records the replacement digest on each affected entry and updates the instance in one transaction. It takes the instance row lock without acquiring any library parent lock, preserving the parent-before-instance order used by status operations.

The report names the instance, replacement digest and number of affected pending entries. Success exits `0`; invalid arguments, invalid configuration, missing instance, missing acknowledgement, live reservations or failed writes exit `1` with an error. Omitting `--allow-pending` refuses any unresolved intent, including expired ones. The command can replace an unusable old configuration without decrypting it.

After repair, confirm the replacement still addresses the intended provider and issuer. Reconcile each affected entry with `{ "acceptProviderChange": true }` and its current `If-Version`. Ordinary PATCH remains blocked until reconciliation resolves every pending entry. A replacement digest does not make an earlier uncertain request safe or turn the repair into a status observation.
