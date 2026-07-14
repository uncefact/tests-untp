# ADR-033: UNTP v0.7 Conformity Vocabulary Catalogue Architecture

- **Date:** 2026-05-21
- **Status:** accepted
- **Update (2026-05-27):** The services-side function this ADR calls `ingest(input)` ships as `resolveAndParseConformityScheme(input)`. "Ingest" is reserved for the RI-side step that consumes this function's output and performs the actual persistence (the RI iterates `parseConformityCatalogue` entries during UNTP discovery and calls it once per scheme; the tenant-import endpoint and the seed loader call it the same way). The function returns a discriminated `{ kind: 'unchanged' | 'success' | 'failure' }` result and never throws for known gate failures. The gate order is fetch, then JSON parse, then JSON Schema validation, then JSON-LD expansion, then parse, then body-digest. Schema validation runs before JSON-LD expansion because Ajv compile + check is local CPU, while JSON-LD expansion may fetch remote `@context` documents and walks the full RDF tree. Six `lastFetchStatus` values are now distinguished: `FETCH_FAILED`, `INVALID_JSON`, `SCHEMA_INVALID`, `JSONLD_EXPANSION_FAILED`, `PARSE_FAILED`, and `DIGEST_FAILED`. The body of this ADR retains the original framing for historical record.
- **Update (2026-05-28):** Three policy decisions captured while building the RI-side ingest + UNTP discovery loop. (1) Seed-loader collision policy will be insert-only-if-absent (implementation pending in #689): when a row already exists for `(sourceUrl, tenantId)` in the system tenant, the seed loader skips that entry rather than overwriting it, preserving any post-seed updates from UNTP discovery or operator action. (2) UNTP discovery is toggled by the `CVC_REGISTRY_URL` env var as already specified in §1; an empty value puts the system in seed-only mode (trigger implementation pending in #690). (3) Tenant boundary (now in effect via the data model): tenants write only to their own `tenantId`; system-tenant rows (UNTP / SYSTEM_SEED) are read-only to non-system callers. Tenant imports are permitted to coexist with system-tenant rows under the same `sourceUrl` because the unique constraint is `(sourceUrl, tenantId)`, so the rows live in different unique-index slots; tenants can therefore keep their own snapshot of a UNTP-published scheme without conflict. Two new failure statuses, `INVALID_JSON` and `DIGEST_FAILED`, joined the §1 set noted above; `TOO_LARGE` is retained as a distinct status so an oversized-document signal stays distinguishable from a generic network failure in the operator view. Six become eight `lastFetchStatus` values; the body's "six" wording is superseded by this update.
- **Update (2026-05-30):** The criterion topic-mismatch warning (§3) now covers a criterion's full topic set, in both directions. A criterion defines one or more conformity topics, and a profile references the criteria that carry them, so validation checks every topic the claim declares for a criterion against the topics that criterion defines, reached through the profile's criteria. It flags a declared topic outside the criterion's defined set, and a defined topic the claim omits. The §3 row describes only the first direction and a single topic; this update supersedes that wording. See #696.
- **Update (2026-06-01):** The §1 browse capability ships as three issuer-facing read endpoints over the local catalogue projection: `GET /api/v1/cvc/schemes`, `GET /api/v1/cvc/profiles?schemeId=`, and `GET /api/v1/cvc/criteria?profileId=`. Each entry's `id` is the stable canonical (versioned) URI a `conformityClaim` carries, so issuers reference a selection by its URI rather than by an internal row id. Visibility follows the tenant model in §1 and §3: each lookup returns the system catalogue (UNTP and operator-seeded) together with the calling tenant's own imports, and a system-tenant entry supersedes a tenant import of the same URI. The DCC, DFR, and DPP form configurations back their scheme, profile, and criteria pickers off these endpoints. The §1 note that browse is exposed "only as an API" in v1 still holds; the UI pickers remain a later milestone. See #544.
- **Update (2026-07-01):** §7's "JSON-LD expansion" security control (the "JSON-LD document loader instead applies the same `validatePublicUrl` guard so `@context` fetches cannot reach private addresses", also stated under Alternatives Considered) was a design commitment that had not been realised in code: `validateJsonLd` called `jsonld.toRDF` with no `documentLoader`, so remote `@context` documents were fetched by jsonld.js's default Node loader with no SSRF guard, on both the conformity-scheme ingestion path and the credential-validation path. The schema loader (`createSchemaLoader`) fetched JSON Schemas with a raw `fetch` for the same reason. #707 adds a shared guarded primitive, `resolveJsonDocument` (guarded fetch plus JSON parse over `validatePublicUrl`, with IP pinning and the standard size, redirect, and timeout bounds), and routes both the JSON-LD `@context` document loader and the schema loader through it, so the §7 guard now holds in code across the JSON and JSON-LD fetches the CVC and credential pipelines perform. Resolved documents can be reused via an injected `TtlCache`. The body retains its original framing for historical record.
- **Update (2026-07-08):** Three extraction/validation refinements for schema-valid v0.7.0 DCCs (see #748). (1) The v0.7.0 claim extractor reads topic declarations verbatim at the level the credential makes them, with no copying between levels. A criterion's own `conformityTopic` entries are that criterion's declared topics, and each assessment's `conformityTopic` entries are extracted alongside the criterion URIs that assessment references. The specification text marks criterion classification a MUST even though the published JSON Schema declares the field on the assessment only, a divergence reported upstream, and ADR-038 records the lenient treatment of unclassified criteria while it stands. Previously the extractor read only a criterion-level path that the published schema does not define or require, and never the assessment-level `conformityTopic` the schema does require. (2) The §3 warning set gains `conformity-assessment.topic-mismatch`. An assessment's declared topics are checked, one direction only, against the deduplicated union of the published topics of its criteria. A declared topic outside the union warns, while a union topic the assessment omits is acceptable because assessment topics categorise rather than enumerate, and the published v0.7.0 sample instance declares a subset so it must validate clean. The check runs only when the assessment references at least one criterion and every referenced criterion resolves in the profile. A parent-level topic on an assessment with no criteria is the claim's only classification, so there is no criteria union to check it against, and a partial union from unresolved criteria would make the warning unfounded. (3) `referenceProfile` is not required by the published schema, so a claim without one is extracted rather than skipped, and the §3 set also gains `conformity-profile.not-specified`, emitted when the scheme resolves but the claim names no profile, conveying that criterion and topic checks were not performed because criteria are published per versioned profile. Validation remains advisory per §3.
- **Update (2026-07-13):** Convention for scaling claim validation across spec versions, recorded when the `assessments` field joined `ConformityClaim` (see #748). The conformity lane keeps one version-neutral core between two versioned adapter layers. Data model bridges normalise credentials into `ConformityClaim`, the `conformity-vocabulary` parsers normalise scheme documents into `ConformityScheme`, and `validateConformityClaim` only ever compares the two projections. `ConformityClaim` fields are optional capabilities keyed on presence rather than version. An extractor populates a field only when its data model carries the concept, and the validator runs a rule only when the data is present, which absorbs additive spec evolution without version conditionals. Two rules keep this scalable. An interlingua field is never repurposed with changed semantics; new meaning gets a new field or a rules fork. And the first version conditional inside the shared validator is the signal to fork the rules into versioned modules under the same delta pattern the parsers already use, resolved by the claim's spec version, not to add the conditional. The versioned rule registry is deliberately not built ahead of that first genuine semantic fork.
- **Update (2026-07-14):** The `@uncefact/untp-utils` sub-entry named `./schema-loaders` in the "Utility primitives the RI composes" table is renamed to `./loaders`, and the exported symbol is the `createSchemaLoader` factory (formerly `makeSchemaLoader`; `fetchSchema` has only ever been an internal helper, never the export). The table row is superseded by this naming. See #732.

## Context

UNTP v0.7 changes how the Conformity Vocabulary Catalogue (CVC) is published and consumed. The catalogue itself is a thin registry of pointer URIs maintained by UNECE. Scheme owners publish their conformity schemes at their own stable URIs. A conformity scheme inlines its profiles, and each profile inlines its criteria; the scheme itself is not independently versioned, but profile and criterion URIs are stable and independently versioned (for example, `myscheme.org/profiles/mine-site/1.0.0` and `myscheme.org/criterion/forced-labour/1.0.0`).

The reference implementation (RI) currently models the catalogue as a single self-contained JSON-LD document, imported per tenant. That shape does not match the v0.7 model and cannot be retrofitted without redesigning the ingestion pipeline, the data model, and the validation surface.

A practical force that shapes this design: the spec promises stable, versioned URIs, but it does not technically enforce that the content at those URIs is immutable. The CVC and UNTP v0.7 are both early. Scheme owners are actively iterating on their profiles and criteria during development; the bytes returned from a "stable" URI today are not guaranteed to be the same bytes tomorrow. This is the reason this design includes a periodic refresh of the UNTP-discovered set, a body-digest comparison on every refetch, and a stored `rawDocument` for replay and diff. Treating the URIs as content-immutable would be reading the spec more strictly than the ecosystem actually behaves.

Three user-facing capabilities are in scope:

1. **Browse.** Consumers must be able to navigate the registered schemes, the versioned profiles inside each, and the versioned criteria inside each profile. In v1 the RI exposes this navigability only as an API; issuers consume it directly from the API documentation when authoring credentials. In a later milestone the RI's own UI will back form-level pickers off the same API, both at the point of registering products, facilities, and organisations (where the entity declares the conformity scheme profile it conforms to) and at the point of issuing credentials whose claims reference a scheme profile. Selection is not "copy a URI"; it is "pick a scheme, pick the version of the profile", with the API yielding the stable, versioned URIs the credential ultimately carries.
2. **Validation.** When an issuer submits a Digital Conformity Credential (DCC), the RI must check that the credential's `conformityClaim` references a scheme, profile, and criteria that exist in the locally known vocabulary, and that the criteria the credential claims line up with the criteria the profile publishes. Matching is on exact URIs (and for profiles and criteria that includes the version segment).
3. **Tenant prototyping.** Tenants must be able to register their own conformity schemes (not in the UNTP registry) for development and prototyping, both at deploy time (operator seed) and at runtime (tenant API).

Non-functional forces:

- **Durable.** The RI must not lose availability when the UNTP registry or a scheme owner's site is slow or offline.
- **Scalable.** Browse and validation are hot paths and must not fan out network requests on every call.
- **No new infrastructure.** The deployment topology is a Next.js container against Postgres. Adding a separate worker process, message broker, or cron container is undesirable.
- **No role-based access control yet.** The RI authenticates users via NextAuth + Keycloak but does not currently distinguish operator from tenant inside the application. Operator capabilities that would normally sit behind a role check (for example, triggering an ingestion run ahead of the next periodic tick to pick up a freshly published scheme) are deferred until role-based access control lands, rather than being shipped without role checks.
- **Shared validation surface.** The same logic is needed in the RI (at DCC issuance), the UNTP test suite (as a conformance stage), and the UNTP playground. Three independent implementations would drift.

Related issues: #533 (this ADR), #539 (initiative), #541 (CVC implementation parent), #542, #543, #544, #545, #546, #517, #540.

## Decision

Adopt a **cached, periodically refreshed, in-process** model for the Conformity Vocabulary Catalogue. Persist the registry's pointer URIs and their resolved conformity schemes into a typed projection in the RI's Postgres database. Browse and validation both serve from that projection; the RI does not make outbound HTTP calls to the UNTP registry or to any scheme owner's site on the request path. The only place CVC data touches the network is inside the ingestion function, which runs off-band of user requests (boot, periodic interval, or tenant import). Place the pure validation primitives in `@uncefact/untp-utils` so the RI, the test suite, and the playground share one implementation.

The following sub-decisions compose this architecture.

### 1. Discovery and refresh

- **Discovery.** Ingestion fetches the UNTP registry from an operator-configured URL, parses it to a list of scheme URIs, and resolves each conformity scheme from its owner URI. If no registry URL is configured, the RI runs in seed-only mode (no remote discovery).
- **Refresh scope.** Periodic refresh applies **only to UNTP-discovered schemes** (`source = 'untp'`). Operator-seeded schemes refresh on boot from local files only. Tenant-imported schemes are treated as snapshots at the moment of import and are never automatically refetched; a tenant who wants newer content re-calls the import endpoint. This avoids the RI fanning out periodic outbound requests against arbitrary tenant-controlled URLs (dev servers, tunnels, half-baked endpoints), which would fail noisily for content the tenant deliberately wanted as a snapshot.
- **Refresh cadence.** A periodic refresh of the UNTP-discovered set (default cadence 24 hours; configurable). The first ingestion runs immediately on server startup (alongside the seed loader) so a fresh deployment populates without waiting for the first interval to elapse; the interval then ticks at the configured cadence with a small random jitter applied to each tick, so synchronised outbound requests are avoided if the deployment ever scales out across replicas (today single-replica, but the cost of jitter is negligible). The refresh runs in-process via an interval registered in the Next.js server startup hook. There is no separate worker and no cron container. A manual operator-triggered refresh is a wanted capability (for example, picking up a freshly published scheme ahead of the next tick) but is deferred to a follow-up: it should be gated by an operator role, and the RI does not yet have role-based access control.
- **Skip chain on refetch.** Each scheme fetch first issues `If-None-Match` (with the stored `etag`) and `If-Modified-Since` (with the stored `lastModifiedHeader`). On `304 Not Modified` the run skips parse and persist, and only bumps `lastFetchedAt`. On a `200`, the response body is hashed (via `MultibaseDigest.fromData`) and compared to the stored `bodyDigest`; if unchanged, parse and persist are still skipped. This is implemented as a util-level primitive (`resolveDocumentIfChanged` in `@uncefact/untp-utils/resolvers`) so the same skip semantics are available to the test suite and any other consumer that caches scheme content.
- **Validation at ingest.** Before a fetched document is parsed and persisted, the ingestion pipeline runs two gates: (a) JSON-LD expansion via `jsonld.toRDF(doc, { safe: true })` from `@uncefact/untp-utils/validation`, which catches malformed contexts, undefined terms, and structurally invalid linked data; (b) JSON Schema validation against the UNECE-published `ConformityScheme.json` schema, fetched and cached via `@uncefact/untp-utils`'s `fetchSchema`. A failure at either gate marks the row's `lastFetchStatus` (`'jsonld-expansion-failed'` or `'schema-invalid'`), captures the error detail, and aborts that scheme's ingestion; any previous successful content for the row is retained.
- **Partial-failure behaviour.** Ingestion is best-effort: each scheme is fetched in its own try boundary; failures are recorded per row, the previous successful document for that scheme is retained, and other schemes continue to refresh. Each `ConformityScheme` row carries `lastFetchedAt`, `lastFetchStatus`, `etag`, `lastModifiedHeader`, `bodyDigest`, and the raw resolved JSON-LD document.
- **Staleness (operator-visible only).** Each scheme row carries `lastFetchedAt` and `lastFetchStatus`. A scheme whose last successful refetch is older than the staleness threshold (default 7 days; configurable) is reported as stale on the operator-visible surfaces: the scheme list endpoint response includes a derived `stale` boolean alongside the underlying timestamp, and the observability stack emits a metric / log signal for downstream alerting. Staleness does not surface as a warning on DCC validation; a stale local cache says nothing actionable to the issuer about their credential's claims.

### 2. Tenant-imported schemes and operator-side seeding

- **Tenant API.** `POST /api/v1/cvc/schemes` accepts a `{ url, cvcSpecVersion? }` body. `cvcSpecVersion` is the version of the **CVC specification** the document conforms to (for example `0.7.0`); it has nothing to do with the version of any particular scheme, profile, or criterion. By default the value is detected from the document's `@context` via `detectVersionFromContext` in `@uncefact/untp-utils`; the optional `cvcSpecVersion` is an override for callers who need to pin a specific parser (typically for testing, or when a draft document's `@context` is ambiguous). The selected parser is resolved from the version-keyed parser registry. The request runs the same fetch + skip-chain + parse + persist pipeline that the periodic refresh runs, but as a one-shot synchronous call returning success or a structured error. The scheme is persisted under the calling tenant's `tenantId` and is treated as a snapshot: it is not periodically refetched. A tenant who wants newer content re-calls the endpoint (the upsert path naturally replaces the existing row). Tenant-imported schemes are visible only to the importing tenant. The path to making a scheme globally discoverable is external to the RI: the tenant registers their scheme with UNTP for inclusion in the Conformity Vocabulary Catalogue, after which the RI discovers and resolves it on the next periodic refresh like any other UNTP-registered scheme. No in-app promotion mechanism is required.
- **Operator seed.** Operator-shipped conformity schemes (JSON-LD) in the operator seed directory are ingested on first boot (and re-ingested on each boot, idempotently) into the system tenant. The same ingestion function handles seed input as handles a fetched scheme.
- **Visibility model.** Lookups across schemes, profiles, and criteria filter by `tenantId IN (currentTenant, SYSTEM_TENANT_ID)`, the pattern already used in the codebase for shared resources.
- **URI uniqueness and conflict resolution.** A scheme's canonical URI is unique within the system-tenant lane: at most one row exists for a given URI with `source = 'untp'` or `source = 'system-seed'`. A tenant attempting to import a URI that already exists in that lane is rejected with a conflict error and a message pointing at the existing entry. The tenant already sees that scheme through the standard visibility model; allowing them to layer a private copy on top of a registered URI would let a tenant overlay a tampered or stale version of an already-trusted scheme ("CVC hijacking"), and their own DCC validation would happily pass against that overlay. Within-tenant re-import upserts. Different tenants can independently import the same URI under their own scopes (cross-tenant isolation is the existing visibility pattern, unchanged). The reverse case (UNTP refresh picks up a URI that one or more tenants have already imported privately) is captured as a follow-up in §8 ("Supersession of tenant-imported schemes by UNTP-discovered ones"). The v1 query precedence is explicit: when rows for the same canonical URI exist in both the system-tenant and the tenant-imported lanes, lookups return the system-tenant row only; the tenant-imported row is suppressed from query results but kept on disk pending the supersession follow-up. This prevents duplicate results in API responses without destroying tenant data.

### 3. Validation severity and warning codes

Validation is advisory only. DCC issuance never fails on a CVC mismatch; the response carries a `warnings[]` array, namespaced `conformity-claim.*`. Matching is by exact URI: a profile or criterion URI on the claim must appear in the scheme's published profile and criterion list. Because profile and criterion URIs include a version segment per spec (for example `myscheme.org/profiles/mine-site/1.0.0`), bumping the version produces a distinct URI; whether both versions remain in the scheme is the scheme owner's choice. Scheme URIs are stable and do not carry a version segment.

Validation walks the hierarchy in order (scheme → profile → criteria → criterion topics) and short-circuits at the first miss: if the scheme URI is unknown, profile and criterion checks do not run; if the profile is not in the scheme, criterion checks do not run.

| Code | Fires when |
| --- | --- |
| `conformity-claim.scheme-not-found` | The scheme URI on the claim is not in the catalogue or any tenant import |
| `conformity-claim.profile-not-found` | The scheme is recognised, but the claim's profile URI is not among its profiles |
| `conformity-claim.criterion-not-in-profile` | A criterion URI on the claim is not in the profile's published criterion list |
| `conformity-claim.criterion-missing` | A criterion that the profile publishes is not present on the claim (partial coverage; acceptable, but worth surfacing) |
| `conformity-claim.criterion-topic-mismatch` | A criterion on the claim declares a conformity topic that does not match the topic the scheme publishes for that criterion |

The validation does not check criterion pass thresholds or score values; that is a separate concern and out of scope here.

### 4. Validation logic location

Validation lives in `@uncefact/untp-utils/conformity-vocabulary` as pure, side-effect-free functions. The package layout exposes:

| Function | Purpose |
| --- | --- |
| `parseConformityCatalogue(doc)` | Parse the UNTP registry document into `{ schemeUris: string[] }` |
| `parseConformityScheme(doc)` | Parse an owner-published conformity scheme into a structured tree (scheme, profiles, criteria) per the active CVC spec version |
| `validateConformityClaim(claim, scheme)` | Cross-check a credential's claim against a parsed scheme; returns `{ warnings: ConformityClaimWarning[] }` |

These functions never fetch and never read the database. The caller (RI, test suite, playground) is responsible for sourcing the parsed scheme; the function compares it to the claim and returns warnings. The UNTP test suite wraps `validateConformityClaim` in its `conformity-claim.*` T2 stages; the RI calls it directly during DCC issuance after looking the scheme up in its local database; the playground will call it the same way once its server-side validation route lights up.

### 5. Data model and migration

Schema changes in the RI:

- **Drop** `CvcCatalogue`. The catalogue is no longer a content document; it is a registry URL. The table has no row-level analogue under the new model.
- **Keep and extend** `ConformityScheme` with `source` (`'untp' | 'system-seed' | 'tenant-imported'`), `sourceUrl`, `lastFetchedAt`, `lastFetchStatus`, `etag`, `lastModifiedHeader`, `bodyDigest`, and `rawDocument` (the resolved JSON-LD blob, stored for replay and debugging).
- **Keep** `ConformityProfile`.
- **Rename** `Criterion` to `ConformityCriterion` for alignment with the hierarchy.
- **Rename** the join table `ProfileCriterion` to `ConformityProfileCriterion`.

The prior data is **sunset**, not migrated. The pre-v0.7 tenant-imported catalogues were ingested under a parser whose JSON-LD shape does not match the final v0.7 specification; the data is incorrect and re-import is required regardless of migration cost. A Prisma migration drops the old tables; the operator-seed loader repopulates the system tenant on next boot; tenants must re-import any custom schemes through the new tenant API.

### 6. Topology

The ingestion class lives in `@uncefact/untp-ri-services`. It is a plain function call (`ingest(input)`), not a daemon. Three trigger points share the same function:

1. **Boot-time seed loader**, registered in the RI's server startup hook, runs once and loads JSON-LD files from the operator seed directory into the system tenant.
2. **Periodic refresh**, registered as an interval in the same startup hook, ticks at the configured cadence and re-ingests the registry (when a registry URL is configured).
3. **Tenant import**, the HTTP route handler behind the tenant import endpoint, calls the function synchronously and persists the scheme under the caller's tenant.

No new process, container, or scheduler is required. Validation at DCC issuance reads only from the local database and is not on the refresh path. A manual operator-triggered refresh is intentionally absent from this list; the capability is wanted but is deferred until role-based access control lands (see the "No role-based access control yet" force in the Context).

The in-process timer is single-replica-safe. Multi-replica deployments will run the timer on every replica, multiplying outbound requests against scheme owner sites. Each tick has a small random jitter applied (see §1) so at least the per-tick fetches are spread rather than perfectly synchronised, but this is a partial mitigation only. The RI is currently single-replica (Docker Compose locally; one Pulumi-managed container in deployment), so the multi-replica case is not active today. If the RI is scaled horizontally in the future, this design needs leader election (one replica owns the timer) or a switch to an external scheduler (k8s CronJob, queue-backed worker); both are deferred until the deployment topology actually requires them.

### 7. Security considerations

The ingestion function fetches arbitrary URLs and persists their content. The hardening lives in `@uncefact/untp-utils` so the RI, the test suite, and the playground all benefit from it; the RI composes the primitives rather than reimplementing them.

- **SSRF guard on all tenant-supplied URLs.** Every URL submitted via the tenant import endpoint, and every `@context` URL encountered during JSON-LD expansion, goes through `validatePublicUrl` from `@uncefact/untp-utils/node`. The guard blocks private IPv4 and IPv6 ranges, loopback, link-local, and cloud metadata addresses, and re-resolves the hostname at connect time to defeat DNS rebinding. The operator-set registry URL is trusted by configuration and bypasses this guard.
- **Fetch hardening.** Provided by the `@uncefact/untp-utils/resolvers` wrappers and reused for every CVC fetch: a maximum response size (default 1 MB; configurable), bounded connect and read timeouts, and a max redirect count. Hostile responses are aborted at the stream level before they consume memory. The 1 MB default is sized against observed CVC content: the sample document is around 4 KB, realistic schemes with a handful of profiles and dozens of criteria are 50 to 200 KB, and pathological-but-legitimate schemes with verbose multi-paragraph descriptions brush 500 KB. 1 MB has substantial headroom while still bounding hostile-payload memory; deployments with outlier schemes can raise the cap via env var.
- **JSON-LD expansion in safe mode.** `jsonld.toRDF(doc, { safe: true })` is used everywhere expansion is needed. There is no allowlist of context URLs; the chain of legitimate `@context` URLs across extensions is open-ended and any allowlist would either be too narrow (breaking legitimate extensions) or too broad (offering no real protection). The JSON-LD document loader instead applies the same `validatePublicUrl` guard so `@context` fetches cannot reach private addresses.
- **No auto-follow of in-document URLs.** Fields inside a scheme document (`documentation`, `conformityTopic`, criterion `passThreshold` references, etc.) are stored as opaque strings. The ingestion function does not dereference them.
- **No stored XSS.** Scheme `name`, `description`, and free-text fields are rendered through React's default escaping in any consumer. `dangerouslySetInnerHTML` is not used on CVC content; documented as a UI-side rule for the RI and any downstream UI.
- **Per-tenant scheme cap.** Tenants are limited to a configurable cap (default 50) on imported schemes. Operator-seed and UNTP-discovered schemes do not count against the cap.
- **API-wide rate limiting.** The CVC import endpoint sits behind the same rate-limit middleware that protects every `/api/v1/*` route; no CVC-specific rate logic. The middleware itself is tracked separately (see §8).

### 8. Related future concerns

Items raised during this design that are out of scope for the ADR but warrant their own tracking:

- **API-wide rate limiting middleware.** A request-rate cap on every `/api/v1/*` route. Library choice and storage (in-memory vs Redis) is its own architectural decision; will need its own ADR.
- **Batch credential issuance.** Real users will want to issue many credentials in one request (for example, an entire product batch). That is an asynchronous workload (jobs, statuses, queues, retries, idempotency keys) and not a request-response endpoint. Out of scope for the v0.7 milestone; will need its own ADR when picked up.
- **Manual operator-triggered CVC refresh endpoint.** Deferred until role-based access control lands. Tracked separately so it does not fall off.
- **Supersession of tenant-imported schemes by UNTP-discovered ones.** When a refresh discovers a URI that one or more tenants have already imported privately, automate the retirement of the tenant copies (mark superseded, route lookups to the UNTP row, surface the change in the tenant's scheme list). Simple v1 behaviour is to log the overlap and leave both rows alone; this follow-up tightens the model once the volume of overlap is observable in production.
- **Signature on the registry document.** Operator currently owns trust of `CVC_REGISTRY_URL`. A signed registry document would let us verify integrity end-to-end; future hardening.

## Consequences

### Easier

- Browse and validation are local-only reads; they do not depend on the UNTP registry or any scheme owner's site being available at request time.
- Tenant prototyping and UNTP discovery share one ingestion function; new sources of conformity schemes (different registries, file-based imports, signed bundles) plug in without touching the validation or browse paths.
- One pure validation function backs the RI, the test suite, and the playground; warning codes will not drift between the three.
- The deployment topology does not change; no new containers, no cron service, no message broker. An `instrumentation.ts` interval and a tenant-scoped API route are the only new runtime surfaces.
- Adding support for a future CVC spec version is a new parser class plus a registry entry; the ingestion, persistence, and validation paths do not change.
- Operators can bootstrap a fresh deployment with only the seed directory; the registry URL is optional.

### Harder

- Caches will drift by up to one refresh interval (default 24h) from what a scheme owner publishes. Drift is visible to operators through the `stale` flag on the scheme endpoints and through observability signals; it is intentionally not surfaced to issuers at DCC validation time.
- A scheme owner who silently changes the content of an already-published versioned URI (which the spec discourages, but is not enforceable) will cause cached data to disagree with reality until the next refresh.
- Tenants whose prior imports were under the old shape must re-import via the new API after upgrade; there is no automated migration.
- `validateConformityClaim` requires the caller to pass the parsed scheme. Callers without local cache (the test suite, for instance, when run against a one-off credential) must fetch and parse the scheme themselves. Resolver helpers in `@uncefact/untp-utils/resolvers` cover this case but the caller carries that responsibility.
- Without RBAC, the periodic-only refresh has no manual override. If the 24h cadence proves too coarse, a follow-up will add a manual trigger; until then a deployment restart is the only way to force an early refresh.
- The timer ticks independently on every replica. Today the RI runs single-replica, so this is harmless; the day we scale horizontally, we will need leader election or to move the task out of the app process. Captured as a known limitation rather than fixed now.

## Alternatives Considered

### Discovery model

- **Live query at request time.** Rejected. Every browse and every DCC issuance would fan out to the UNTP registry and one or more scheme owner sites. The RI's availability and request latency would become hostage to external services; offline operation would be impossible; rate limits on scheme owner sites would be hit at scale.
- **Hybrid (cached, with live fallback on cache miss).** Considered. Adds operational complexity for a benefit (catching schemes published in the last 24 hours) that the advisory severity model already accommodates via the staleness warning. Reconsider if real cache-miss pain emerges in practice.

### Refresh trigger

- **In-process timer plus manual HTTP refresh endpoint gated by a shared-secret token.** Rejected on its merits. A shared-secret token introduces a parallel auth surface that lives only on this one endpoint, with no rotation, scoping, or audit story in the rest of the application; gating an operator capability that way is worse than not having it at all. The capability itself (operator-triggered refresh ahead of the periodic interval) is wanted and is deferred to a follow-up that adds the endpoint behind proper role-based access control.
- **External cron container / Kubernetes CronJob.** Rejected. Adds a deployment-topology change for a single, lightweight, idempotent task already runnable in-process. Operators who deploy outside Kubernetes (Docker Compose, single-binary, etc.) would need parallel implementations.
- **Separate worker process inside the RI image.** Rejected. The work is small, infrequent, and idempotent; a separate process buys process isolation we do not need at the cost of complicating local development, observability, and the application architecture itself (one more deployable unit, one more startup-ordering concern, one more surface for errors to hide behind).

### Validation severity

- **Blocking on any mismatch.** Rejected. Some mismatches (a partial-coverage DCC where the credential attests to three of a profile's five criteria) are a valid use case under the spec, not an error. Blocking would harm legitimate flows.
- **Per-condition severity (block some, warn others).** Rejected as too cautious for the milestone. The advisory model is consistent with how the existing validation service has shipped to date; tightening to per-condition blocking can come later once issuers have feedback on which warnings most often catch real bugs.

### Tenant-imported scheme semantics

- **Visible to all tenants once imported.** Rejected. A tenant importing a prototype scheme should not affect another tenant's view of the catalogue. Cross-tenant leakage of partially-formed schemes would also make validation results inconsistent across tenants.
- **Tenant-private with an explicit in-app promotion endpoint.** Rejected. Promotion is not an RI concern; it is a UNTP registration concern. The canonical path for making a tenant-prototyped scheme globally available is for the tenant to register it with UNTP for inclusion in the Conformity Vocabulary Catalogue, at which point the RI discovers and resolves it through the standard refresh path. Building a parallel in-app promotion endpoint would either duplicate that workflow or create a competing source of truth.

### Validation logic location

- **In the RI only.** Rejected. The same logic is needed in the UNTP test suite (as a stage) and the playground (server-side validation route). Three implementations would drift.
- **In `@uncefact/untp-test-suite` only, with the RI depending on it.** Rejected. The RI's request path should not depend on the test suite. The test suite already plans to take a dependency on `@uncefact/untp-utils` for parsing primitives; placing the validation function in utils too keeps the dependency direction clean (utils never depends on the test suite or the RI).
- **In `@uncefact/untp-utils/cvc`** (as the test suite design doc currently lists). Rejected on naming grounds. `CVC` already expands to "Conformity Vocabulary Catalogue"; a sub-entry called `/cvc` followed by a function called `parseCvcCatalogue` reads as "parse catalogue catalogue". `/conformity-vocabulary` is the broader and more accurate name; the catalogue is one artefact within that vocabulary, alongside schemes, profiles, criteria, and topics.

### Data migration

- **In-place reshape of existing tenant-imported rows.** Rejected. The old ingestion shape produced data whose tree does not match the v0.7 spec (catalogue inlined every scheme directly, rather than schemes being independently published). Reshaping the rows would carry forward semantically incorrect data; re-importing under the new pipeline is the only correct path.
- **Hybrid (drop the catalogue wrapper, keep scheme/profile/criterion rows with a new `source` column).** Rejected for the same reason: the underlying scheme rows were ingested from a non-spec shape and re-import is required regardless.

### Naming

- **Keep the `cvc` shorthand throughout (table prefix, function names, sub-entry names).** Rejected. The shorthand only applies to the catalogue itself; using it as a blanket prefix for schemes, profiles, and criteria conflates the registry with its contents.

### JSON-LD context handling

- **Allowlist of known context URLs (block fetches outside it).** Rejected. UNTP supports extensions, and extensions of extensions; the chain of legitimate `@context` URLs is open-ended and cannot be enumerated without breaking every legitimate use case the moment a new extension lands. `jsonld.toRDF` in `safe: true` mode, combined with a public-IP-only document loader (so `@context` fetches go through `validatePublicUrl` and cannot reach private addresses), covers the real threat without constraining what contexts are reachable.

## References

- UNTP Conformity Vocabulary Catalogue specification: <https://untp.unece.org/docs/specification/ConformityVocabularyCatalog>
- Issue #533 (this ADR)
- Initiative: #539
- Implementation parent: #541
- Stories: #542, #543, #544, #545, #546
- Parser verification: #517
- DCC end-to-end issuance: #540
- Conformance test suite design: `docs/superpowers/specs/2026-05-17-untp-conformance-test-suite-design.md`
- Closed-but-retained context: #534 (decomposed into the Stories above)

## Appendix: configuration and concrete bindings

The concrete defaults, names, and bindings the design uses. They live here, separately from the body, so that changes to a default or a path do not require a new ADR. Anything in this appendix is implementation-level; anything in the body above is a design-level commitment.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `CVC_REGISTRY_URL` | (empty) | Operator-set UNTP catalogue URL. Empty value disables UNTP discovery (seed-only mode). |
| `CVC_REFRESH_INTERVAL_HOURS` | `24` | Periodic refresh cadence (UNTP-discovered schemes only). |
| `CVC_STALENESS_THRESHOLD_DAYS` | `7` | Schemes whose last successful refetch is older than this surface as `stale` on operator endpoints. |
| `CVC_MAX_SCHEME_BYTES` | `1048576` (1 MB) | Response-size cap on each scheme fetch. |
| `CVC_MAX_SCHEMES_PER_TENANT` | `50` | Per-tenant cap on imported schemes. Operator-seed and UNTP-discovered schemes do not count. |

### Fetch hardening

- Connect timeout: 5 seconds
- Read timeout: 15 seconds
- Max redirects: 5

### HTTP surface

| Verb | Path | Behaviour |
| --- | --- | --- |
| `GET` | `/api/v1/cvc/schemes` | List schemes visible to the calling tenant + system tenant. Each row includes `lastFetchedAt`, `lastFetchStatus`, derived `stale`. |
| `GET` | `/api/v1/cvc/schemes/:id` | Single scheme with its profiles and criteria. |
| `GET` | `/api/v1/cvc/profiles/:id` | Single profile with its criteria. |
| `GET` | `/api/v1/cvc/criteria/:id` | Single criterion. |
| `POST` | `/api/v1/cvc/schemes` | Tenant import. Body `{ url, cvcSpecVersion? }`. Returns `409 Conflict` when the URI is already present in the system-tenant lane. |

### Filesystem and runtime bindings

- Operator seed directory: `prisma/seed-data/`
- Next.js startup hook: `instrumentation.ts`

### `lastFetchStatus` values

`'success' | 'fetch-failed' | 'jsonld-expansion-failed' | 'schema-invalid' | 'parse-failed' | 'too-large' | 'invalid'`

### Utility primitives the RI composes

| Sub-entry | Symbol | Purpose |
| --- | --- | --- |
| `@uncefact/untp-utils` | `MultibaseDigest.fromData` | Body digest for the skip chain. |
| `@uncefact/untp-utils` | `detectVersionFromContext` | Detects CVC spec version from a document's `@context`. |
| `@uncefact/untp-utils/node` | `validatePublicUrl` | SSRF guard. Re-resolves at connect time, blocks private and metadata addresses. |
| `@uncefact/untp-utils/validation` | `validateJsonLd` | JSON-LD expansion in `safe: true` mode. |
| `@uncefact/untp-utils/validation` | `validateAgainstSchemas` | Ajv-based JSON Schema validation. |
| `@uncefact/untp-utils/schema-loaders` | `fetchSchema` (cached) | Fetches and caches JSON Schemas (the UNECE-published `ConformityScheme.json`, etc.). |
| `@uncefact/untp-utils/resolvers` | `resolveDocumentIfChanged` | Composed fetch + ETag/Last-Modified + body-digest skip chain. |
| `@uncefact/untp-utils/conformity-vocabulary` | `parseConformityCatalogue`, `parseConformityScheme`, `validateConformityClaim` | Conformity vocabulary parsing and validation. This ADR's contribution to utils. |
