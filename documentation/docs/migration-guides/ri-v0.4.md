---
sidebar_position: 1
title: Reference Implementation v0.4
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

:::warning[Before you upgrade]
Back up the Reference Implementation database, and record the encryption key the
deployment currently runs with (`SERVICE_ENCRYPTION_KEY` in earlier versions).

Losing that key already meant losing every service instance configuration. From this
release it also means **losing every credential decryption key stored as an encrypted
envelope**.

The credentials themselves are not in this database. They sit in the storage service, and
their ciphertext survives a lost key untouched. What is lost is the Reference
Implementation's ability to hand out the key that opens them. Verification still works for
anyone who supplies a credential's key themselves, so a recipient who was given one out of
band is unaffected. But the deployment can no longer produce that key, and where no copy was
kept anywhere else, the credential's contents become unrecoverable in practice. From v0.4 a
key that cannot read the stored data also stops the application booting, so a lost key is an
outage as well as a loss of access.

Private credentials created before this release still hold their decryption key in
plaintext. Run the [backfill below](#backfill-the-decryption-keys-of-existing-credentials)
after upgrading to bring them under encryption.

Store the key with the same care as the database backups. Once a backup holds any
encrypted envelope, it cannot be recovered without its matching key. The full pairing,
retention, and recovery contract lives in
[Key Management and Recovery](../reference-implementation/operations/key-management).
:::

## Overview

v0.4 changes application behaviour in several ways that affect an upgrade. The five most
consequential are these. Database migrations, seeded conformity schemes, remote document
fetching, and two credential data model corrections have their own sections below.

- It encrypts the per-credential decryption key for private credentials before it is
  persisted, closing the gap where anyone with read access to the database could recover
  those keys. The environment variable holding the encryption key is renamed from
  `SERVICE_ENCRYPTION_KEY` to `DATA_ENCRYPTION_KEY`, and a one-off operator-run backfill
  encrypts the keys of private credentials created by earlier versions.
- It validates `RI_APP_URL`, the encryption key, and the variables each seeded service
  category needs, and refuses to boot when any of them is missing or wrong. Some
  deployments that started on v0.3 will not start on v0.4 until their configuration is
  corrected.
- It validates API requests at the route boundary. Requests that v0.3 accepted, coerced, or
  silently ignored are now rejected with a 400, and page limits above the maximum are
  rejected rather than quietly reduced.
- It makes the custom seed manifest the source of truth for the rows it owns. Changing an
  entry already updated its row in v0.3. What is new is that removing an entry now deletes
  the row.
- It reworks credential publishing. The target now resolves from the credential's own
  identifier rather than from the master data record it references, a requested publish that
  cannot proceed no longer throws away the credential it just created, `PUBLISH_SKIPPED` is
  replaced by codes naming the specific unmet prerequisite, and the identity resolver
  instance is chosen from the scheme, then the registrar, then the default. Callers branching
  on `PUBLISH_SKIPPED` stop matching anything, and callers whose identifier value exists
  under two schemes must now name the scheme.

Work through [Before you upgrade](#before-you-upgrade) first. Several of the changes below
cause a failed boot or a data deletion on the first run if the deployment is not checked
beforehand.

## Before you upgrade

1. **Back up the database and record the key it pairs with.** See
   [Key Management and Recovery](../reference-implementation/operations/key-management#backups-pair-with-the-key).
2. **Plan for a clean cutover, not a rolling one.** A v0.4 instance encrypts the decryption
   key of every credential it stores, and a v0.3 instance has no unwrap step, so a v0.3
   replica reading a credential that v0.4 stored hands the caller the raw envelope JSON in
   place of the key. Stop the v0.3 instances before v0.4 starts serving, or freeze credential
   issuance for as long as both versions are live.
3. **Confirm the configured encryption key can read the data already stored.** From v0.4 a
   key that cannot decrypt existing data stops the application at startup rather than
   failing on the first request that needs it, so check before you deploy. The audit ships
   with v0.4, so run it from the v0.4 checkout or image while your v0.3 deployment is still
   the one serving.

   Take care which invocation you use. `docker compose exec` targets the running v0.3
   container, where the script does not exist. `docker compose run` uses the v0.4 image, but
   it goes through the entrypoint, so set both skip flags or it will migrate, backfill, and
   seed your live v0.3 database as a side effect of the check:

   ```bash
   docker compose run --rm -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
     ri npx tsx scripts/audit-encryption.ts
   ```

   Do not recreate or exec into the serving container to do this. See
   [Running the audit](../reference-implementation/operations/encryption-audit#running-the-audit)
   and
   [Reading the report](../reference-implementation/operations/encryption-audit#reading-the-report).

   The audit is the exhaustive check. The startup validation described later decrypts a
   single stored envelope, which catches a uniformly wrong key but will not find one bad row
   among many.
4. **If your deployment sets both `RI_DATABASE_URL` and the `RI_POSTGRES_*` parts, make them
   agree.** v0.3 rebuilt the URL from the five parts and overwrote anything already in
   `RI_DATABASE_URL`. v0.4 honours `RI_DATABASE_URL` as set. A deployment carrying a stale or
   host-side value in that variable will connect somewhere new on first boot, and the three
   migrations and the seed will be applied there. See
   [Database](../reference-implementation/operations/database).
5. **Review `seed.yaml` against the database.** From this release, an entry removed from
   the manifest deletes its row. Anything you rely on that the manifest no longer lists
   must be added back to the manifest before the first post-upgrade boot. Pay particular
   attention to `conformitySchemes`, where a removal cascades to profiles and criteria and
   has no safeguard to stop it. See
   [The custom seed manifest is now the source of truth](#the-custom-seed-manifest-is-now-the-source-of-truth).
6. **Check that every service category you ask the seed to configure has its environment
   variables set.** A category with missing variables now fails the whole boot instead of
   being skipped with a warning. See
   [Startup now fails on invalid configuration](#startup-now-fails-on-invalid-configuration).
7. **Check `RI_APP_URL` is set to the deployment's public base URL**, as a valid `http(s)`
   URL with no username or password. The application will not start without it.
8. **Check where your JSON-LD contexts and JSON Schemas are hosted.** Any that resolve to a
   private, loopback, or link-local address will stop being fetched. Move them to a publicly
   resolvable address before upgrading. See
   [Remote documents are fetched through a guarded resolver](#remote-documents-are-fetched-through-a-guarded-resolver).
9. **Check your API clients** for the four behaviours most likely to break silently:
   requests asking for a page larger than 100 records, code that reads the credentials list
   without a `limit` and expects every record back, code that branches on the
   `PUBLISH_SKIPPED` warning code, and code that matches on the text of 404 messages.
   Each is covered under [API behaviour changes](#api-behaviour-changes).

## Environment variables

### `SERVICE_ENCRYPTION_KEY` is renamed to `DATA_ENCRYPTION_KEY`

The name changed to reflect its broadened role. It now protects service instance
configurations and credential decryption keys.

- Keeping only `SERVICE_ENCRYPTION_KEY` set continues to work and logs a deprecation
  warning. Rename the variable at your convenience. Removal of the fallback is tracked
  in [#721](https://github.com/uncefact/tests-untp/issues/721).
- Setting both names to the same value works and logs a reminder to remove the old name.
- Setting both names to **different values fails before anything encrypted is
  written** (on the standard Docker path this surfaces at startup, when the seed
  resolves the key). The two names are aliases for the same active key, so two
  different values have no valid meaning, and proceeding would split the encrypted
  data across keys. Moving data to a new key is a separate maintenance task, covered in
  [Encryption Key Rotation](../reference-implementation/operations/encryption-key-rotation). In
  particular, do not copy the placeholder `DATA_ENCRYPTION_KEY` from `.env.example`
  into an existing deployment that still has its real `SERVICE_ENCRYPTION_KEY`. Rename
  your existing variable instead, keeping its value.

### New variables

All of these are optional and have working defaults. They do not all report a bad value the
same way.

`CVC_REFRESH_INTERVAL_HOURS`, `RI_HTTP_USER_AGENT`, `CACHE_MAX_ENTRIES`, and
`LOG_REDACT_PATHS` are validated at startup, and an invalid value stops the boot with a
message naming the variable. `API_MAX_PAGE_LIMIT`, `CONTEXT_CACHE_TTL_MS`, and
`SCHEMA_CACHE_TTL_MS` fall back to their default and log a warning instead, so check the
startup log if one of them does not appear to be taking effect. `SEED_ALLOW_PARTIAL` is
matched against the exact string `true` and anything else counts as unset, silently, so a
typo such as `True` leaves the seed failing on missing configuration with nothing pointing
at the typo. `OUTGOING_DATA_ENCRYPTION_KEY` is validated only when the
`rotate:encryption-key` command runs, not at startup.

| Variable | Default | What it controls |
|---|---|---|
| `API_MAX_PAGE_LIMIT` | `100` | The largest page a list endpoint will return. A request above it is rejected with a 400. |
| `SEED_ALLOW_PARTIAL` | unset | When `true`, restores the v0.3 behaviour of skipping a service category whose environment variables are missing instead of failing the boot. |
| `CVC_REFRESH_INTERVAL_HOURS` | `24` | How often URL-seeded conformity schemes are re-fetched from their source. Maximum 500. |
| `RI_HTTP_USER_AGENT` | built-in | The `User-Agent` sent on outbound fetches of remote JSON-LD contexts and JSON Schemas. |
| `CONTEXT_CACHE_TTL_MS` | `3600000` | How long a fetched JSON-LD context is reused. `0` disables caching. |
| `SCHEMA_CACHE_TTL_MS` | `3600000` | How long a fetched JSON Schema is reused. `0` disables caching. |
| `CACHE_MAX_ENTRIES` | `1000` | How many entries each document cache retains. |
| `LOG_REDACT_PATHS` | unset | Extra comma-separated log redaction paths, merged with the built-in defaults. |
| `OUTGOING_DATA_ENCRYPTION_KEY` | unset | The previous key, set only while running the `rotate:encryption-key` maintenance command. Remove it once the rotation is verified. |

## Startup now fails on invalid configuration

On v0.3 a deployment could start with configuration missing and only discover the problem on
whichever request first needed it. v0.4 checks these before serving anything, so a
configuration mistake surfaces as a failed boot with a message naming the variable rather
than as an intermittent runtime error.

The application refuses to start when:

- **`RI_APP_URL` is unset, is not a valid `http(s)` URL, or carries a username or
  password.** On v0.3 this variable was read only to build the identity provider's
  end-session redirect on logout, and an unset value meant that redirect was silently
  skipped. It is now required at boot, and it also supplies the default human verification
  link attached to a published credential that does not carry its own. The shipped
  `.env.example` and Docker Compose files already default it for local development.
- **The configured encryption key cannot decrypt one existing stored envelope.** The check
  decrypts a single envelope, so it catches a uniformly wrong or prematurely rotated key at
  startup instead of on the first request that touches encrypted data. It does not prove
  every stored envelope is readable. Run the
  [encryption audit](../reference-implementation/operations/encryption-audit) before
  upgrading for the exhaustive check.
- **The placeholder key from `.env.example` is configured** and `DEPLOYMENT_ENVIRONMENT`
  is anything other than `local`.
- **A service category the seed was asked to configure is missing its environment
  variables.** On v0.3 the seed warned and skipped that category, and the container still
  started. It now fails the seed, and because the container entrypoint runs the seed before
  the application, the container does not come up. Set `SEED_ALLOW_PARTIAL=true` to seed
  what is configured and skip the rest with a warning, which is the v0.3 behaviour.
- **`CVC_REFRESH_INTERVAL_HOURS`, `RI_HTTP_USER_AGENT`, `CACHE_MAX_ENTRIES`, or
  `LOG_REDACT_PATHS` holds an invalid value.** The other new variables are more forgiving,
  as described above.

See [Startup](../reference-implementation/operations/startup).

## Database migrations

Three migrations ship in this release. On the standard Docker path they are applied
automatically at boot, before the application starts, so the upgrade applies them for you.

| Migration | What it does |
|---|---|
| `20260610000000_tenant_scope_identifier_uniqueness` | Replaces the unique index on `Identifier(schemeId, value)` with one on `Identifier(schemeId, value, tenantId)`. |
| `20260812000000_record_source_provenance` | Adds a `source` column (`CORE_SEED`, `CUSTOM_SEED`, `USER`) to `Registrar`, `IdentifierScheme`, `SchemeQualifier`, `DataModel`, and `RenderTemplate`. |
| `20260813000000_seed_entry_kind` | Adds a nullable `seedEntryKind` column (`URL`, `FILE`) to `ConformityScheme`. |

**Identifier uniqueness is now scoped to the tenant.** Before this migration an identifier
value was unique per scheme across the whole instance, so once any tenant registered a
value against a shared system-seeded scheme, another tenant registering the same value
failed on a database constraint it could not see or resolve. Two tenants can now register
the same identifier against a shared scheme. If you were relying on that global uniqueness
as a cross-tenant duplicate check, it no longer holds.

**Existing rows of those five kinds are safe by default.** Every row that predates the
provenance migration is marked `USER`, which the custom seed reconcile never deletes. They
come under manifest management only when the seed next upserts them.

Conformity schemes are not covered by that marker. They carry their own separate provenance
(`UNTP`, `SYSTEM_SEED`, `TENANT_IMPORTED`), which predates this release, so a scheme seeded
before the upgrade is eligible for eviction from the first v0.4 boot. See
[Seeded conformity schemes now refresh](#seeded-conformity-schemes-now-refresh).

## Seed behaviour changes

### The custom seed manifest is now the source of truth

On v0.3 the custom seed only ever inserted or updated. Removing an entry from `seed.yaml`
left the row in place, so the database drifted from the file that was supposed to describe
it. From this release, whenever a manifest section key is present, reconciliation deletes
every manifest-owned row of that type that the manifest no longer lists. An explicitly
empty section, such as `registrars: []`, deletes every manifest-owned row of that type.

Two safeguards limit what this can reach:

- Only rows the custom seed itself established are eligible. Rows created through the UI or
  the API, and every row that existed before the provenance migration, are marked `USER`
  and are never deleted by reconciliation.
- A deletion that would cascade into data the manifest does not own, such as identifiers
  registered against a scheme being removed, stops that pass with an explanatory error and
  rolls back its writes.

That rollback is not quite all-or-nothing, so read the error the seed prints rather than
assuming nothing happened. Render template files are uploaded to the storage service before
the transaction runs, so a rolled-back run can leave an uploaded template object in storage
with no database row. Those are harmless and can be cleaned up by hand. Conformity scheme
reconciliation runs after the main transaction has already committed, so a failure there
leaves the registrars, data models, and render templates from the main pass in place.

Conformity schemes reconcile the same way, and with one fewer safeguard. A
`conformitySchemes` entry removed from the manifest deletes that scheme's row on the next
boot, cascading to its profiles and to any criteria no other profile still references, and
there is no cascade block to stop it. A `file` entry that cannot be read is skipped for that
boot with an error logged, leaving the previous row in place, so a transient read failure
never deletes anything.

Review `seed.yaml` against the database before your first post-upgrade boot, and add back
anything you rely on that the manifest no longer lists. After that boot, check the seed log
for adoption warnings: a manifest entry whose id matches a row you created by hand brings
that row under manifest management, which makes it deletable by a later reconcile.

See [Custom seed](../reference-implementation/operations/custom-seed).

### Seeded conformity schemes now refresh

On v0.3 a seeded conformity scheme was ingested once and then frozen, because a row matching
an existing source was skipped on every later run. Schemes seeded from a URL are now
re-fetched from their source on a cadence set by `CVC_REFRESH_INTERVAL_HOURS`, and
file-seeded schemes refresh at boot. If you edited a seeded scheme directly in the database
expecting it to stay as you left it, that edit is now overwritten from the source.

## API behaviour changes

### Page limits are rejected, not clamped

On v0.3 a `limit` above the maximum was silently reduced to the maximum, so a client asking
for 500 records received 100 with nothing in the response to say why. Every list endpoint
now returns a 400 naming the bound.

```
GET /api/v1/products?limit=500

400 { "error": "limit: must not exceed the maximum of 100" }
```

Either lower the requested limit and page through the results, or raise the ceiling for the
whole deployment with `API_MAX_PAGE_LIMIT`. See
[API pagination](../reference-implementation/operations/api-pagination).

### The credentials list is now bounded when `limit` is omitted

`GET /api/v1/credentials` without a `limit` ran its query unbounded and returned every
matching credential in the tenant, while the response's `pagination.limit` field still
reported the default. It is now bounded to the default page size, 20 records, like every other list endpoint. The call still succeeds, so nothing signals the change except the smaller result
set. If you relied on a single call returning everything, page through the results with
`limit` and `offset` instead.

### Request validation moved to the route boundary

Validation now happens before anything is written, signed, or published, across
credentials, DIDs, products, organisations, facilities, registrars, identifiers and their
links, identifier schemes, data models, services, render templates, and the conformity
vocabulary browse endpoints (`/api/v1/cvc/schemes`, `/cvc/profiles`, `/cvc/criteria`). A
rejected request returns a 400 naming the field and the rule it broke.

Requests that v0.3 accepted and v0.4 rejects include:

- Whitespace-only names and descriptions where a value is required, such as `" "`, which
  v0.3 stored as sent. Empty strings and `null` were already rejected on those fields.
- URLs that are not well-formed absolute `http(s)` addresses, and URLs carrying a username
  or password, on registrars, data models, identifier links, services, and the verification
  URLs supplied when publishing a credential.
- Malformed BCP 47 language tags in `hreflang`, such as `en_US` with an underscore, where
  any non-empty string was previously accepted.
- Duplicate entries in identifier lists such as `secondaryIdentifierIds`.
- An `accessRole` outside the six UNTP access roles on identifier link registration and
  update, where any string was previously accepted. The accepted values are
  `untp:accessRole#Anonymous`, `#Customer`, `#Regulator`, `#Recycler`, `#Auditor`, and
  `#Owner`.
- A string where a boolean belongs. `storageOptions.encrypt` is now type-checked, which
  closes a bug where the string `"false"` was treated as a request to encrypt.
- Query parameters that are not exactly the value they claim to be. `?force=TRUE` on
  `DELETE /api/v1/services/{id}` previously matched nothing and silently behaved as
  `false`, and it is now a 400. Malformed integers such as `limit=1abc`, previously parsed as
  `1`, are rejected, as are repeated query keys.

Values are validated but not canonicalised on registrars, data models, and service
configuration, so what you send there is what is stored. Two fields are the exception. The
verification URLs supplied when publishing a credential, and the `href` on an identifier
link registration, are stored in their canonical form rather than as you sent them, which
closes a gap where two URL parsers could disagree about where a string points. A bare origin
such as `https://gs1.org` comes back as `https://gs1.org/`.

### Error responses

- **Database conflicts return the right status.** A unique-constraint or foreign-key
  violation that escaped as a 500 carrying raw database text now returns a 409, a 400, or a
  404 with a message written for the caller. If your error handling matched on a generic
  500 or scraped ORM text out of the body, switch to matching the status code.
- **Authentication and tenant-resolution failures return the documented envelope.** These
  previously fell through to a plain-text 500. They now return the same
  `{ "error": ... }` shape as every other route, with a correlation id.
- **Error message wording changed on many routes.** Several 404 messages dropped their
  `or access denied` tail, one data model message became
  `Parent data model configuration not found`, and the identifier scheme routes now say
  `Identifier scheme not found` rather than `Scheme not found`. On the authentication path,
  `Unauthorized` became `Unauthorised` and `Session expired - please sign in again` became
  `Session expired. Please sign in again`, which reaches every authenticated route. Status
  codes are unchanged throughout, so code that matches on message text breaks silently.
  Match on the status code instead.
- **Deleting a service instance is stricter, and its conflict counts are now yours alone.**
  A system default service instance is readable by every tenant, and on v0.3 a tenant could
  delete one, which removed it for everybody. `DELETE /api/v1/services/{id}` now refuses with
  a 403 before it checks anything else. Separately, the reference counts in the 409 body were
  counted across all tenants, so the message told a caller how many of other tenants' DIDs,
  registrars, and identifier schemes pointed at the instance. Those counts are now scoped to
  the caller's own records, so expect smaller numbers than v0.3 reported for a shared
  instance.
- **`x-correlation-id` is validated on the way in.** A supplied value is accepted only if
  it is at most 128 characters of `A-Z`, `a-z`, `0-9`, `_`, or `-`. A value failing that
  rule is replaced with a generated id. If your tracing depends on the id you send being
  echoed back, check it against that rule. Separately, when no `x-correlation-id` is
  supplied, the correlation id falls back to the `Root` token parsed out of an inbound
  `X-Amzn-Trace-Id` header, where v0.3 used that header's whole raw value including its
  `Root=...;Parent=...` structure.

### Credential publishing

This is the largest behaviour change in the release for anyone calling
`POST /api/v1/credentials` with `publishingOptions.publish: true`. The reasoning is
recorded in ADR 044, "A requested publish fails loudly and resolves from the identifier".

**A requested publish no longer destroys the response.** On v0.3, two failures during
publishing threw after the credential had already been signed, stored, and written to the
database, so the caller got an error and never learned the id of a credential that now
existed. An unresolvable identity resolver service instance was one, deliberately treated
as fatal. A matched master data entity vanishing between lookup and insert was the other,
failing the credential's foreign key write. Both are now warnings on a 201 response, so
issuance always returns the credential it created. If your client treats a non-2xx from
this route as proof that no credential was created, that assumption was already unsafe on
v0.3 and this release removes the cases that made it wrong.

**Publishing resolves from the identifier, not from a matched entity.** Everything a
publish needs hangs off the identifier record, so gating it on master data matching made an
enrichment concern decide whether a credential was discoverable. A credential whose
identifier exists without any master data record, or whose match is a secondary identifier,
now publishes where it previously could not. Entity linking continues as best-effort
enrichment and never blocks a publish. `ENTITY_LINK_FAILED` covers only the narrow case
where a matched entity vanished before the credential row was written.

**Ambiguous identifiers must now be disambiguated by the caller.** An identifier value is
unique only within a scheme, so a value registered under two schemes has no single publish
target. v0.3 let the entity match pick one silently. v0.4 returns
`PUBLISH_IDENTIFIER_AMBIGUOUS` naming the colliding schemes, and the caller chooses with a
new `publishingOptions.identifierSchemeId` option.

**The identity resolver instance is chosen differently.** It now resolves scheme first,
then registrar, then the tenant or system default, matching what
`POST /identifiers/{id}/links` already did. v0.3's credentials route consulted only the
scheme-level override. If your registrar carries an identity resolver instance and your
scheme does not, credentials that previously went to the system default now publish to the
registrar's resolver instead.

**`PUBLISH_SKIPPED` no longer exists.** On v0.3 it was the single code reported whenever a
publish could not proceed, covering several unrelated causes, and one of its three messages
was unreachable. It is replaced by codes that name the specific unmet prerequisite, each
now carrying the `remediation` field that the warning schema already defined but nothing
populated on v0.3:

| New code | Meaning |
|---|---|
| `PUBLISH_REFERENCE_MISSING` | The credential carries no identifier to publish against. |
| `PUBLISH_IDENTIFIER_UNKNOWN` | The credential's identifier is not registered. |
| `PUBLISH_IDENTIFIER_AMBIGUOUS` | The identifier value is registered under more than one scheme for this tenant. |
| `PUBLISH_TARGET_UNRESOLVED` | The identifier lookup itself failed, so whether a target exists could not be determined. |
| `PUBLISH_SCHEME_INCOMPLETE` | The resolved scheme is missing the configuration publishing needs. |
| `PUBLISH_IDR_UNAVAILABLE` | No identity resolver service instance was available. |
| `PUBLISH_LINKS_UNBUILDABLE` | The links to publish could not be constructed. |
| `IDR_PUBLISH_UNCONFIRMED` | The resolver could not be reached or did not answer, so the publish may or may not have committed. |
| `ENTITY_LINK_FAILED` | Advisory only. A matched master data entity vanished before the credential row was written. |

Code that branches on `PUBLISH_SKIPPED` to detect an unfinished publish will stop matching
anything and silently treat every publish failure as a success.

`IDR_PUBLISH_FAILED` also narrowed. On v0.3 it covered every failure of the publish call,
including a rejection, a timeout, and a network error. It now fires only when the resolver
returns a 4xx explicitly rejecting the links. The cases where the resolver could not be
reached or did not answer are reported as the new `IDR_PUBLISH_UNCONFIRMED`, because those
may have committed upstream and must not be retried blindly. `REFS_EXTRACTION_FAILED` and
`DB_STATUS_UPDATE_FAILED` are unchanged.

Three defaults also changed for callers who omit them.

- Publishing without `publishingOptions.humanVerificationUrl` now stamps the published link
  with this deployment's own verify page, derived from `RI_APP_URL`, where v0.3 omitted the
  human verification link entirely.
- Publishing without `publishingOptions.linkType` now uses the resolved identity resolver
  instance's configured `defaultLinkType`. On v0.3 the fallback was the hardcoded
  `gs1:sustainabilityInfo`, which is not one of the values a service instance's
  `defaultLinkType` can hold, so this changes the published link type for every caller who
  omits it, not only for some. Pass `publishingOptions.linkType` explicitly to keep the
  value you had.
- The published link's description gained a final fallback, for the case where there is no
  matched entity to supply one. A matched entity's description, or failing that its name,
  still wins exactly as it did on v0.3, so a credential that matches an entity publishes the
  same description as before. Only a publish with no entity behind it now falls through to
  the link title, which itself defaults to the data model's name.

One limitation this rework does not close. A registrar or identifier scheme created at
runtime through the API is saved in the Reference Implementation's own database but is never
registered with the upstream identity resolver, so publishing against it fails with
`IDR_PUBLISH_FAILED` carrying a 404 that names the namespace. Register the namespace and its
application identifiers directly against the resolver, or include them in the seed, which is
how the bundled resolver gets its namespaces. This is tracked in
[#750](https://github.com/uncefact/tests-untp/issues/750) for a later release.

One unrelated correction rode in with this work. A stored decryption key that cannot be read
no longer echoes the operator's encryption-key diagnostic and the failing row's id back to
the caller. That path now returns the same sanitised 500 as every other unhandled failure.

### Remote documents are fetched through a guarded resolver

Remote JSON-LD contexts and JSON Schemas referenced by a credential are now fetched through
a resolver that refuses private, loopback, and link-local addresses, caps the response size
and the number of redirect hops, and re-checks the address on each hop. There is no opt-out
for these fetches. If your credentials reference a context or schema hosted on a private
address, those fetches now fail. Host those documents on a publicly resolvable address
before upgrading.

The private-address checks applied elsewhere are a separate mechanism with a shared switch.
`VERIFY_ALLOW_PRIVATE_URLS=true`, which already existed in v0.3, relaxes the public-address
check on every caller-supplied URL the API accepts, across registrars, data models, service
configuration, identifier links, and the verification URLs supplied when publishing, as well
as the fetch of the stored credential document on the verify path. It exists so that local
Docker Compose setups with private-address services keep working, and it should not be set
in a deployment reachable from outside. It does not affect the context and schema fetches
above, which stay guarded either way.

Fetched documents are also cached in memory, so a corrected context or schema is picked up
on the next cache expiry rather than the next request. Tune this with
`CONTEXT_CACHE_TTL_MS`, `SCHEMA_CACHE_TTL_MS`, and `CACHE_MAX_ENTRIES`, or set a TTL of `0`
to disable caching.

## UNTP v0.7.0 data model corrections

Two bridges were corrected against the published v0.7.0 artefacts. Both change what the
Reference Implementation reads out of credentials you have already issued.

### DIA `registerType` is now lowercase

The published v0.7.0 code list uses lowercase values (`business`, `facility`, `land`,
`product`), where v0.6.x used capitalised ones. The v0.7.0 Digital Identity Anchor bridge
was writing and reading the capitalised form, which the v0.7.0 list does not contain. It now
matches the published list.

This is a fix rather than a break. A v0.7.0 DIA authored elsewhere, conforming to the
published code list, carried `business`, and v0.3 looked for `Business`, so its
organisation, facility, or product reference went unrecognised and no entity link was made.
Those credentials link correctly from v0.4.

Digital Identity Anchors this deployment issued before the upgrade keep their entity links.
A credential's links are resolved once, when it is issued, and stored on the credential row,
and nothing re-derives them on read. What those credentials do carry is the old capitalised
value in their stored payload, which does not conform to the v0.7.0 code list, so anything
downstream reading `registerType` out of them sees a value the specification does not
define. Reissuing is the only way to correct that.

### DCC conformity claims are validated with a scheme alone

On v0.3, conformity vocabulary validation ran only when the credential subject named both a
`referenceScheme` and a `referenceProfile`. A credential naming a scheme but no profile was
skipped entirely and produced no conformity warnings. v0.4 requires only the scheme, so those
credentials are now validated at the scheme level and can raise warnings they never raised
before, including `conformity-profile.not-specified`.

The treatment of a criterion's `conformityTopic` also changed. v0.3 flagged every criterion
that declared no topic. v0.4 distinguishes a topic field that is absent from one that is
present but empty, and skips the topic check for the absent case, so a different set of
payloads receives the missing-topic warning. This is a deliberate leniency held while a
divergence between the published specification and schema stands, recorded in ADR 038.

The `pointer` on a conformity warning also changed. On v0.3 it addressed an internal
projection of the extracted claim, so it did not resolve against anything the caller sent or
received. It is now remapped onto the submitted credential, and omitted entirely when it
cannot be resolved. A client reading `warning.pointer` will see different values, and
sometimes no field at all, for the same credential.

These changes apply when a credential is issued, which is the only point conformity claims
are validated. Stored credentials are not revalidated. The practical effect is that the same
payload submitted before and after the upgrade can come back with different warnings, so
re-baseline any test or monitoring assertion that matches on them.

## Other changes worth knowing

- **`RI_DATABASE_URL` is now honoured verbatim.** On v0.3 the five `RI_POSTGRES_*` parts
  silently overwrote an explicitly set `RI_DATABASE_URL` whenever all five were present. If
  your deployment set both, and the `RI_POSTGRES_*` values were the ones actually in use,
  the application now connects to whatever `RI_DATABASE_URL` names instead. Check that the
  two agree before upgrading. See [Database](../reference-implementation/operations/database).
- **Sensitive fields are redacted from logs by default**, including decryption keys, API
  keys, authorisation headers, tokens, and passwords. If you scrape logs for any of these,
  those fields are now absent. See [Logging](../reference-implementation/operations/logging).
- **The verify page now asks for a decryption key** when a verify link points at a
  privately stored credential and carries no key, where it previously showed an error. See
  the [verify page](../reference-implementation/verify-page).
- **The verify page's date row changed field, label, and format**, and every credential is
  affected. It was labelled `Issue date` and read `issuanceDate`, a VC Data Model 1.1
  property. UNTP credentials follow VC Data Model 2.0, which replaced that field with
  `validFrom` and `validUntil`, so credentials the bridges build do not carry it. When it was
  absent the date library treated the missing value as the current time, so the page showed
  today's date as the credential's issue date. The page now reads `validFrom` under a `Valid from` label,
  renders it as the credential's UTC calendar date in ISO 8601 so readers in different
  timezones see the same value, and omits the row when there is no parseable `validFrom`
  rather than inventing one. `Valid until` is not shown yet. If you screenshot, scrape, or
  assert on the verify page, both the label and the value have changed. Making the format
  operator-configurable is tracked in
  [#881](https://github.com/uncefact/tests-untp/issues/881).
- **The application navigation is hidden.** The sidebar and public header do not render, so
  the configuration pages are reachable only by typing their URL, for example
  `/configuration/dids`. The pages themselves are unchanged.
- **OpenTelemetry filesystem auto-instrumentation is off by default.** If you relied on
  filesystem spans in traces, they are no longer emitted.
- **The image now carries its own health check, and the broken one is fixed.** On v0.3 the
  probe lived only in the shipped Compose file and used `http://localhost:3003/api/health`.
  The container listens on IPv4 only, and BusyBox wget tries the IPv6 loopback first, so that
  probe never passed and the container was reported unhealthy however well it was running.
  The probe now ships in the image as a `HEALTHCHECK` against
  `http://127.0.0.1:3003/api/health`, and the Compose file no longer repeats it. Anything
  that runs the image gets a working check without configuring one, so you can drop your own
  probe from a Compose file or manifest derived from ours, or keep it as a deliberate
  override. Two caveats. The probe's
  40-second start period is not sized to your data: the entrypoint runs migrations, the
  digest backfill, and the seed before the server listens, and on a large database that can
  outlast the start period plus its three retries, at which point the container reports
  unhealthy while it is still starting correctly. Nothing kills it for that under plain
  Docker or Compose, but an orchestrator that replaces unhealthy tasks will, so widen
  `start_period` and `retries` with an override sized to your database. And Kubernetes
  ignores a Docker `HEALTHCHECK` entirely: use a `startupProbe` against `/api/health` sized
  the same way, then a cheap liveness probe. `/api/health` returns 200 unconditionally
  without checking the database or any dependency, so it tells you the HTTP server is
  accepting connections and nothing more. That is a meaningful signal here, because the
  server only starts listening once migrations, backfill, and seed have finished, but do not
  read it as proof the API can serve. It sits outside the authenticated `/api/v1` prefix.

## Backfill the decryption keys of existing credentials

Private credentials created by earlier versions still hold their decryption key in
plaintext, so until this has run the confidentiality improvement covers only newly issued
ones. Run it once to bring the existing rows under encryption at rest. Nothing breaks while
you wait, because the read path still recognises legacy plaintext keys and those credentials
keep working either way.

Unlike the backfills that run automatically when the container starts, this one is
deliberately manual. Wrapping keys under a wrong `DATA_ENCRYPTION_KEY` would be
unrecoverable, so a human confirms the key before anything is rewritten.

Where it sits in the upgrade:

1. Complete steps 1 and 2 of [Before you upgrade](#before-you-upgrade), the database backup
   and the encryption audit, if you have not already.
2. Run the backfill, once any older instances that could still write plaintext keys
   have stopped. Re-running after they are gone is safe and converges.

Renaming `SERVICE_ENCRYPTION_KEY` to `DATA_ENCRYPTION_KEY` can happen before or after this
step. The application and the backfill resolve the active key the same way whichever name
holds it, so the backfill does not depend on the rename having been done.

The commands for a source checkout and for the Docker image, the preflight that aborts
on a wrong key, when `--force` applies, and what the run reports are in the
[decryption keys backfill reference](../reference-implementation/operations/backfills/decryption-keys).

## Rollback

After the upgrade has written any encrypted key (a newly issued credential, or a
completed backfill), rolling back to an earlier application version returns the raw
envelope JSON in place of those credentials' decryption keys, because earlier versions
have no unwrap step. Plan the upgrade as forward-only once credentials have been
issued, or restore the paired database backup when rolling back.

The three database migrations are additive or constraint-widening, so the schema itself
does not block a rollback. The identifier uniqueness migration widens a constraint, which
means rows created under v0.4 could violate the narrower v0.3 constraint if it were
reinstated.

## Key rotation

Existing envelopes are readable only under the key that wrote them, so changing
`DATA_ENCRYPTION_KEY` in place makes them unreadable. To move data onto a new key,
follow the [Encryption Key Rotation](../reference-implementation/operations/encryption-key-rotation)
procedure, which re-encrypts every stored envelope with the `rotate:encryption-key`
maintenance command.
