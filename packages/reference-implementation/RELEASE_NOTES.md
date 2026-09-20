# UNTP Reference Implementation release notes

## 0.6.0 - 2026-09-21

v0.5 gave tenants a library for credentials they issued and received. v0.6 is about operating issuance and issuer-owned status as durable work: a tenant can submit an ordered batch, observe each item and recover an uncertain outcome, while issuers can read, change and reconcile status observations without treating a timeout as proof of failure. The status-operation boundary is visible in the library, and conformity score checks have a clearer advisory contract. Read the [v0.6 Reference Implementation migration guide](https://uncefact.github.io/tests-untp/docs/migration-guides/ri-v0.6) before upgrading.

The headline changes: batch issuance requires an `ri-worker` beside the web role, and the upgrade applies `20260917000000_add_credential_batches` plus `20260918120000_credential_batch_cancel`. Status mutation is off by default until the participating writers have been checked, while reads and reconciliation remain available. Every single-route issuance acquires the status-list mutex for up to `CREDENTIAL_STATUS_LOCK_ACQUIRE_MS` (default 2000 milliseconds), so parallel bulk loops can now receive `503 STATUS_LIST_BUSY` and should move to the batch route.

- Container image: [ghcr.io/uncefact/tests-untp/reference-implementation](https://github.com/uncefact/tests-untp/pkgs/container/tests-untp%2Freference-implementation) (`:0.6.0`, `:latest`)
- Upgrading from v0.5: apply the status-entry migration and the two batch migrations by name, deploy the upgraded worker before exposing the web role, run the status-entry backfill, and complete the status recovery checks before enabling mutation. Read the [v0.6 migration guide](https://uncefact.github.io/tests-untp/docs/migration-guides/ri-v0.6) before you upgrade.
- Back up first: the `20260916171436_credential_status_entries` migration adds captured status metadata and the pending-deletion guard. The batch migrations add durable batch and cancellation state. PostgreSQL cannot remove the cancellation enum value, so keep the backup and migrations when rolling back, do not delete pending or captured rows to force a rollback, and keep the database backup with `DATA_ENCRYPTION_KEY`.

### Batch issuance, cancellation and operator recovery

Issuers can submit many credential requests in one call with `POST /api/v1/credentials/batches` under an `Idempotency-Key`, then follow state, counts and per-item outcomes with `GET /api/v1/credentials/batches/{id}`. A batch item is an ordinary credential request issued through the same path as single issuance. The web role records the batch and its items, while `ri-worker` issues them one at a time. A deployment without `ri-worker` accepts submissions and never issues those items. A refused item is recorded and the batch continues. Ordering is promised within one batch only.

An item that faults before the issuance call retries with backoff for up to `BATCH_JOB_RETRY_LIMIT` attempts, four by default. An item whose outcome is unknown is held for the operator, who inspects and resolves it with `batch:inspect-item` and `batch:resolve-item`; it is not issued automatically again. The worker uses `credentials.issue-batch` for issuance, `credentials.reconcile-batches` to recover a batch whose job disappeared, and `credentials.expire-batches` to remove retained batch data. The reconciliation sweep follows `LIBRARY_RECONCILE_PENDING_RUNS_CRON`, which defaults to every ten minutes, and the expiry sweep follows `BATCH_EXPIRY_SWEEP_MINUTES`, which defaults to every 60 minutes.

Configure `MAX_BATCH_ITEMS`, `MAX_BATCH_REQUEST_BODY_BYTES`, `BATCH_RETENTION_DAYS`, `BATCH_EXPIRY_SWEEP_MINUTES`, `BATCH_JOB_RETRY_LIMIT`, `BATCH_JOB_RETRY_BACKOFF_SECONDS`, `BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS`, `BATCH_SETTLEMENT_ALLOWANCE_MS`, `BATCH_MINIMUM_ITEM_COST_MS` and `BATCH_JOB_CONCURRENCY` before starting the deployment. `MAX_BATCH_REQUEST_BODY_BYTES` must be at least `MAX_REQUEST_BODY_BYTES`. Each item's compact re-serialised JSON remains bounded by `MAX_REQUEST_BODY_BYTES`; that per-item value is measured after parsing, while the whole-request limit measures submitted bytes. The [batch issuance settings](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/startup#batch-issuance-settings) table gives the defaults, readers and validation rules.

Before exposing `POST /api/v1/credentials/batches/{id}/cancel`, apply `20260918120000_credential_batch_cancel` and upgrade every worker. An old worker does not check cancellation between items, so a mixed worker deployment cannot uphold the cancellation contract. The route cancels every queued item, including deferred retries, leaves an item already in flight to finish, and revokes nothing. It returns `202` with the batch projection and this message:

> Queued items are cancelled. An item already processing may still be issued. Cancellation does not revoke any credentials.

`COMPLETED` and `CANCELLED` batches are retained for `BATCH_RETENTION_DAYS` from settlement. `NEEDS_ATTENTION` batches have no deadline until their last unknown item is resolved. The expiry sweep tombstones due batches before replay returns `410 BATCH_EXPIRED`. A repeated active cancellation returns `202` unchanged. Settled `COMPLETED`, `NEEDS_ATTENTION` and `CANCELLED` batches return `409 BATCH_NOT_CANCELLABLE`; expiry returns `410 BATCH_EXPIRED`; unknown or foreign ids return `404`. Recovery settles cancelled work without enqueueing issuance. See the [batch issuance runbook](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/batch-issuance).

The cancellation migration adds `CANCELLED` to batch and item states, `cancelledCount` and `cancelRequestedAt`, and updates the counter constraints. Existing batches start with cancelled 0 and a null cancellation timestamp. PostgreSQL cannot remove the enum value, so an application release whose generated Prisma client predates `CANCELLED` may fail to read rows carrying it. Do not roll back to such a release until cancellation admission has stopped, in-flight work has drained, and a database check confirms that no batch or item row carries `CANCELLED`.

### Issuer status management: read, change and reconcile

Issuers can read stored or fresh status observations with `GET /api/v1/credentials/{id}/status`, change one purpose with `PUT /api/v1/credentials/{id}/status/{purpose}`, and record a provider observation or recover an uncertain change with `POST /api/v1/credentials/{id}/status/{purpose}/reconcile`. Clients must read the entry version and send it in `If-Version`; missing or malformed values return `400 INVALID_IF_VERSION`, and successful status responses are `Cache-Control: no-store`. Treat an unconfirmed result as work to reconcile, not as proof that the change failed. Revocation cannot be cleared.

`DELETE /api/v1/credentials/{id}` returns `409 STATUS_OPERATION_IN_PROGRESS` while a status operation is pending. Effective configuration changes through `PATCH /api/v1/services/{id}` and service-instance deletion return `409 SERVICE_INSTANCE_STATUS_PENDING` while an unresolved status operation uses that instance. `force=true` does not bypass the deletion guard. The existing `acceptedReplacementDigest` column supports configuration repair, so no further migration is needed for those routes.

Native library records expose `lifecycle`, `status.statusCaptureError` and `capabilities.statusManageable`. They also report `STATUS_CHANGE_UNCONFIRMED` for pending intent and `ISSUER_STATUS_OBSERVATIONS_DIFFER` when a completed verification observation differs from a confirmed issuer observation. `statusManageable` is record eligibility, not proof that mutation is enabled. The verification `status` filter remains independent of `lifecycle`; `status=verified&lifecycle=none` does not establish present usability. See the [Library API](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/library#issuer-lifecycle).

`CREDENTIAL_STATUS_MUTATION_ENABLED` defaults to `false`. Set it to the exact value `true` only after confirming that participating writers share the coordination database and canonical provider identity. Reads and reconciliation remain available while mutation is disabled. Configure `CREDENTIAL_STATUS_OPERATION_BUDGET_MS` and `CREDENTIAL_STATUS_RECONCILE_GRACE_MS` when different allowances are required. Both Compose definitions forward these settings to the web service only, and no worker changes are required for credential-status operations. The [credential status recovery runbook](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/credential-status-recovery) covers the locking limit, activation and recovery procedures.

The OpenAPI document publishes stable operation IDs for credential status reads, changes and reconciliation, and for the library operations around them. Generated clients can use those names rather than deriving identifiers from paths. See the [Credential API](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/credentials) and [Library API](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/library).

### Issuance status purpose default and integer `statusListIndex`

A newly issued credential mints one status purpose and carries a single `credentialStatus` object, matching the UNTP v0.7.0 schemas. New issuance defaults to the existing `revocation` purpose, and callers may request `revocation`, `suspension` or both through `statusPurposes` when multiple purposes are enabled. The default is configurable with `CREDENTIAL_STATUS_DEFAULT_PURPOSES`; leaving it unset keeps the built-in `revocation` default, while `none` alone issues without status entries. `CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED` defaults to `false`, so one status purpose is issued by default. Set it to `true` to allow multiple purposes. A request with more than one `statusPurposes` entry returns `400 VALIDATION_FAILED` unless the opt-in is enabled, and a multi-purpose `CREDENTIAL_STATUS_DEFAULT_PURPOSES` refuses web boot until it is enabled.

Set `CREDENTIAL_STATUS_DEFAULT_PURPOSES=none` to issue credentials without status entries. Those credentials can never be revoked or suspended by the Reference Implementation. Newly issued credentials carry `statusListIndex` as an integer to match the published UNTP v0.7.0 schemas. Stored status-entry records retain the canonical decimal-string index, and previously issued credentials keep their numeric index and remain readable. A capture warning does not prevent issuance. The new status facts and capture state are visible on native library detail records; external records return no issuer-owned status facts. See the [Credential API](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/credentials#issue-a-credential).

### Backfills and configuration repair

After deployment, take the normal database backup and run `pnpm backfill:credential-status-entries` from `packages/reference-implementation`. Start with `--dry-run`, then run the write pass and review any reported failures. The job is conditional and idempotent. Once entries are present, run `pnpm backfill:credential-status-attribution --tenant <tenant-id> --instance <service-instance-id> --reason "historical service mapping"` for each operator-approved attribution. Use `--reassign` to reverse an operator assertion to the correct instance. Attribution is an operator assertion supported by bounded provider reads. See the [status-entry backfill](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/backfills/credential-status-entries) and [attribution backfill](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/backfills/credential-status-attribution) pages.

Use `pnpm services:repair-config --instance <id> --config <json-file> --allow-pending` when a pinned provider configuration is unusable while a status operation remains pending, then reconcile with explicit provider-change acceptance. The command refuses live reservations and preserves original pins and attribution. During a rolling upgrade, an older application version that reaches a new status-operation trigger sees an unmapped `500`, because it does not know the new conflict code. Drain status operations before rolling back. Do not delete captured rows during rollback. A later forward migration can resume from the recorded capture state. See the [credential status recovery runbook](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/credential-status-recovery#repair-an-unreachable-pinned-configuration).

### The batch response and error contract

Batch submission, replay, status and expiry responses carrying tenant-scoped data use `Cache-Control: no-store`. Missing, blank, over-length and non-printable `Idempotency-Key` values return `400 VALIDATION_FAILED`. Reusing an idempotency key with a different request body returns `422 IDEMPOTENCY_KEY_MISMATCH`; after retention, replaying the key returns `410 BATCH_EXPIRED`. The accepted and replayed `202` responses, as well as status and expired responses, carry `Cache-Control: no-store`.

Digital Conformity Credential issuance warns when an attestation or assessment score is not in the published framework, or when a scheme or profile reference names the wrong catalogue tier. Issuance still returns HTTP 201, and each warning carries the received value, expected publication evidence and the submitted pointer. Malformed scoring content fails the schema check as `SCHEMA_INVALID`; a refresh keeps its previous content and a first import writes nothing. The parser's stricter direct-consumer failures remain recorded in the [untp-utils 0.4.0 changelog](../untp-utils/CHANGELOG.md). See the [Credential API](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/credentials#issue-a-credential).

Catalogue fetches honour `FETCH_ALLOW_PRIVATE_URLS`: private sources are permitted when the deployment explicitly enables that setting, and the previous unconditional refusal no longer applies.

Upgrade from v0.5 in this order:

1. Back up the database and keep the backup with `DATA_ENCRYPTION_KEY`.
2. Apply the migrations by name: `20260916171436_credential_status_entries`, `20260917000000_add_credential_batches` and `20260918120000_credential_batch_cancel`.
3. Deploy the upgraded `ri-worker` before the web role, and keep the batch cancellation route unavailable until every worker has been upgraded.
4. Run `pnpm backfill:credential-status-entries` from `packages/reference-implementation`, starting with `--dry-run`, then run the write pass and review reported failures.
5. Enable `CREDENTIAL_STATUS_MUTATION_ENABLED=true` only after the checks in the [credential status recovery runbook](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/credential-status-recovery) confirm the shared coordination database and canonical provider identity.
6. Move parallel single-route bulk issuers to `POST /api/v1/credentials/batches`; single-route issuance now uses the status-list mutex and can return `503 STATUS_LIST_BUSY` under contention.

## 0.5.0 - 2026-09-14

v0.4 made the Reference Implementation safe to run in front of real data. v0.5 is about what a tenant holds rather than what it issues: a credential library that covers both the credentials you issued and the ones you received, with verification that runs in the background instead of blocking a request. Work that cannot finish inside a request now runs in a second container, so deploying v0.5 means deploying two.

The headline changes: the library gives a tenant one inventory for issued and received credentials, with durable copies and asynchronous verification. The deployment now needs a worker beside the web container, and the upgrade applies ten database migrations plus an operator-run backfill. Several environment variables and API contracts have changed, including the removal of the old encryption-key name and the retirement of two credentials read routes. The sections below cover these and the rest.

- Container image: [ghcr.io/uncefact/tests-untp/reference-implementation](https://github.com/uncefact/tests-untp/pkgs/container/tests-untp%2Freference-implementation) (`:0.5.0`, `:latest`)
- Upgrading from v0.4: this release removes an environment variable the v0.4 notes told you was optional to rename, renames three more, replaces the durable-copy read timeout, adds a second container you must deploy, adds ten database migrations and an operator-run backfill, and retires two API routes without a deprecation window. Read the [v0.5 migration guide](https://uncefact.github.io/tests-untp/docs/migration-guides/ri-v0.5) before you upgrade.
- Back up first: one migration restructures the credential tables under a new parent record, and there is no reverse migration. Returning to v0.4 means restoring the paired database backup and encryption key.

### A credential library, not just a credential list

v0.5 gives each tenant one inventory for credentials it issued and credentials it received. The library supports registration, list, batch-get, detail, recipient annotations, deletion and re-verification. Registering a received credential stores a durable copy, so the tenant's record remains available if the sender removes its copy. Detail is the only route that returns key material or storage coordinates. List and batch-get rows are keyless by design.

A row that cannot be built no longer prevents the rest of a library page from being read. List and batch-get responses return a `failures` array alongside `data`, still at HTTP 200. Pagination counts readable and failed rows, so callers advance by `limit` rather than by `data.length`. See the [Library API](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/library).

A `verified` summary now means that proof passed and no blocking check failed. Generations settled under the earlier rule are reclassified when read, so re-verify a record to refresh its evidence.

The tenant-scoped, idempotent `DELETE /api/v1/credentials/{id}` removes the library record, verification history and issuance idempotency claim in one transaction, then makes a best-effort attempt to remove the durable copy from its recorded coordinates. For a credential issued before v0.5, the record is deleted but its copy remains and its URI is logged because the new coordinates are empty.

The old credentials read routes are gone. `GET /api/v1/credentials` and `GET /api/v1/credentials/{id}` now return `410 Gone` after authentication and tenant resolution succeed, with `code: ROUTE_RETIRED` and no deprecation window. Use `/api/v1/library` and `/api/v1/library/{id}` instead.

The v0.4 notes said: "The credentials endpoints still return the plaintext key to callers who are entitled to it, unwrapping it on read." Those routes are the ones this release retires. The library detail route is now the place to retrieve a key when the service holds one and can reveal it.

Worker-settled library verification also runs an advisory schema-conformance check after credential details have been extracted. `schemaConformance` settles to `pass` or `fail` when the system core schema and JSON-LD document can be checked. A failure adds a `SCHEMA_CONFORMANCE_ADVISORY` warning and does not change the verification summary. The check remains `not_run` when its prerequisites or artefacts are unavailable. See the [library verification envelope](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/library#the-verification-envelope).

Verification now judges the credential's own `validFrom` and `validUntil` wherever a credential is verified, including the public `POST /api/v1/credentials/verify` route and the verify page. An unreadable bound fails the temporal check rather than being treated as absent.

### Background work runs in its own container

Verification that follows library registration or re-verification now runs in the background. `POST /api/v1/library/{id}/verify` returns `202` with the current record, and the worker performs the durable-copy read and verification. A slow or unreachable storage service no longer holds that request open.

The worker is a second container from the same image with `/app/docker-worker-entrypoint.sh` as its entrypoint and `/app/docker-worker-healthcheck.sh` as its healthcheck. It never migrates, seeds or runs backfills. It refuses to boot until the migrations in its image are applied, so the web container goes first. It also requires `DATA_ENCRYPTION_KEY`, where a keyless web process can start when it has no encrypted data. See [Worker Boot](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/worker#worker-boot).

The worker's background-job expiry and working budget are now controlled by `WORKER_JOB_TIMEOUT_SECONDS`, which defaults to 300 seconds and accepts 30 seconds to 24 hours. The web and worker must receive the same value. `LIBRARY_STORED_COPY_READ_TIMEOUT_MS` is removed and ignored if it remains set. The shared setting also bounds the in-request durable-copy read used by key-bearing recovery. With the default, the pending-run reconciliation cutoff is 60 minutes rather than 30 minutes.

The job queue and the worker are the foundation later releases build on for work that cannot finish inside a request, including bulk issuance. See the [Worker operations page](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/worker).

### Traces from both processes

The Reference Implementation and its worker export OpenTelemetry traces over OTLP. Each process uses its own service name so a dashboard can tell web requests and background work apart. Traces carry the package version and deployment environment as resource attributes. The SDK always exports traces, and `OTEL_EXPORTER_OTLP_ENDPOINT` points the exporter at a collector. Use the `local-observability` Compose profile for a local collector, Tempo and Grafana. The emitted web service name is now taken from `OTEL_SERVICE_NAME` (#989), and the worker's is taken from `OTEL_WORKER_SERVICE_NAME` through its Compose mapping. Log lines written through the application logger inside a span carry `traceId`, `spanId` and `traceFlags` beside `correlationId`. The span active in a route handler, which is Next's internal route span rather than the top-level server span, carries `correlation.id`, so query Tempo with `{ .correlation.id = "…" }` without a span-kind filter. A request-enqueued job carries the request's correlation id, and its worker job span is named after its queue and carries `correlation.id` and `job.id`. Request and job traces remain separate and are joined by the correlation id. OpenTelemetry pino instrumentation is disabled because the logger's own mixin supplies these fields. See [Observability](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/observability) for the settings and verification steps.

Metrics and log shipping to a log store are not part of this release.

### The key variable rename is finished

v0.4 renamed `SERVICE_ENCRYPTION_KEY` to `DATA_ENCRYPTION_KEY` and kept reading the old name with a warning. The v0.4 notes said: "The old name still works and logs a deprecation warning, so the rename is not a prerequisite for upgrading." That promise ends in v0.5. A deployment holding its key only under `SERVICE_ENCRYPTION_KEY` now fails to start with a rename message. Both names set to different values also refuse to run. Both names set to the same value use `DATA_ENCRYPTION_KEY` and log a reminder to remove the old name.

The container entrypoint now runs this configuration preflight before database URL construction and migrations, and exits 1 with the validation message when boot is refused. `SKIP_PREFLIGHT=true` is the exact bypass and emits a warning; recognised audit, rotation and backfill maintenance commands run their own checks instead of this preflight.

The rotation command reads its own key pair and is unaffected by the application fallback removal. Encrypted idempotency response bodies are now included with service configurations and credential decryption keys in encryption audits and key rotations. See the [v0.5 migration guide](https://uncefact.github.io/tests-untp/docs/migration-guides/ri-v0.5#service_encryption_key-is-no-longer-read).

### Retrying a write no longer risks a second credential

`POST /api/v1/credentials` now accepts an `Idempotency-Key`. A retry with the same key and body replays the original response, a retry while the first request is in progress returns `409 IDEMPOTENCY_KEY_IN_FLIGHT`, and the same key with a different body returns `422 IDEMPOTENCY_KEY_MISMATCH`.

Every API route that accepts a body now has a default request limit of 5 MiB (5242880 bytes). An over-limit body returns `413 REQUEST_BODY_TOO_LARGE`, including when the body is malformed. Set `MAX_REQUEST_BODY_BYTES` to a higher integer when larger requests are required. The value must be at least 1024 or the process fails to start.

### Credentials describe themselves

Credential records now carry the name, issuer name and DID, subject name and id, validity dates, core credential type and core data model version that were extracted from the credential. Failed extraction is stored as a status and reported as a warning rather than silently producing blank fields.

Credentials issued before v0.5 remain readable, but their descriptive fields remain pending until an operator runs `backfill:credential-details`. The command reads and decrypts each stored credential, reports every failed row and exits non-zero when any row fails. See the [credential details backfill](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/backfills/credential-details).

### The deployment keeps working when the UNTP host does not

The image bundles the UNTP and VC Data Model schemas and contexts used by the Reference Implementation. A failed fetch of a bundled artefact falls back to the copy in the image with a warning. `BUNDLED_ARTEFACTS_FALLBACK=false` restores strict host-fetch behaviour. Extension schemas and contexts that are not bundled remain dependent on their host.

This changes the meaning of `SCHEMA_FETCH_FAILED` and `JSONLD_CONTEXT_FETCH_FAILED`: with fallback enabled, either code can describe a fetch that was replaced by a bundled copy rather than a host outage. See [Bundled UNTP Artefacts](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/bundled-untp-artefacts).

### What the server will fetch, and what it tells a resolver

The SSRF guard now rejects IPv4-compatible IPv6 addresses, the 6bone address range and IPv6 addresses outside the allocated `2000::/3` Global Unicast block. `did:web` resolution pins connections to the validated address set, caps responses at 1 MiB, allows three additional redirects and applies a 10 second resolver timeout. Each redirect hop is checked again.

The three shared caller-supplied fetch settings are now named `FETCH_ALLOW_PRIVATE_URLS`, `FETCH_MAX_RESPONSE_SIZE` and `FETCH_TIMEOUT_MS`. The old names remain supported with a warning during v0.5. The bundled Compose file no longer forces the private-address setting on, so a deployment that set nothing changes from permissive to strict. Set `FETCH_ALLOW_PRIVATE_URLS=true` explicitly when private service addresses are required.

The SSRF helpers moved from `@uncefact/untp-ri-services/server` to `@uncefact/untp-utils/node`. The validated URL result also carries all validated addresses in `addresses`, so consumers that use its type must update. Published encrypted credential links now carry `encryptionMethod: "AES-256"`, while unencrypted targets omit the field. Link registration and update requests accept only `none`, `AES-128` or `AES-256`.

### Smaller changes

- **Keycloak moves to 26.7** for CVE-2026-18963. The bundled Compose web step recreates Keycloak and upgrades existing volumes in place.
- **Storage URIs use the storage service's `DOMAIN`.** The bundled `localhost:host-gateway` mappings let `ri` and `ri-worker` reach the `localhost` URIs they receive; a separately managed deployment must provide the same name reachability or set `DOMAIN` to a resolvable container name.
- **The storage service accepts more content types.** External credential registration stores JSON and binary durable copies, so `ALLOWED_UPLOAD_TYPES` gained `application/json`, `application/octet-stream` and `text/plain`. Deployments running their own storage service need the same change.
- **Batch reads have a bound.** `POST /api/v1/library/batch-get` accepts up to `API_MAX_BATCH_LIMIT` ids, default 500, counted before duplicates are removed.
- **Concurrent library edits use `If-Version`.** `PATCH /api/v1/library/{id}` requires the header and returns `409 VERSION_CONFLICT` for a stale version.
- **A NUL in an annotation is a 400, not a 500.** Registering a record with a NUL character in `displayName` or `notes` now reports the field before the database write.
- **The encrypted-column check covers new secret fields.** `pnpm build` fails when an encrypted column annotation is missing.

## 0.4.0 - 2026-08-17

v0.3 made the Reference Implementation an API-first, multi-tenant application. v0.4 is about making it safe to run in front of real data and predictable to integrate against.

The headline changes: the secrets it stores are now protected at rest. The API tells you when a request is wrong instead of guessing what you meant. A deployment that is misconfigured fails when it starts, rather than halfway through the first request that happens to need the missing piece. The custom seed manifest became the source of truth for the rows it describes, so taking an entry out of it now removes the row. And credential publishing changed how it finds what to publish against, reporting failures through codes that name the reason rather than one code covering everything. The sections below cover these and the rest.

- Container image: [ghcr.io/uncefact/tests-untp/reference-implementation](https://github.com/uncefact/tests-untp/pkgs/container/tests-untp%2Freference-implementation) (`:0.4.0`, `:latest`)
- Upgrading from v0.3: this release renames an environment variable, adds three database migrations, and changes several API behaviours you may be relying on. Read the [v0.4 migration guide](https://uncefact.github.io/tests-untp/docs/migration-guides/ri-v0.4) before you upgrade.
- Back up first: v0.4 encrypts credential decryption keys under your encryption key, so from this release a database backup is only restorable alongside the key that wrote it. See [Key Management and Recovery](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/key-management).

### Credential decryption keys are encrypted at rest

When you store a credential privately, the Reference Implementation holds the key needed to decrypt it. Until now that key sat in the database in plaintext, so anyone with read access to the database could recover the contents of every privately stored credential. In v0.4 the key is wrapped in an AES-256-GCM envelope before it is written, under the same key that already protected service instance configurations.

The API surface is unchanged. The credentials endpoints still return the plaintext key to callers who are entitled to it, unwrapping it on read. Private credentials issued before the upgrade keep their plaintext keys and keep working, because the read path still recognises them. A one-off, operator-run backfill brings those older rows under encryption when you are ready. See the [decryption keys backfill](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/backfills/decryption-keys).

Because that key now guards credential contents as well as service configuration, it was renamed from `SERVICE_ENCRYPTION_KEY` to `DATA_ENCRYPTION_KEY` to reflect what it actually protects. The old name still works and logs a deprecation warning, so the rename is not a prerequisite for upgrading.

### A misconfigured deployment fails at startup

In v0.3 a deployment could start with configuration missing and only discover the problem later, on whichever request first needed it. That turned a configuration mistake into an intermittent runtime error, often in front of a user. v0.4 checks the things it cannot work without before it serves anything.

The application now refuses to start when `RI_APP_URL` is unset, is not an `http(s)` URL, or carries a username or password. It refuses to start when the configured encryption key cannot decrypt an existing stored envelope, which catches a uniformly wrong or rotated key immediately instead of on the first request touching encrypted data. It refuses to start on the placeholder key shipped in `.env.example` unless `DEPLOYMENT_ENVIRONMENT` says the deployment is local. And the seed now fails the whole boot when a service category it was asked to configure is missing its environment variables, where it previously warned and quietly skipped that category. Set `SEED_ALLOW_PARTIAL=true` to restore the old behaviour, for deployments where a partial configuration is what you want. See [Startup](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/startup).

### The API rejects what it cannot honour

Request validation moved to the route boundary across nearly every resource: credentials, DIDs, products, organisations, facilities, registrars, identifiers and their links, identifier schemes, data models, services, render templates, and the conformity vocabulary browse endpoints. A malformed request is now answered with a 400 naming the field and the rule it broke, before anything is written, signed, or published.

That means some requests v0.3 accepted are now refused. v0.3 stored, coerced, or silently ignored a whitespace-only name, a URL with embedded credentials or a scheme other than `http(s)`, a malformed BCP 47 language tag, a duplicate entry in an identifier list, and a string where a boolean belongs. Each of those is now a clear rejection. The migration guide covers the classes of request that changed.

Pagination changed in the same spirit. Asking for a page larger than the maximum used to be silently reduced to the maximum, so a client asking for 500 records got 100 back with nothing to say why. Every list endpoint now returns a 400 stating the bound. Operators who need a different ceiling can set `API_MAX_PAGE_LIMIT`. See [API pagination](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/api-pagination).

### Errors name what went wrong

A conflict or a missing record used to escape some routes as a 500 carrying raw database text, which told the caller nothing useful and told them more than they should see about the internals. Database errors are now mapped to the right status across every write repository: a duplicate is a 409, a bad reference is a 400, a missing row is a 404, each with a message written for the person reading it.

Two multi-tenancy defects on service instances are closed in the same spirit. A system default instance is readable by every tenant, and a tenant could delete one, removing it for everybody; that now returns a 403. The reference counts in the delete conflict response were counted across all tenants, so the message reported how many of other tenants' records pointed at the instance; those counts are now the caller's own. The Swagger surface also publishes real error examples rather than bare schema references, so an integrator can see the shape of each failure before they meet it.

Failures inside the authentication and tenant-resolution pipeline now return the same documented JSON error envelope as every other route, rather than falling through to a plain-text 500. Every response carries a correlation id you can quote when reporting a problem, and that id now propagates across service boundaries, so a single request can be followed through the Reference Implementation and into the services it calls. When a credential payload fails JSON-LD expansion or schema validation, the response says which one failed and why, instead of reporting a generic validation failure.

### Publishing resolves from the credential's own identifier

Publishing a credential to an identity resolver used to work backwards from the master data record the credential referenced, reading the scheme off that entity. If the link to master data was missing or incomplete, the publish was skipped and reported with a single warning code that did not say which prerequisite was unmet.

Worse, two of those failures threw after the credential had been signed and stored, so the caller got an error back and never learned the id of a credential that now existed.

v0.4 resolves the publishing target from the credential's own identifier instead, which is the thing the credential is actually about. Publishing no longer depends on the master data link at all, so a credential whose identifier exists without a master data record, or whose match is a secondary identifier, now publishes where it previously could not. Issuance always returns the credential it created, and a publish that cannot proceed is reported as a warning on that response rather than as an error that discards it. When a publish genuinely cannot proceed, the response names the specific reason and says what to do about it. Callers relying on the old single code will need to update. The migration guide has the mapping.

Two consequences are worth planning for. An identifier value registered under two schemes no longer resolves silently to whichever one the entity match happened to pick, so the caller names it with the new `publishingOptions.identifierSchemeId`. And the identity resolver instance is now chosen from the scheme, then the registrar, then the tenant or system default, matching what the identifier links route already did, so a credential whose registrar carries a resolver instance may publish somewhere different than before.

Publishing also gained access roles on published links, a default human verification link pointing at this deployment's own verify page when you do not supply one, and validation that rejects a verification URL that is not a well-formed `http(s)` address before the credential is signed.

### Seed data reconciles against a manifest

The custom seed added rows and updated them, but never removed them. Taking an entry out of the manifest had no effect at all, so the database drifted from the file that was supposed to describe it.

In v0.4 the manifest is the source of truth for the rows it owns, so removing an entry removes the row. Registrars, identifier schemes, scheme qualifiers, data models, and render templates gained a provenance marker recording whether the core seed, the custom seed, or a person created them, and reconciliation only deletes what the custom seed itself established. Everything of those five kinds that existed before this release is marked as user-created and survives. A deletion that would cascade into data the manifest does not own stops that pass with an explanatory error and rolls back its writes.

Conformity schemes are the exception, and the one to check before upgrading. They carry their own separate provenance model rather than the new marker, so a scheme seeded before this release that the manifest no longer lists is evicted on the first boot, taking its profiles with it. Review the `conformitySchemes` section of your manifest against what is in the database first. The [migration guide](https://uncefact.github.io/tests-untp/docs/migration-guides/ri-v0.4) covers this.

Seeded conformity schemes also stopped being frozen after their first ingest. Schemes seeded from a URL are re-fetched on a configurable cadence, and file-seeded schemes refresh at boot, so a corrected scheme reaches the deployment without manual intervention. See [Custom seed](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/custom-seed).

### The verify page asks for the decryption key

A verify link for a privately stored credential does not carry the decryption key, because putting it in the URL would defeat the point of storing the credential privately. Until now, following such a link showed an error and left the recipient stuck.

The verify page now asks for the key. The recipient pastes the key they were given out of band, and the page verifies and renders the credential. The key is held only in memory for that page, never written to the URL, browser history, or storage, and it is cleared when the page is restored from the browser's back-forward cache. When a wrong key is entered the form comes back with the value intact so it can be corrected. When the credential is structurally unusable the page says so rather than inviting a retry that cannot help. The page's date row also moved onto the right data model, and every credential is affected. It was labelled "Issue date" and read `issuanceDate`, a VC Data Model 1.1 property. UNTP credentials follow VC Data Model 2.0, which replaced that field with `validFrom` and `validUntil`, so credentials the bridges build do not carry the field the page was reading. When it was absent the date library treated the missing value as the current time, so the page showed today's date as the credential's issue date, a fabricated value rather than an awkwardly formatted one.

The page now reads `validFrom`, and the label changed to "Valid from" so it describes the value actually being shown. The date renders as the credential's UTC calendar date in ISO 8601, so two people reading the same credential in different timezones see the same value, and the row is omitted when a credential carries no parseable `validFrom` rather than inventing one. `Valid until` is not displayed yet. See the [verify page](https://uncefact.github.io/tests-untp/docs/reference-implementation/verify-page).

### Tools for the operator who holds the keys

Encryption at rest is only as good as the operational story around it, so v0.4 ships the commands that story needs. A read-only audit reports what is encrypted, what is still plaintext, and whether the configured key can read it, without changing anything. A rotation command re-encrypts every stored envelope onto a new key. A backfill wraps the decryption keys of credentials issued before this release. Each has a documented procedure covering the preflight that aborts on a wrong key, what the run reports, and how to recover.

Deliberately, the backfill and the rotation are not run automatically at boot. Both rewrite data under a key, and a run against the wrong key cannot be undone from the data it leaves behind, so a human confirms the key first. The digest conversion backfill still runs automatically, because a wrong run there is recoverable from the data itself. See [Encryption audit](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/encryption-audit), [Encryption key rotation](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/encryption-key-rotation), and [Backfills](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/backfills/).

### What leaves the server, and what it will fetch

Sensitive fields are redacted from logs by default rather than by remembering to. Decryption keys, API keys, authorisation headers, tokens, and passwords no longer reach the log output, and an operator can add their own paths with `LOG_REDACT_PATHS`. See [Logging](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/logging).

Remote JSON-LD contexts and JSON Schemas are fetched through a guarded resolver that refuses private and loopback addresses, caps response size and redirect hops, and re-checks the address on every hop, so a credential cannot make the server fetch something it should not reach. Those documents are also cached now, which removes a network round trip from every issuance and verification, with the lifetime and cache size configurable. See [Step 4: Application Start](https://uncefact.github.io/tests-untp/docs/reference-implementation/operations/startup#step-4-application-start) for the cache and User-Agent settings and what startup validates.

### Smaller changes

- **Identifier uniqueness is scoped to the tenant.** Two tenants can now register the same identifier value against a shared system scheme. Previously the second one failed on a database constraint it could neither see nor resolve.
- **The image carries its own health check.** The probe used to live only in the shipped Compose file, where it targeted `localhost`. BusyBox wget resolves that to the IPv6 loopback first while the container listens on IPv4 only, so it never passed and the container was reported unhealthy however well it was running. It is now a `HEALTHCHECK` in the image against `127.0.0.1`, so anything running the image gets a working check without configuring one, and the Compose file no longer repeats it. Kubernetes ignores Docker health checks and still needs its own probes against `/api/health`.
- **OpenTelemetry filesystem auto-instrumentation is off by default**, which removes a large volume of low-value spans from traces.

## 0.3.0 - 2026-06-02

This is the largest change to the Reference Implementation since its inception.
The application has moved from a single, configuration-file-driven build to a
multi-tenant, API-first application with a pluggable service layer. If you ran
0.2, almost everything about how you stand it up, configure it, and integrate
with it is different. This release also brings the Reference Implementation up
to UNTP v0.7.0.

- Container image: [ghcr.io/uncefact/tests-untp/reference-implementation](https://github.com/uncefact/tests-untp/pkgs/container/tests-untp%2Freference-implementation) (`:0.3.0`, `:latest`)
- Getting started: because of the architectural changes below, 0.3 is a fresh deployment rather than an in-place upgrade from 0.2. See the [Quick Start](https://uncefact.github.io/tests-untp/docs/reference-implementation/quick-start).
- Dependent services: the storage service and identity resolver move to v4 in this release. If you run existing instances, back up their data and follow the [v0.7.0 migration guide](https://uncefact.github.io/tests-untp/docs/migration-guides/v0.7.0) before upgrading them.

### From a configuration file to an application

In 0.2 the application was assembled at build time from a single JSON
configuration file. The interface, the data models, and the behaviour were all
driven by that file, which made the Reference Implementation cumbersome to set
up and change, and limited it to a single organisation. In 0.3 that file is
gone: the application is backed by a database and an identity provider, and
every operation is available as a REST endpoint with a browsable Swagger UI at
`/api-docs`. What used to be a careful edit of a config file is now an
application you run, call, and integrate with.
See [System Architecture](https://uncefact.github.io/tests-untp/docs/reference-implementation/system-architecture).

### Multi-tenant from the ground up

0.3 is multi-tenant. Each tenant is isolated, with its own credentials,
identifiers, and configuration, and both browser users and API service accounts
authenticate through an identity provider. The instance runs in one of two
modes: in open mode, people sign themselves up through the identity provider and
a tenant is created for them automatically; in closed mode, whoever administers
the identity provider provisions the users and maps each one to a tenant by
group. See [Authentication and tenant modes](https://uncefact.github.io/tests-untp/docs/reference-implementation/authentication/tenant-modes).

### Your API secrets stay on the server

In 0.2 the application embedded the credentials it needed into the browser
bundle, so API secrets were shipped to, and visible in, the client. In 0.3 every
call to a dependent service goes through a server-side API route, so secrets and
service configuration stay on the server and never reach the browser. They are
also encrypted at rest: each service instance's configuration is stored
encrypted with AES-256-GCM and decrypted only when a request needs it.

### A pluggable service layer

0.3 introduces a service-and-adapter layer. Verifiable-credential, storage, and
identity-resolver providers are resolved at runtime through a typed registry,
and each tenant can either use the bundled default instances or register and run
its own. That gives organisations an adoption ramp: start on the bundled
services, move to your own instances of them as you mature, and eventually swap
in a different implementation by contributing an adapter, with only the
configuration changing at each step. See
[Service Architecture](https://uncefact.github.io/tests-untp/docs/reference-implementation/services/service-architecture).

### Data models are versioned code, not static config

In 0.2 the credential data models lived as static definitions inside the
configuration file. In 0.3 they are versioned bridges in code: each UNTP version
has its own builder and extractor, and the Reference Implementation selects the
right one when you issue a credential. This is what lets a single deployment
support both v0.6.x and v0.7.0 side by side. See
[Data models](https://uncefact.github.io/tests-untp/docs/reference-implementation/data-models/).

### Issue, store, publish, and verify credentials

0.3 takes a credential through its whole lifecycle. You issue a credential, store
it publicly or privately (private credentials are encrypted automatically),
publish it to an identity resolver so trading partners can discover it from a
product or facility identifier, and verify it. Verification fetches the
credential, checks its integrity, verifies the issuer's signature, decrypts it if
it is private, and renders it for a person to read. Recipients verify through a
public, no-login [verify page](https://uncefact.github.io/tests-untp/docs/reference-implementation/verify-page).
See the [Credentials API](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/credentials).

### Master data you define once

Credentials are issued about real-world things, and in 0.3 those things are
first-class records. Each tenant maintains its own organisations, facilities, and
products, along with the identifier schemes (GTIN, ABN, and the like) and
registrars that govern their identifiers. You define an entity once and reuse it
across credentials rather than re-entering it each time, and once a credential is
issued the Reference Implementation links it back to the entities it describes,
so you can find credentials by the entity they are about. See
[Master data](https://uncefact.github.io/tests-untp/docs/reference-implementation/master-data).

### Bring your own signing identity

Every credential is signed with a Decentralised Identifier (DID), and 0.3 gives
DIDs their own adoption ramp. A tenant can issue compliant credentials from day
one with the shared system DID, create a managed `did:web` where the verifiable
credential service holds the keys, or run a self-managed DID whose document and
key material live entirely on the tenant's own infrastructure. See
[DIDs](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/dids).

### Built to be extended

UNTP defines the core data models that industries and regions can extend, and 0.3
makes that a first-class operation. An extension builds on a specific version of a
UNTP core type, adding fields without removing the core ones, and carries its own
name, version, schema, and context. Extensions arrive at two layers: whoever
provisions an instance can add system extensions, exposing those data models
across the instance so every tenant can issue credentials against them, and any
tenant can add its own extensions, scoped to just that tenant. Either way, because
the extension keeps the parent's core properties, the parent's data model bridge
applies to it, so credentials can be issued against it immediately, with no change
or redeploy to the system.

How a credential looks is just as open. Every credential type and version ships
with a system render template, an HTML and Handlebars layout maintained by the
data model's authors, that works out of the box. A tenant can use it as-is or
treat it as a starting point: retrieve it, restyle it for their own branding, and
upload the result as their own template, which then takes precedence once set as
the default for that data model. See the
[Data Models API](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/data-models)
and [Render Templates API](https://uncefact.github.io/tests-untp/docs/reference-implementation/api/render-templates).

### UNTP v0.7.0 and upgraded dependent services

All five UNTP credential types are now available at v0.7.0 (Digital Product
Passport, Digital Conformity Credential, Digital Facility Record, Digital
Identity Anchor, and Digital Traceability Event), sharing a single JSON-LD
context. The storage service and identity resolver were upgraded to v4, and
stored integrity digests moved to a multibase format, with existing data
converted automatically on upgrade. Conformity vocabulary now follows the
v0.7.0 per-scheme model with a read-only browse API; see
[Conformity handling](https://uncefact.github.io/tests-untp/docs/reference-implementation/data-models/conformity-handling).
The [v0.7.0 migration guide](https://uncefact.github.io/tests-untp/docs/migration-guides/v0.7.0)
covers all of this in detail.

### A foundation for integration and self-service

Individually these are features; together they change what the Reference
Implementation is. A new tenant is productive immediately against the shared
system defaults, then takes ownership at its own pace, registering its own
services, signing identities, render templates, and extensions as it matures. Two
audiences build on that. System integrators drive every capability over the REST
API today, using the Reference Implementation as the UNTP layer inside their own
systems. And the reusable building blocks this release introduces, master data,
the data model bridges, conformity vocabulary, and render templates, are what make
a genuine self-service web UI possible: rather than re-keying a credential field
by field as 0.2 required, a user picks the entities and the credential version and
lets the bridge assemble the payload. That web UI is under active development on
top of this release.
