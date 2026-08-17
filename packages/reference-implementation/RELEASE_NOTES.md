# UNTP Reference Implementation release notes

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
