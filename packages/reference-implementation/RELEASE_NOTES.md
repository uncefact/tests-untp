# UNTP Reference Implementation release notes

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
