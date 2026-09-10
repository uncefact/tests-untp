---
sidebar_position: 0
title: Reference Implementation v0.5
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

This guide covers upgrading a Reference Implementation deployment from v0.4 to v0.5.

## The credentials list and detail routes are retired

**Breaking change.** `GET /api/v1/credentials` and `GET /api/v1/credentials/{id}` are retired without a deprecation window. After authentication and tenant resolution succeed, both return `410 Gone` with `code: ROUTE_RETIRED` and a message naming the replacement.

Use `GET /api/v1/library` for the combined inventory of credentials your tenant issued and received. Library list and batch-get responses never contain decryption keys or durable-copy storage coordinates. Retrieve a specific credential's key through `GET /api/v1/library/{id}`, using its existing credential record id. Detail returns a key only when the service holds one and can reveal it. When it holds one it cannot reveal, `hasKey` is `true`, `decryptionKey` is `null` and the response carries a `DECRYPTION_KEY_UNAVAILABLE` warning.

**Warning.** Changing only the URL can silently drop an old filter because the library query parser ignores unknown keys. For example, retaining `credentialType=DigitalProductPassport` after changing the path does not preserve that filter. A repeated non-repeatable key is rejected with `400`, so check each query parameter against the mapping before switching routes.

| Old integration                                       | Required migration                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issued-credentials list                               | `GET /api/v1/library?origin=native`; omit `origin` for both origins                                                                                                                                                                                                                                                  |
| `credentialType=DigitalProductPassport`               | `type=DPP`; this filters the extracted core credential type. With `origin=native`, it excludes a native row whose type did not resolve. Without `origin`, it can include an external row whose declared type is DPP when extraction produced no core type.                                                           |
| Top-level `credentialType` field                      | The old field was the declared type string, such as `DigitalProductPassport`. The library record's `credential.credentialType` is the extracted `CoreCredentialType` enum (`DFR`, `DCC`, `DPP`, `DTE` or `DIA`) and is `null` when extraction produced none. The declared string has no field on the library record. |
| Top-level descriptive fields                          | Read the corresponding fields under `credential`                                                                                                                                                                                                                                                                     |
| List `storageUri`, `digestMultibase`, `decryptionKey` | Retrieve the specific record through `GET /api/v1/library/{id}`. Coordinates and a key are available on detail only.                                                                                                                                                                                                 |
| `Credential` OpenAPI component                        | The component is removed. Regenerate the client and use `CredentialRecord` for list and batch responses and `CredentialRecordDetail` for detail responses.                                                                                                                                                           |
| `tenantId` field                                      | Remove it from library record handling. `tenantId` is not present on any library record.                                                                                                                                                                                                                             |
| `isPublished` field or filter                         | No replacement in this release                                                                                                                                                                                                                                                                                       |
| Default list ordering                                 | The library list defaults to `issuedAt:desc`, so omitting `sort` does not use the old `createdAt` order. `sort=createdAt:desc` restores the old primary order, with an ascending id tie-break where the old list used a descending id tie-break.                                                                     |

See the [Library API](../reference-implementation/api/library) for null states, extraction status and pagination behaviour.

## `SERVICE_ENCRYPTION_KEY` is no longer read

**Breaking change.** v0.4 renamed the encryption key variable from `SERVICE_ENCRYPTION_KEY` to `DATA_ENCRYPTION_KEY` and kept reading the old name as a deprecated fallback, logging a warning at startup. v0.5 removes that fallback. The application and the seed read `DATA_ENCRYPTION_KEY` alone, and a deployment that still holds its key only under the old name no longer starts. (The offline [rotation command](../reference-implementation/operations/encryption-key-rotation) reads its key pair directly and never honoured the fallback. The only change there is that its missing-key error now points at the rename when the old name is the one set.) The fallback existed only to let v0.4 deployments upgrade without breaking, and keeping two names for one key indefinitely invites exactly the divergence the rename was meant to end.

The value does not change, only the name. If your deployment already sets `DATA_ENCRYPTION_KEY` (as the [v0.4 guide](./ri-v0.4) instructed), remove any leftover `SERVICE_ENCRYPTION_KEY` and no other action is needed.

**Before** (v0.4, worked with a deprecation warning):

```bash
SERVICE_ENCRYPTION_KEY=<your 64-character hex key>
```

**After** (v0.5):

```bash
DATA_ENCRYPTION_KEY=<your 64-character hex key>
```

What v0.5 does when the old name is still present (whitespace-only values count as unset throughout):

| Environment                       | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Only `DATA_ENCRYPTION_KEY` set    | Normal operation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Only `SERVICE_ENCRYPTION_KEY` set | Startup and the seed fail with the message `SERVICE_ENCRYPTION_KEY is set but is no longer read … Rename it to DATA_ENCRYPTION_KEY and restart.` Nothing encrypted is written before the failure.                                                                                                                                                                                                                                                                                                                                          |
| Both set to the same value        | The key comes from `DATA_ENCRYPTION_KEY`; a startup warning asks you to remove the leftover `SERVICE_ENCRYPTION_KEY`.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Both set to different values      | Startup, the seed, and the maintenance commands that use the application's key resolution refuse to run, as in v0.4, but for a different reason and with different advice: the old name is not a key, so with two values the process cannot tell which one you intended and will not pick `DATA_ENCRYPTION_KEY` for you. The message names both remediations (if the old name holds your real key, set `DATA_ENCRYPTION_KEY` to it; if `DATA_ENCRYPTION_KEY` is already right, including after a completed rotation, remove the old name). |

Migration steps:

1. In your `.env` (or wherever the deployment holds its environment), rename `SERVICE_ENCRYPTION_KEY` to `DATA_ENCRYPTION_KEY`, keeping the value byte for byte. Skip this if the v0.4 rename was already done.
2. Remove any remaining `SERVICE_ENCRYPTION_KEY` entry, including copies in CI variables, secret stores, and deployment manifests.
3. Restart the application and the background worker. Containers capture their environment when created, so recreate both containers rather than only editing `.env` (`docker compose up -d --force-recreate ri ri-worker` for compose deployments; the worker reads the same key).

If you use the [encryption audit](../reference-implementation/operations/encryption-audit) as a one-off container between a rotation and the removal of the leftover old name, keep the `-e SERVICE_ENCRYPTION_KEY=` override that page shows. The audit resolves its key the same way the application does, and a leftover holding the previous key differs from the new `DATA_ENCRYPTION_KEY`.

## Credential fetch settings have new names

v0.5 renames the shared credential-fetch settings so their names describe the operation rather than the verify route. The old names remain supported throughout the v0.5 compatibility window and are planned for removal in RI v0.6.

| Old name                     | New name                   |
| ---------------------------- | -------------------------- |
| `VERIFY_ALLOW_PRIVATE_URLS`  | `FETCH_ALLOW_PRIVATE_URLS` |
| `VERIFY_MAX_CREDENTIAL_SIZE` | `FETCH_MAX_RESPONSE_SIZE`  |
| `VERIFY_FETCH_TIMEOUT_MS`    | `FETCH_TIMEOUT_MS`         |

The values do not change. For example, `VERIFY_MAX_CREDENTIAL_SIZE=2048` becomes `FETCH_MAX_RESPONSE_SIZE=2048`, and `VERIFY_FETCH_TIMEOUT_MS=3210` becomes `FETCH_TIMEOUT_MS=3210`. The boolean still enables only for exact lowercase `true`, the size still uses its existing `parseInt` fallback, and the timeout still accepts an integer from 1 through 120000 milliseconds.

Before renaming, check the boolean's Compose behaviour. The bundled deployment Compose file now forwards both names independently with a blank default, while the E2E test harness defaults its new boolean name to `true` because its services use private container names. A `.env` value of `false` or any value other than exact lowercase `true` was ignored by the deployment's forced setting before the upgrade and is honoured after it. In a deployment stack, rename `VERIFY_ALLOW_PRIVATE_URLS` to `FETCH_ALLOW_PRIVATE_URLS` in the root `.env`, keeping the value, because removing it without a replacement turns the private-address checks on. Remove it outright only from the E2E harness's root `.env`, where the harness supplies its own default. If local storage, IDR or VCKit still needs private or loopback URLs in a deployment, set `FETCH_ALLOW_PRIVATE_URLS=true`. If strict checks were intended, keep a non-`true` value and that value is now honoured. Never set a production deployment to `true` to preserve the old Compose behaviour. The E2E stack needs no env file for its private-container default. A stale root `.env` carrying `VERIFY_ALLOW_PRIVATE_URLS` alongside the E2E default reaches the app with both names and fails startup with the conflict message.

If you never set the boolean at all, this upgrade still changes your deployment. The bundled deployment Compose file used to force the setting on for every container it started, so a deployment that set nothing was running with private and loopback addresses allowed. After the upgrade nothing is set, nothing is deprecated, and no warning is logged, but the deployment runs strict. If its storage service, Identity Resolver or VCKit is reached on a private or loopback address, add `FETCH_ALLOW_PRIVATE_URLS=true` explicitly before recreating the containers. The symptom to recognise if you do not is private-address 400s on service, registrar, data-model and identifier-link requests, and on credential publishing.

Two non-blank names for one setting fail startup, even when both values are `true` or otherwise equal. These three settings fail on equal values where the encryption-key rename warns because a boolean or a byte count carries no same-value-means-the-same-secret protection.

Migration steps:

1. Find existing old-name entries in the deployment environment, Compose inputs and overrides, CI variables, manifests and scripts. Decide which value is intended where both names already exist.
2. Rename each old entry to its mapped new name, keeping the value unchanged. Remove the old entry from every input source for that process. Do not add a second active name during the transition.
3. Upgrade custom Compose or deployment forwarding to carry both names independently during the window, as the bundled deployment Compose file does. This lets an old-only deployment upgrade before its rename is completed.
4. Before recreating a container, ensure the intended boolean name is the only non-blank name in its environment. Recreate the web app container so its environment changes: run `docker compose up -d --force-recreate ri` for the normal stack. For the E2E stack, use its existing file and profile arguments with service `app`, and keep the closed-mode override on every command when applicable. Restart a directly run web process.
5. Check startup logs for conflicts and deprecated-name warnings. Align Cypress capability input with the running app and normalise all deployments onto the new names before the planned v0.6 removal.

These fetch settings do not require a key rotation, database migration or worker-only configuration change. The worker uses its separate durable-copy read timeout. See the [evergreen startup table](../reference-implementation/operations/startup#credential-fetch-settings) for the runtime messages and rules.

## Library read outcomes are explicit

The unreleased v0.5 library contract now requires a `failures` array on both `GET /api/v1/library` and `POST /api/v1/library/batch-get` responses. Healthy records remain in `data`; a selected record that cannot be read is a `RECORD_UNREADABLE` failure, and a batch id that is missing, belongs to another tenant or contains a NUL character is a `NOT_FOUND` failure. These outcomes are still HTTP `200`, including when every selected record fails. Database, transaction and selection-boundary faults remain `500` responses.

Each entry is `{ "id": string, "code": "RECORD_UNREADABLE" | "NOT_FOUND", "message": string }` and carries no other field. `RECORD_UNREADABLE` means the record exists and belongs to the caller's tenant but could not be read, usually because its stored state cannot be represented by this contract; the message says so and asks the caller to quote the record id and the `x-correlation-id` response header. The full contract is on the [library API page](../reference-implementation/api/library).

Batch callers must account for every distinct submitted id exactly once across `data` and `failures`. Duplicate submissions produce one outcome in first-appearance order.

A NUL-bearing id takes a branch of its own. It is answered before the SQL read and never reaches PostgreSQL, and it is never silently dropped: it comes back as a `NOT_FOUND` failure carrying the id exactly as submitted, including when every submitted id contains a NUL character. The returned id therefore still holds the control character, so a client that writes `failures[].id` into its own PostgreSQL meets the same `22021` this service is avoiding. Treat the echo as a copy of what was sent, not as a value that is safe to store.

List callers must advance pagination by `limit`, never by `data.length`. `pagination.total` includes unreadable rows and `hasMore` counts both readable and failed rows consumed by the page. For example, if the first page has twenty unreadable rows out of forty, it has an empty `data` array, twenty failures and `hasMore: true`; the next request uses the original `limit` and `offset + limit` and can return healthy rows.

The detail route has a separate key-custody warning, and it appears there only: list and batch rows carry no key, and their schema forbids the code. When the service holds a key but cannot return it because the envelope is malformed, the deployment key is unavailable or unwrap fails, the route returns the complete record with `hasKey: true`, `decryptionKey: null` and exactly one `DECRYPTION_KEY_UNAVAILABLE` warning. A record that cannot be built returns `500 RECORD_UNREADABLE` with its id. Callers should quote that id and the `x-correlation-id` response header when raising the issue with an operator.

The previously deferred `batch-per-id-status` behaviour is decided in v0.5 by this amendment. Clients must consume the required `failures` array before treating a collection read as complete.
