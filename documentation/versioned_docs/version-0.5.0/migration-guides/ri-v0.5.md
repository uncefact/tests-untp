---
sidebar_position: 1
title: Reference Implementation v0.5
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

This guide covers upgrading a Reference Implementation deployment from v0.4 to v0.5.

:::warning[Before you upgrade]
Back up the Reference Implementation database and record the encryption key that belongs with the backup. The `20260902000000_library_records` migration changes the credential table structure and has no reverse path. Returning to v0.4 after it has run means restoring the paired backup.

Keep the backup and its encryption key together. A backup that contains encrypted envelopes cannot be recovered without the key that wrote them. See [Key Management and Recovery](../reference-implementation/operations/key-management#backups-pair-with-the-key).
:::

## Overview

v0.5 adds a credential library for credentials your tenant issued and credentials it received. Library verification runs on a worker instead of inside the request that starts it. The deployment therefore needs a web container and a worker container from the same image. The release also retires the credentials read routes and tightens several environment and API contracts.

Follow [Before you upgrade](#before-you-upgrade) in order. The web container applies the migrations. The worker checks that they are present but does not apply them. Run the credential-details backfill after both containers are ready.

## Before you upgrade

Complete these steps in this order:

1. **Back up the database and record the encryption key.** Every v0.4 deployment holds one key. It is set as `DATA_ENCRYPTION_KEY`, or under the older name `SERVICE_ENCRYPTION_KEY` if the deployment never renamed it. Record the value alongside the backup, because a restore without the matching key cannot read the encrypted credentials. If you ever need to return to v0.4, [Rollback](#rollback) describes how this backup is used.
2. **Rename the encryption key variable.** Rename `SERVICE_ENCRYPTION_KEY` to `DATA_ENCRYPTION_KEY`, remove the old name from `.env` files, secret stores, CI variables, Compose overrides and deployment manifests, and keep the value byte for byte. The web entrypoint preflight checks this before it constructs `RI_DATABASE_URL` or runs migrations, and exits 1 with `Preflight failed: ...` when the old-only configuration is rejected. [`SERVICE_ENCRYPTION_KEY` is no longer read](#service_encryption_key-is-no-longer-read) explains why and what happens with each combination of names.
3. **Rename the three fetch settings.** Rename `VERIFY_ALLOW_PRIVATE_URLS` to `FETCH_ALLOW_PRIVATE_URLS`, `VERIFY_MAX_CREDENTIAL_SIZE` to `FETCH_MAX_RESPONSE_SIZE` and `VERIFY_FETCH_TIMEOUT_MS` to `FETCH_TIMEOUT_MS` everywhere they are supplied (`.env` files, secret stores, Compose overrides, deployment manifests), keeping each value, then remove the old names so no setting is supplied under both. The full table is in [Credential fetch settings have new names](#credential-fetch-settings-have-new-names). Leave `FETCH_ALLOW_PRIVATE_URLS` unset on a deployed instance: the default is strict address checks, which is what a deployment should run with. Setting it to `true` is for the bundled local Compose stack, whose services sit on loopback and private addresses, and is not advised anywhere else. The web entrypoint preflight rejects a setting supplied under both names or an invalid timeout before it constructs `RI_DATABASE_URL` or runs migrations, and the container exits 1 with `Preflight failed: ...`.
4. **Deploy the v0.5 web container first.** The web entrypoint preflight runs before database URL construction and migration. The container then runs the ten Prisma migrations before it starts serving. In the bundled Compose deployment, this web step also recreates Keycloak and upgrades its existing volume in place from 26.4.2 to 26.7. Wait for the web container to finish the migration step. [Database migrations](#database-migrations) lists what the ten migrations change.
5. **Deploy the v0.5 worker container.** The worker refuses to start while one of the image's migrations is missing. It also requires `DATA_ENCRYPTION_KEY`, even when a keyless web process could start. [Worker deployment](#worker-deployment) covers its configuration, Compose and Kubernetes shapes.
6. **Run `backfill:credential-details`.** Run a dry run first, then the live command on the web container. The worker does not run this backfill. [Backfill existing credential details](#backfill-existing-credential-details) explains what it fills in and how to handle rows it reports.

For the bundled Compose deployment, update the environment first and then run:

```bash
docker compose up -d --build --force-recreate ri
docker compose up -d --force-recreate ri-worker
```

For a deployment that pins image tags, use `ghcr.io/uncefact/tests-untp/reference-implementation:0.5.0` for both services. Do not use a v0.4 image for either service. If a custom Compose file builds the image locally, build it once and reference that same image from `ri` and `ri-worker`.

For Kubernetes, deploy the web workload and wait for its migration step to complete before applying the worker workload. Set the worker command to `/app/docker-worker-entrypoint.sh`, give it `terminationGracePeriodSeconds: 60`, and use an exec liveness probe for `/app/docker-worker-healthcheck.sh`. Do not create a Service for the worker. The worker writes its heartbeat file to `/tmp/worker-heartbeat`, so a read-only root filesystem needs a writable mount at `/tmp`.

If a pipeline deploys for you, keep the same order in it: update the pipeline's secrets and manifests before the web rollout, wait for the web container to report ready, start the worker, then run the backfill command as its own pipeline step. Update API client fixtures for the route and response changes below.

## The credentials list and detail routes are retired

**Breaking change.** `GET /api/v1/credentials` and `GET /api/v1/credentials/{id}` are retired without a deprecation window. After authentication and tenant resolution succeed, both return `410 Gone` with `code: ROUTE_RETIRED` and a message naming the replacement. Unauthenticated calls still return `401`, and a principal without a tenant still returns `403`.

Use `GET /api/v1/library` for the combined inventory of credentials your tenant issued and received. Library list and batch-get responses never contain decryption keys or durable-copy storage coordinates. Retrieve a specific credential's key through `GET /api/v1/library/{id}`, using its existing credential record id. Detail returns a key only when the service holds one and can reveal it. When it holds one it cannot reveal, `hasKey` is `true`, `decryptionKey` is `null` and the response carries a `DECRYPTION_KEY_UNAVAILABLE` warning. [Retrieve one library record](../reference-implementation/api/library#retrieve-one-library-record) explains that state and what clears it.

**Warning.** Changing only the URL can silently drop an old filter because the library query parser ignores unknown keys. For example, retaining `credentialType=DigitalProductPassport` after changing the path does not preserve that filter. A repeated non-repeatable key is rejected with `400`, so check each query parameter against the mapping before switching routes.

| Old integration                                       | Required migration                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issued-credentials list                               | `GET /api/v1/library?origin=native`; omit `origin` for both origins.                                                                                                                                                                                                                                                    |
| `credentialType=DigitalProductPassport`               | Use `type=DPP`. This filters the extracted core credential type. With `origin=native`, it excludes a native row whose type did not resolve. Without `origin`, it can include an external row whose declared type is DPP when extraction produced no core type.                                                          |
| Top-level `credentialType` field                      | The old field was the declared type string, such as `DigitalProductPassport`. Read `credential.credentialType`. The library value is the extracted `CoreCredentialType` enum (`DFR`, `DCC`, `DPP`, `DTE` or `DIA`) and is `null` when extraction produced none. The declared string has no field on the library record. |
| Top-level descriptive fields                          | v0.4 exposed none. The v0.5 record gains descriptive fields under `credential`, including the fields returned by the library detail response.                                                                                                                                                                           |
| List `storageUri`, `digestMultibase`, `decryptionKey` | Retrieve the record through `GET /api/v1/library/{id}`. Coordinates and a key are available on detail only.                                                                                                                                                                                                             |
| `Credential` OpenAPI component                        | The component is removed. Regenerate the client and use `CredentialRecord` for list and batch responses and `CredentialRecordDetail` for detail responses.                                                                                                                                                              |
| `tenantId` field                                      | Remove it from library record handling. `tenantId` is not present on any library record.                                                                                                                                                                                                                                |
| `isPublished` field or filter                         | There is no replacement in this release.                                                                                                                                                                                                                                                                                |
| Default list ordering                                 | The library list defaults to `issuedAt:desc`, so omitting `sort` does not use the old `createdAt` order. `sort=createdAt:desc` restores the old primary order, with an ascending id tie-break where the old list used a descending id tie-break.                                                                        |

See the [Library API](../reference-implementation/api/library) for null states, extraction status and pagination behaviour.

## `SERVICE_ENCRYPTION_KEY` is no longer read

**Breaking change.** v0.4 renamed the encryption key variable from `SERVICE_ENCRYPTION_KEY` to `DATA_ENCRYPTION_KEY` and kept reading the old name as a deprecated fallback. v0.5 removes that fallback. The application and the seed read `DATA_ENCRYPTION_KEY` alone, and the web entrypoint preflight rejects a deployment that still holds its key only under the old name before it constructs `RI_DATABASE_URL` or runs any migration.

The value does not change, only the name. If your deployment already sets `DATA_ENCRYPTION_KEY`, remove any leftover `SERVICE_ENCRYPTION_KEY` and no other key change is needed. The offline [rotation command](../reference-implementation/operations/encryption-key-rotation) reads its key pair directly and is unaffected by this fallback removal.

**Before** (v0.4):

```bash
SERVICE_ENCRYPTION_KEY=<your 64-character hex key>
```

**After** (v0.5):

```bash
DATA_ENCRYPTION_KEY=<your 64-character hex key>
```

What v0.5 does when the old name is still present. Whitespace-only values count as unset.

| Environment                       | Behaviour                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only `DATA_ENCRYPTION_KEY` set    | Normal operation.                                                                                                                                                                                                                                                                                                                   |
| Only `SERVICE_ENCRYPTION_KEY` set | The entrypoint preflight fails before database URL construction, migration, backfill or seed with the message `SERVICE_ENCRYPTION_KEY is set but is no longer read (it was deprecated in v0.4 and removed in v0.5). Rename it to DATA_ENCRYPTION_KEY and restart. The value does not change, only the name.` The container exits 1. |
| Both set to the same value        | The key comes from `DATA_ENCRYPTION_KEY`, and startup logs a warning to remove the old name.                                                                                                                                                                                                                                        |
| Both set to different values      | The entrypoint preflight refuses before database URL construction, migration, backfill or seed. Application-key maintenance commands also refuse. Set `DATA_ENCRYPTION_KEY` and remove `SERVICE_ENCRYPTION_KEY`.                                                                                                                    |

If you use the [encryption audit](../reference-implementation/operations/encryption-audit) as a one-off container during a key rotation, follow that page's direct key-pair options. The audit and the rotation command read their key variables directly.

A well-formed `DATA_ENCRYPTION_KEY` is still checked against existing encrypted data after migrations, because that check needs database tables. The preflight covers the key name, format and placeholder policy; the existing-data check remains a later application boot check.

## Credential fetch settings have new names

v0.5 renames the shared credential-fetch settings so their names describe the operation rather than the verify route. The old names remain supported during v0.5 and are planned for removal in RI v0.6.

| Old name                     | New name                   |
| ---------------------------- | -------------------------- |
| `VERIFY_ALLOW_PRIVATE_URLS`  | `FETCH_ALLOW_PRIVATE_URLS` |
| `VERIFY_MAX_CREDENTIAL_SIZE` | `FETCH_MAX_RESPONSE_SIZE`  |
| `VERIFY_FETCH_TIMEOUT_MS`    | `FETCH_TIMEOUT_MS`         |

The values do not change. `VERIFY_MAX_CREDENTIAL_SIZE=2048` becomes `FETCH_MAX_RESPONSE_SIZE=2048`, and `VERIFY_FETCH_TIMEOUT_MS=3210` becomes `FETCH_TIMEOUT_MS=3210`. The boolean enables only for exact lowercase `true`. The size parser falls back to `10485760` when it cannot read a positive integer. `FETCH_TIMEOUT_MS` defaults to `10000` milliseconds and accepts an integer from 1 through 120000 milliseconds; it fails the web entrypoint preflight before database URL construction or migration when it is outside that range, and the container exits 1.

The bundled deployment Compose file now forwards the old and new names independently. It no longer forces `VERIFY_ALLOW_PRIVATE_URLS=true`. A deployment that set nothing therefore changes from permissive to strict. If its storage service, Identity Resolver or VCKit uses a private or loopback address, set `FETCH_ALLOW_PRIVATE_URLS=true` before recreating the containers.

If you intended strict checks, leave the new boolean unset or set it to a value other than exact lowercase `true`. A value of `false` or another value is now honoured, while the old forced Compose setting ignored it. The E2E Compose harness has its own `true` default because its services use private container names. A stale root environment file that supplies the old boolean to that harness can create a two-name conflict.

Two non-blank names for one setting fail startup, even when the values are equal. Remove the old entry from every environment source for that process. A warning from an old-only setting identifies the rename during the v0.5 compatibility window.

Migration steps:

1. Find the old names in `.env` files, Compose inputs and overrides, CI variables, secret stores, manifests and scripts.
2. Rename each old entry to its mapped new name, keeping the value unchanged. Remove the old entry from every input source for that process.
3. Ensure custom Compose or deployment forwarding carries the old and new names independently during the compatibility window. Do not set both names in the same process environment.
4. Leave `FETCH_ALLOW_PRIVATE_URLS` unset on a deployed instance. Set it to `true` only for the bundled local Compose stack, where the dependent services use loopback and private addresses.
5. Recreate the web container. For the normal Compose stack, run `docker compose up -d --force-recreate ri`. Restart a directly run web process. Keep the closed-mode override on every E2E Compose command.
6. Check startup logs for conflicts and deprecated-name warnings. Align CI capability input with the running app and remove the old names before the planned v0.6 removal.

These three renames do not require a key rotation or a database migration. The worker's shared background-job timeout is described in [Worker deployment](#worker-deployment).

## `MAX_REQUEST_BODY_BYTES` limits API request bodies

**Breaking change for large-payload clients.** Every API route that accepts a request body now limits the body to 5 MiB (5242880 bytes) by default. An over-limit body returns `413` with `code: REQUEST_BODY_TOO_LARGE`. The size check happens before JSON parsing, so an over-limit malformed body also returns `413`.

**Before** (v0.4):

```text
POST /api/v1/credentials
body larger than the deployment's v0.5 limit
```

**After** (v0.5):

```json
{
  "status": 413,
  "code": "REQUEST_BODY_TOO_LARGE"
}
```

If your client sends larger payloads, set a higher limit before the rollout:

```bash
MAX_REQUEST_BODY_BYTES=10485760
```

The value must be an integer of at least 1024. An invalid value fails process startup. Update clients and CI to handle `413 REQUEST_BODY_TOO_LARGE` instead of treating it as a malformed request. See [Credentials API](../reference-implementation/api/credentials).

## `BUNDLED_ARTEFACTS_FALLBACK` changes host failure handling

The image now contains the UNTP and VC Data Model schemas and contexts used by the Reference Implementation. `BUNDLED_ARTEFACTS_FALLBACK` defaults to `true`, so a failure to fetch a bundled artefact from its publishing host can use the copy in the image and logs a warning. Set it to `false` to restore the strict v0.4 behaviour.

**Before** (v0.4):

```bash
# A host failure was reported to the caller.
```

**After** (v0.5):

```bash
BUNDLED_ARTEFACTS_FALLBACK=true
```

Only `true` or `false` is accepted when the variable is set. An invalid value fails startup. The fallback covers the bundled system artefacts. It does not cover an extension schema or context hosted elsewhere. With fallback enabled, `SCHEMA_FETCH_FAILED` and `JSONLD_CONTEXT_FETCH_FAILED` no longer by themselves prove that the publishing host was unreachable. See [Bundled UNTP Artefacts](../reference-implementation/operations/bundled-untp-artefacts).

## Worker deployment

**Deployment change.** v0.5 adds `ri-worker`, a second container from the Reference Implementation image, and it is required.

The worker exists because v0.5 verifies credentials in the background. When a credential is registered in the library, issued, or re-verified, the web container records the request, answers straight away, and queues a verification job in the database. The worker takes that job and does the slow part: it fetches the credential, checks its digest and signature, checks its status and validity window, checks schema conformance, extracts the details shown in the library, and records the result on the library record. It also runs a scheduled sweep that settles jobs abandoned by a crashed worker so a record never stays pending forever. Clients see the progress through the [verification envelope](../reference-implementation/api/library#the-verification-envelope) on the library record.

The worker serves no HTTP port and runs no migrations. Without a running worker, every registration and re-verification stays `pending` until one starts. The [Worker](../reference-implementation/operations/worker) page covers its queues, health check, shutdown and deployment outside Compose.

The worker runs from the same image as the web container, `ghcr.io/uncefact/tests-untp/reference-implementation:0.5.0`, with a different entrypoint and healthcheck: `/app/docker-worker-entrypoint.sh` and `/app/docker-worker-healthcheck.sh`, both shipped in that image. The wrapper passes `--process-role=worker` as the first argument to the shared entrypoint, and sets `SKIP_MIGRATIONS=true` and `SKIP_SEED=true` before handing off. The shared entrypoint runs the worker preflight before database URL construction; a refusal exits 1 with `Worker boot failed: ... [code]`. The worker never migrates, seeds or runs backfills. It checks that every migration in its image is already applied, so deploy the web container first.

`DATA_ENCRYPTION_KEY` is mandatory for the worker. The web process can run without a key when there is no encrypted data, but a worker without the key refuses to boot. The worker uses `restart: always` in the bundled Compose file and has a 60 second stop grace period.

The worker heartbeat file defaults to `/tmp/worker-heartbeat`. Give `/tmp` a writable mount when the root filesystem is read-only. The worker healthcheck reports unhealthy when the file is missing, older than 30 seconds, or stamped in the future. Kubernetes ignores a Docker healthcheck, so use an exec liveness probe for `/app/docker-worker-healthcheck.sh`.

The worker settings are:

| Setting                                     | Default                 | Bound or effect                                                                                              |
| ------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `LIBRARY_RECONCILE_PENDING_RUNS_CRON`       | `*/10 * * * *`          | Parsed by the worker's queue scheduler. An invalid schedule fails worker startup.                            |
| `LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE` | `500`                   | Positive integer, maximum `10000`.                                                                           |
| `WORKER_JOB_TIMEOUT_SECONDS`                | `300`                   | Integer from `30` seconds to `86400` seconds, which is 24 hours. The web and worker must use the same value. |
| `WORKER_HEARTBEAT_PATH`                     | `/tmp/worker-heartbeat` | Moves the heartbeat file. The worker and healthcheck must use the same path.                                 |
| `WORKER_HEARTBEAT_MAX_AGE_SECONDS`          | `30`                    | Sets the maximum heartbeat age accepted by the healthcheck.                                                  |

`WORKER_JOB_TIMEOUT_SECONDS` is the expiry and working budget for every background job the web process sends or schedules and the worker runs. It also bounds the in-request durable-copy read used by key-bearing `POST /api/v1/library/{id}/verify`. Set the same value in both containers. The old `LIBRARY_STORED_COPY_READ_TIMEOUT_MS` setting is removed and ignored if it remains in an environment or custom Compose file. It no longer controls either container.

The reconciliation sweep uses the same job-timeout policy. Its abandonment cutoff is derived from the retry ladder, rounded up to a whole 30-minute interval and never set below 30 minutes. With the default value, its abandonment cutoff is 60 minutes. Lowering the setting changes that cutoff and can settle a pending generation as `VERIFICATION_UNAVAILABLE` sooner. A settled generation can be re-verified by creating a new generation.

For bare Docker, replace the image entrypoint and HTTP healthcheck with the worker files, set a restart policy, and expose no worker port:

```bash
docker run \
  --entrypoint /app/docker-worker-entrypoint.sh \
  --health-cmd /app/docker-worker-healthcheck.sh \
  --health-interval 10s \
  --health-timeout 5s \
  --health-retries 3 \
  --health-start-period 40s \
  --restart always \
  --stop-timeout 60 \
  ghcr.io/uncefact/tests-untp/reference-implementation:0.5.0
```

For Kubernetes, set `command: ["/app/docker-worker-entrypoint.sh"]`, use an exec liveness probe for `/app/docker-worker-healthcheck.sh`, set `terminationGracePeriodSeconds: 60`, and do not create a Service for the worker. A deployment that pins image tags must use the same v0.5.0 image for the web and worker containers.

See [Worker](../reference-implementation/operations/worker) for startup, shutdown and health details.

## Database migrations

Ten migrations apply in this order. The web container applies them before serving. The worker checks that every migration in its image is applied and refuses to boot when one is missing.

| Migration                                                     | Change and operator action                                                                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260826000000_credential_descriptive_fields`                | Adds captured credential descriptive fields and extraction status and error values. Existing rows start with `EXTRACTION_PENDING`.                                                             |
| `20260827000000_idempotency_key`                              | Adds the tenant-scoped idempotency-key table and operation values.                                                                                                                             |
| `20260901000000_credential_core_data_model_version`           | Adds the stored core data model version. Run `backfill:credential-details` after the migrations.                                                                                               |
| `20260902000000_library_records`                              | Creates the `LibraryRecord` parent, rehangs native rows and has no reverse path. The native core-type derivation is described below.                                                           |
| `20260906000000_external_credential_content_identity`         | Adds external-credential content identity and duplicate-record fields. No backfill is needed because v0.4 could not hold external records.                                                     |
| `20260906000001_check_run_source_freshness`                   | Adds source freshness fields to verification runs.                                                                                                                                             |
| `20260908000000_check_run_failure_code_stored_copy_corrupt`   | Adds the `STORED_COPY_CORRUPT` PostgreSQL enum value. PostgreSQL cannot remove this enum value in place.                                                                                       |
| `20260908120000_check_run_failure_code_source_not_credential` | Adds the `SOURCE_NOT_CREDENTIAL` PostgreSQL enum value. PostgreSQL cannot remove this enum value in place.                                                                                     |
| `20260910120000_check_run_schema_conformance_message`         | Adds the nullable `CheckRun.schemaConformanceMessage` column used when the advisory conformance check records a message.                                                                       |
| `20260911120000_credential_storage_coordinates`               | Adds three nullable columns to `Credential`: `storageServiceInstanceId`, `storageExternalId` and `storageBucket`. New issuances fill them; no backfill. Dropping them reverses this migration. |

The `20260902000000_library_records` migration is the data-model boundary for this release. A credential becomes a `LibraryRecord` parent with an origin-specific child. For native rows, the migration derives `coreCredentialType` from the declared type string, using the extension data-model lookup when required. Manual deletion must target the parent record. The migration keeps existing credential ids, but v0.4 code cannot write the new parent and child rows.

## Backfill existing credential details

The descriptive fields migration leaves pre-existing native records at `EXTRACTION_PENDING`. The library-records migration derives `coreCredentialType` for native rows from the declared type string where the SQL lookup can do so. The backfill reads each stored artefact, decrypts it when required, extracts its name, issuer, subject, validity fields and core data model version, and fills the descriptive fields on the library record. For rows whose core type was derived by the migration, it does not recalculate that type.

The backfill is operator-run and never runs at boot. It reads stored artefacts for every tenant, so run it soon after the migrations and do not run it from `ri-worker`.

Run the dry run first, inside the web container. The published image carries the script but no package manifest, so the script is invoked directly, and the two `SKIP_` flags stop this one-off container from re-running the migrations and the seed on the way in:

```bash
docker compose run --rm -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
  ri node_modules/.bin/tsx scripts/backfill-credential-details.ts --dry-run
```

The dry run performs the same fetch, decrypt and decode work as the live pass but writes nothing. If it reports the expected rows, run the live pass:

```bash
docker compose run --rm -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
  ri node_modules/.bin/tsx scripts/backfill-credential-details.ts
```

In a checkout, the same two runs are `pnpm backfill:credential-details -- --dry-run` and `pnpm backfill:credential-details` from `packages/reference-implementation`.

For encrypted records, `DATA_ENCRYPTION_KEY` must match the key used by the application. The command reports scanned, descriptive-field updates, exceptional core-kind resolutions and failures. It lists each failed row by id, error class and message. One failed row does not stop other rows from being attempted. A run with no failures exits `0`. A run with any row failure exits `1`.

A row whose descriptive extraction fails is marked `EXTRACTION_FAILED` and is not selected again until an operator resets `detailsStatus` to `EXTRACTION_PENDING`. The backfill fills descriptive fields; `coreCredentialType` for native rows is derived by the library-records migration, with a separate fallback only for an exceptional native row the migration left null. See [Credential Details Backfill](../reference-implementation/operations/backfills/credential-details).

## Library read outcomes are explicit

The library is new in v0.5. Its list and batch-get responses require a `failures` array alongside `data`. A readable record appears in `data`. The list route reports only the ids its own page selected, so every list failure is a `RECORD_UNREADABLE` failure. Batch-get failures are `RECORD_UNREADABLE` when a selected record cannot be read, or `NOT_FOUND` for a missing id, a foreign-tenant id or an id containing a NUL character. These row outcomes still use HTTP `200`, including when every selected row fails. Database, transaction and selection-boundary faults remain `500` responses.

Each failure is `{ "id": string, "code": "RECORD_UNREADABLE" | "NOT_FOUND", "message": string }`. The list and batch responses account for each selected id exactly once across `data` and `failures`. Duplicate batch ids produce one outcome in first-appearance order.

A NUL-bearing id is returned as submitted, including the NUL character. Treat `failures[].id` as an echo of the request, not as a value that is safe to write to PostgreSQL.

List callers must advance pagination by `limit`, never by `data.length`. `pagination.total` includes unreadable rows and `hasMore` counts readable and failed rows consumed by the page. If a page has twenty failures and no readable rows with `limit=20`, the next request still uses `offset=20`.

The detail route has a separate key-custody warning. List and batch rows carry no key. When the service holds a key but cannot return it, detail returns the complete record with `hasKey: true`, `decryptionKey: null` and one `DECRYPTION_KEY_UNAVAILABLE` warning. A record that cannot be built returns `500 RECORD_UNREADABLE` with its id. See the [Library API](../reference-implementation/api/library).

## A library summary of `verified` now requires a passing proof

A complete verification generation reads `verified` only when its `proof` check passed and no blocking check failed. Previously, a complete generation with no blocking failure could read `verified` after another check had run, even when the verifier stopped at the credential's validity window before it established proof.

Generations settled before this rule are reclassified on read. A complete generation with `proof: not_run` now reads `not_conformant`; re-verify it with `POST /api/v1/library/{id}/verify` to create a generation with current evidence.

Verification judges the `temporal` check from the credential's own `validFrom` and `validUntil`. When other blocking checks pass, an expired credential can therefore settle as `verified` with `temporal: fail` and `currencyStatus: expired`, even when the provider does not enforce the window. A present bound that cannot be read as a date-time fails the temporal check rather than being treated as absent.

A native record's first generation is an issuance assertion: it carries `proof: pass` with `status: not_run`. Re-verify the record for current status evidence.

## Library verification reports schema conformance

Worker-settled verification now checks `schemaConformance` after credential details have been extracted. It validates the stored credential against the system core schema for its stored core type and data model version, then expands its JSON-LD using the declared contexts. It does not validate extension schemas.

**Before** (v0.4):

```json
{
  "schemaConformance": "not_run"
}
```

**After** (v0.5):

```json
{
  "schemaConformance": "pass"
}
```

The check settles to `pass` when both stages complete. It settles to `fail` when the core schema or JSON-LD document is invalid. A failed check adds a `SCHEMA_CONFORMANCE_ADVISORY` warning and does not change the verification summary. The warning appears only for the settled newest generation.

The check remains `not_run` when details were not extracted, the credential cannot be decoded after extraction, a schema or context cannot be obtained or used, or the conformance stage runs out of the job's remaining budget. When the budget is exhausted, the worker logs that the stage was skipped. Those cases leave the other verification checks independent. A native record's generation 1 is its issuance assertion and remains `not_run` for this check. The conformance check uses the system core schema, while issuance uses the tenant-visible data model, so their outcomes can differ.

Update integrations that assume `schemaConformance` is always `not_run`. Treat it as advisory and continue to use the existing verification summary for the overall result. See the [Library API](../reference-implementation/api/library#the-verification-envelope).

## `encryptionMethod` uses the resolver vocabulary

**Breaking change for link API clients.** `encryptionMethod` on `POST /api/v1/identifiers/{id}/links` and `PATCH /api/v1/identifiers/{id}/links/{linkId}` now accepts only `none`, `AES-128` or `AES-256`. A value such as `AES-256-GCM`, which v0.4 accepted and dropped, now returns `400`.

**Before** (v0.4):

```json
{
  "encryptionMethod": "AES-256-GCM"
}
```

**After** (v0.5):

```json
{
  "encryptionMethod": "AES-256"
}
```

Use one of the three accepted values in link registration and update requests. Published credential links now include `encryptionMethod: "AES-256"` when the stored target is encrypted. An unencrypted target omits the field. The field is not added to the human or machine verification links.

Update generated clients and request validators before sending the new values. See [Identifiers API](../reference-implementation/api/identifiers#publish-links).

## Fetch and resolver checks are stricter

The SSRF guard now rejects IPv4-compatible IPv6 spellings such as `::192.0.2.1`, the 6bone address range such as `3ffe::/16`, and IPv6 addresses outside the allocated `2000::/3` Global Unicast block. A URL that was accepted by the v0.4 guard can therefore return `400` after the upgrade. Review caller-supplied URLs and move any required endpoint to an allocated public address, or set `FETCH_ALLOW_PRIVATE_URLS=true` only when the endpoint is intentionally private. See [Credential Fetch Settings](../reference-implementation/operations/startup#credential-fetch-settings) for the evergreen address-guard rules.

`did:web` resolution now pins connections to the addresses validated for each hop, caps the response at 1 MiB, allows three additional redirects and applies a 10 second resolver timeout. A redirect hop is validated again. See [DIDs](../reference-implementation/api/dids).

Credential verification keeps its v0.4 status split for an unresolved host: strict address checks return `400`, while `FETCH_ALLOW_PRIVATE_URLS=true` returns `502 UPSTREAM_ERROR`. In permissive mode, v0.5 refuses a redirect chain longer than three additional hops with `502 UPSTREAM_ERROR`; v0.4's plain `fetch` followed it without this route's own redirect cap.

The package export location also changed. Consumers that imported the SSRF helpers from `@uncefact/untp-ri-services/server` must import them from `@uncefact/untp-utils/node` instead.

**Before** (v0.4):

```ts
import { validatePublicUrl, isPrivateIpv4, isPrivateIpv6 } from '@uncefact/untp-ri-services/server';
```

**After** (v0.5):

```ts
import { validatePublicUrl, isPrivateIpv4, isPrivateIpv6 } from '@uncefact/untp-utils/node';
```

`validatePublicUrl` now returns the validated address set in its `addresses` property. Update consumers that use the returned value's type. See [Credential fetch settings](../reference-implementation/api/credentials#shared-credential-fetch-settings).

## Other API and deployment changes

### Idempotent credential issuance

`POST /api/v1/credentials` now accepts an `Idempotency-Key`. A retry with the same key and body replays the original response, a retry while the first request is in progress returns `409 IDEMPOTENCY_KEY_IN_FLIGHT`, and the same key with a different body returns `422 IDEMPOTENCY_KEY_MISMATCH`. Update CI and client retries to preserve the key and body together. See [Credentials API](../reference-implementation/api/credentials#issue-a-credential).

### Credentials this service issued can be deleted

The tenant-scoped, idempotent `DELETE /api/v1/credentials/{id}` removes the library record, verification history and issuance idempotency claim in one transaction, then attempts best-effort removal of the signed artefact's durable copy using the storage instance, object id and bucket recorded at issuance. The response remains `204` when the copy cannot be removed, and a repeat does not retry storage. The route refuses to delete an external library record, one registered from a third party rather than issued here, and returns `403 EXTERNAL_RECORD_NOT_DELETABLE_HERE`; delete that record through `DELETE /api/v1/library/{id}` instead. See [Delete a Credential](../reference-implementation/api/credentials#delete-a-credential).

The `Credential` table now has three nullable storage-coordinate columns (`storageServiceInstanceId`, `storageExternalId` and `storageBucket`), and new issuances fill them without a backfill. A credential issued before v0.5 has no coordinates, so deleting it removes the database record but leaves its stored copy in place and logs its URI. Deleting a credential does not revoke it.

### Batch reads and annotations

`POST /api/v1/library/batch-get` accepts up to `API_MAX_BATCH_LIMIT` ids. The default is `500`, and the count is taken before duplicate removal. A non-positive value is ignored with a startup warning.

`PATCH /api/v1/library/{id}` applies only to external records. A native record returns `403 NATIVE_CREDENTIAL_NOT_ANNOTATABLE`. For an external record, `If-Version` is required: a missing or invalid value returns `400 INVALID_IF_VERSION`, and a stale value returns `409 VERSION_CONFLICT`.

NUL characters in annotations on an external record now return `400` naming the field instead of reaching PostgreSQL and returning `500`. An invalid `annotations.declaredCredentialType` returns `400` without echoing the submitted value. Native records refuse annotation updates with `403 NATIVE_CREDENTIAL_NOT_ANNOTATABLE` before those annotation checks.

### New operational settings

These settings have working defaults. Add them to a custom deployment only when you need to change the default.

| Setting                           | Default                           | Effect                                                                                                                    |
| --------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `IDEMPOTENCY_STALE_CLAIM_MINUTES` | `10`                              | Sets the age after which a stale credential-issuance idempotency claim can be reclaimed. A value below `1` fails startup. |
| `API_MAX_BATCH_LIMIT`             | `500`                             | Limits ids accepted by library batch-get before duplicate removal.                                                        |
| `OTEL_SERVICE_NAME`               | `reference-implementation`        | Names the web process in emitted traces.                                                                                  |
| `OTEL_WORKER_SERVICE_NAME`        | `reference-implementation-worker` | Names the worker process through its `OTEL_SERVICE_NAME`.                                                                 |

The bundled Compose file forwards each of `MAX_REQUEST_BODY_BYTES`, `IDEMPOTENCY_STALE_CLAIM_MINUTES`, `BUNDLED_ARTEFACTS_FALLBACK`, `WORKER_HEARTBEAT_PATH` and `WORKER_HEARTBEAT_MAX_AGE_SECONDS` only when set, so an unset variable leaves the default in force.

For the trace endpoint, service names, Compose profiles and local Tempo and Grafana setup, see [Observability](../reference-implementation/operations/observability).

The encrypted idempotency response body is included in encryption audits and key rotations. The build also checks encrypted-column annotations when `pnpm build` runs.

### Dependent services

The bundled Compose Keycloak upgrade happens when the web container is brought up; see step 4 above. Existing Keycloak volumes upgrade in place. If you run Keycloak separately, apply the equivalent image upgrade using that deployment's volume procedure.

External credential registration stores JSON and binary durable copies. The bundled storage service therefore adds `application/json`, `application/octet-stream` and `text/plain` to `ALLOWED_UPLOAD_TYPES`. Add the same values to a separately managed storage service.

The storage service hands back URIs on its `DOMAIN` value (`localhost` in the bundled Compose file), so the containers must resolve that name. The bundled file maps `localhost` to the host gateway for `ri` and `ri-worker`. A deployment with its own Compose file or Kubernetes manifests must provide the same reachability by mapping the name or setting the storage service's `DOMAIN` to a name its containers resolve. The mapping appends the gateway after the existing `127.0.0.1` and `::1` localhost entries, so `localhost` still resolves to loopback first; Node tries every address and falls through to the gateway, while a client such as `wget` or `curl` that stops at the first address gets connection refused. Pinning a single address for `localhost` silently undoes the fix.

## Rollback

Returning to v0.4 means restoring the backup taken before the upgrade. In order:

1. Remove the worker, do not just stop it. In the bundled Compose file `ri-worker` carries `restart: always`, so a stopped worker comes back on the next `docker compose up`. Take the service out of the Compose file or the manifest, then bring the web container down.
2. Restore the database dump into a fresh database, and set the key you recorded with the backup. The 0.4.0 image reads it under either name, `DATA_ENCRYPTION_KEY` or the deprecated `SERVICE_ENCRYPTION_KEY`, and warns about the old name.
3. Start the v0.4 deployment against that database.

Two things the restore does not undo. Encrypted copies that v0.5 wrote to the storage service stay there and remain retrievable, while the keys that open them were only in the discarded v0.5 database, so delete those objects from storage if they should not linger. The bundled Keycloak volume, once upgraded to 26.7, stays at 26.7; Keycloak 26.4.2 starts on it with a migration-state warning, so restore the Keycloak data directory from the same backup rather than relying on that.

Do not point v0.4 code at a database after `20260902000000_library_records` has run. Nothing stops it from booting: v0.4 reports no pending migrations, seeds, and answers its health check, and only the data routes fail with a 500. A green health check after a rollback is therefore not proof that the database was restored.

The library-records migration drops and renames columns and requires parent rows that v0.4 code never writes. The two PostgreSQL enum migrations add values that cannot be removed in place. A migration resolution command alone does not make the v0.4 schema or data compatible. Restoring the paired backup is the rollback path.

If the v0.5 web migration did not complete, read the migration error and resolve that failure before retrying. Do not start the worker against a database missing one of the v0.5 migrations. If the backfill fails, keep v0.5 running, correct the reported rows or reset their status as described in [Credential Details Backfill](../reference-implementation/operations/backfills/credential-details), and rerun it.
