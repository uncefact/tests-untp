# Reference Implementation E2E Tests

End-to-end tests for the UNTP Reference Implementation using Cypress.

Playground E2E lives in its own package at `packages/untp-playground/e2e/`. See that directory for invocation details.

## Test Categories

| Category        | Directory                  | Runs when                        |
| --------------- | -------------------------- | -------------------------------- |
| **API tests**   | `cypress/e2e/api/`         | `E2E_DB_ACCESS=true` (compose)   |
| **Open mode**   | `cypress/e2e/open_mode/`   | `E2E_TENANT_MODE=open` (default) |
| **Closed mode** | `cypress/e2e/closed_mode/` | `E2E_TENANT_MODE=closed`         |

API tests validate CRUD operations, validation, pagination, and error handling. They work identically in both tenant modes; the `seedTestOrg` task automatically detects the mode and resolves the correct tenant.

Open/closed mode tests validate tenant-specific behaviour: auto-provisioning, tenant isolation, and group-based tenant resolution.

By default (`E2E_TENANT_MODE=open`), the suite runs API tests + open mode tests. Set `E2E_TENANT_MODE=closed` to run API tests + closed mode tests instead.

## API login

`cy.apiLogin()` performs real Keycloak or Zitadel authentication, returns to a scriptless placeholder at `/`, and validates `/api/auth/session` before API setup starts. Cypress intercepts a single `GET /` during login, and later visits load the real application. Authentication, session and API responses are all real.

Keep API-only specs on that placeholder. Application pages start browser session fetches, and protected pages also fetch DIDs. Those concurrent cookie updates are the suspected cause of the 401s seen during shared setup (#783, #522). Specs that exercise the UI should visit their target page explicitly after API setup. The `cypress/e2e/api/auth_api/api-login.cy.ts` regression runs in both tenant modes and checks real authenticated API calls without background browser requests.

## Local Testing (Docker Compose)

No `.env.e2e` file is needed. All defaults in `cypress.config.ts` and `cypress/support/config.ts` point to the local Docker Compose services.

Ensure you have completed the [prerequisites](../../../README.md#prerequisites) in the root README before running.

> **Important**: The standard `docker-compose.yml` stack's `ri-db` service and this E2E stack's `e2e-ri-db` service both bind to host port 5433. Stop the standard stack (or its `ri-db` service) before starting the E2E stack below, otherwise the E2E stack fails to bind that port and does not start.

> **Important**: This suite needs the Playground as well as the RI. The `v0.7-issue-verify-matrix` API spec issues a credential through the RI and then verifies it through the Playground, so both profiles must be active. Starting the `ri` profile alone leaves nothing listening on port 4000 and that spec fails for every credential type. Pass both profiles to every compose invocation, including teardown, so the Playground container is removed with the rest of the stack.

Before starting a local stack, remove `VERIFY_ALLOW_PRIVATE_URLS` from the root `.env`. If you set it deliberately, rename it to `FETCH_ALLOW_PRIVATE_URLS` without changing the value. A root `.env` that still carries the old name alongside the new one fails the Cypress config load with the same conflict message the app container reports, because the harness reads that file too. Set exactly one boolean name in the shell used for both Compose and Cypress. The E2E Compose harness defaults private container addresses to allowed for local testing. To test a deployment with SSRF protection enabled, use `export FETCH_ALLOW_PRIVATE_URLS=false` instead.

Write `FETCH_ALLOW_PRIVATE_URLS` and `VERIFY_ALLOW_PRIVATE_URLS` as literal values. The harness reads the environment files literally, while Compose expands `${VAR:-default}` and `$VAR` in the root `.env`. A single-quoted `'$VAR'` is a literal to Compose, but once the file is parsed the harness cannot tell an expression from a quoted literal, so it refuses both rather than guessing. The Cypress config load refuses a value containing a `$` in either name and tells you which one. The remedy is to replace the expression with a literal in the file, or to export the literal name in the shell that runs Cypress, which takes precedence over the files. This restriction covers only these two names. Every other root `.env` setting is left alone.

```bash
# Start the E2E stack (`ri` activates the RI app + its dependencies, `playground` adds the Playground)
docker compose -f docker-compose.e2e.yml --profile ri --profile playground up -d --build

# Run tests (from repo root)
pnpm test:e2e:ri             # Headless (default: open mode)
pnpm test:e2e:ri:open        # Explicit open mode
pnpm test:e2e:ri:open-ui     # Interactive UI

# Teardown; use -v to remove volumes for a clean DB next time
docker compose -f docker-compose.e2e.yml --profile ri --profile playground down -v
```

> **Important**: Always use `-v` when tearing down. Without it, stale user records persist in the database and cause `OAuthAccountNotLinked` errors on the next run.

### Offline publishing-host run

The offline override adds a CoreDNS service that returns NXDOMAIN for the publishing hosts while forwarding other DNS queries. It is an open-mode run, so use the open E2E command.

```bash
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-offline.yml --profile ri --profile playground up -d --build
pnpm test:e2e:ri:open
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-offline.yml --profile ri --profile playground down -v
```

CI also probes `untp.unece.org` from `app`, `app-worker`, and `untp-playground` before Cypress starts. Each lookup must fail with `ENOTFOUND`.

### Legacy fetch settings run

Before running this stack, remove `FETCH_ALLOW_PRIVATE_URLS` and `VERIFY_ALLOW_PRIVATE_URLS` from the repository-root `.env`. Cypress reads that file, so the shell below must be the only source for the private-address capability.

```bash
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-legacy-fetch.yml --profile ri --profile playground up -d --build
VERIFY_ALLOW_PRIVATE_URLS=true pnpm --filter reference-implementation-e2e test:e2e:open -- --spec cypress/e2e/api/credential_api/credential-verify.cy.ts
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-legacy-fetch.yml --profile ri --profile playground down -v
```

The CI job checks the app logs for the deprecation warning emitted for each v0.4 `VERIFY_*` name.

### Bundled artefact drift

The nightly workflow and `workflow_dispatch` run install, build, and `artefacts:check` for `@uncefact/untp-utils`. The check fetches each upstream copy, compares it with the bundle, names any differing artefact, and writes nothing.

When the check fails, review the named upstream change first. Run `artefacts:refresh` in a PR to update the bundle after that review. Do not run `artefacts:refresh` in CI.

### Closed mode (local)

Both `-f` flags must be passed together on every compose invocation for closed mode, including any later ad-hoc command such as restarting a single service. Dropping the `docker-compose.e2e-closed.yml` override reverts `TENANT_MODE` to open.

Keep exactly one `FETCH_ALLOW_PRIVATE_URLS` value in the shell and use the same shell for these Compose commands and Cypress. The E2E Compose file forwards all six names, defaulting only its new boolean name to `true`, so a stale root `.env` old name alongside that default reaches the app and fails startup with the intended conflict.

```bash
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-closed.yml --profile ri --profile playground up -d --build
pnpm test:e2e:ri:closed
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-closed.yml --profile ri --profile playground down -v
```

## Running against a deployed instance

The suite can target a deployed RI and its dependent services using configuration only. It does not assume that the RI is hosted by this repository.

### Prerequisites

1. **Network access** from the test runner to:

   - The RI application URL
   - The identity provider (Keycloak or Zitadel)
   - VCKit, the storage service, the Identity Resolver, and the Playground when the relevant specs are enabled

2. **Identity-provider fixtures**:

   - One test user and a second test user with passwords
   - Two service-account clients with client credentials
   - Credentials and redirect URIs configured for the deployed RI
   - A dedicated group or tenant containing no operator data
   - A second group for closed-mode tenant-isolation tests
   - For Zitadel, `E2E_IDP_AUDIENCE` must identify the project used by the service-account clients

3. **The e2e realm is optional**. The compose stack imports `cypress/fixtures/keycloak-realm-e2e.json` with its named users, service-account clients and groups. A deployed instance uses its own identity provider, so set `E2E_IDP_E2E_REALM=false` and the cases that depend on the realm fixture (browser login with the fixture users, closed-mode group tenancy) skip with a stated reason; the service-account API cases run with whatever two client-credential accounts you configure.

4. **Database access is optional**. Leave `E2E_DB_ACCESS` unset or set it to `false` for a deployment run. Set it to `true` only for the compose-only database fallback, with the database host, port, credentials, and SSL setting configured. The deployed-instance path uses the RI API for resource cleanup and never needs database credentials.

### Setup

1. Create `packages/reference-implementation/e2e/.env.e2e` and set the URLs, credentials, dependent-service settings, tenant settings, and capability flags listed in [Environment Variables](#environment-variables) below:

   ```bash
   touch packages/reference-implementation/e2e/.env.e2e
   # Edit .env.e2e with the deployment configuration
   ```

2. Run the tests (from repo root). The same commands serve the compose stack and a deployed instance; for a deployment, declare the two capabilities the compose stack has and a deployment does not:

   ```bash
   export E2E_DB_ACCESS=false E2E_IDP_E2E_REALM=false   # deployment run: API-only cleanup, own identity provider
   pnpm test:e2e:ri              # Uses E2E_TENANT_MODE from .env.e2e
   pnpm test:e2e:ri:open         # Explicit open mode
   pnpm test:e2e:ri:closed       # Explicit closed mode
   pnpm test:e2e:playground      # Playground E2E (runs from packages/untp-playground/e2e/)
   ```

   The `:open` and `:closed` scripts default `E2E_DB_ACCESS` to `true` for the compose stack; a value set in the environment wins.

### Test Data Safety

Each Cypress run has one tag, `e2e-<RUN_ID>`. `runTag()` exposes that value to specs. Every record created by a spec carries the tag in an API-visible name, alias, description, identifier value, canonical identifier, or caller-selected id.

#### What tests clean up

- **Per-spec API cleanup**: the support hook lists every RI collection for every authenticated actor used by the run and deletes only rows containing that run's tag. It runs in dependency order and repeats safely if a row has already gone.
- **Final API cleanup and proof**: the harness `after:run` repeats the tagged deletion, then lists every collection again. Any leftover id or listing failure fails the run and is reported.
- **Compose fallback**: when `E2E_DB_ACCESS=true`, database cleanup is a compose-only fallback for native credentials, CVC records, and identity-provider users or tenants that have no RI delete route. It remains tag-scoped for resource rows and reports failures.
- **Object storage**: the MinIO sweep is enabled only with database access and removes only object keys containing the current run tag.

#### What tests never touch

- **System seed data**: System DIDs, system service instances, and seeded data models are never modified or deleted.
- **Other tagged data**: API cleanup matches the current run tag rather than deleting by tenant, user, or collection-wide ownership.
- **Conformity records without routes**: the RI currently exposes CVC listing routes but no CVC delete routes. The CVC seeding spec is therefore gated on `E2E_DB_ACCESS` and uses the compose fallback.
- **Identity-provider users and tenants**: these have no RI API cleanup equivalent and the specs that create them are gated on `E2E_DB_ACCESS`.

#### Tenant isolation

In closed mode, the tenant is determined by the IDP group claim. Test users and service accounts must be assigned to dedicated test groups such as `org-e2e-alpha` and `org-e2e-beta`. `E2E_RESIDUE_POLICY=fail` is the default and refuses to start when an earlier `e2e-<other-run-id>` tag is listed. `E2E_RESIDUE_POLICY=clean` attempts the same tag-scoped API cleanup first and fails if it cannot converge.

#### Configuration inputs and capabilities

The following inputs are the complete configuration surface used by the RI e2e harness. Values are read from the process environment or `.env.e2e`; `CYPRESS_` variables are also available through Cypress environment merging.

- RI: `CYPRESS_BASE_URL`
- Identity provider: `E2E_IDP_PROVIDER`, `E2E_IDP_BASE_URL`, `E2E_IDP_REALM`, `E2E_IDP_CLIENT_ID`, `E2E_IDP_CLIENT_SECRET`, `E2E_IDP_AUDIENCE`
- Human accounts: `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_USER2_EMAIL`, `E2E_USER2_PASSWORD`
- Service accounts: `E2E_SA1_CLIENT_ID`, `E2E_SA1_CLIENT_SECRET`, `E2E_SA2_CLIENT_ID`, `E2E_SA2_CLIENT_SECRET`
- VCKit: `E2E_VCKIT_BASE_URL`, `E2E_VCKIT_API_KEY`, `E2E_VCKIT_DID_WEB_RESOLVABLE`
- Storage: `E2E_STORAGE_BASE_URL`, `E2E_STORAGE_API_KEY`, `E2E_STORAGE_API_VERSION`, `E2E_STORAGE_PUBLIC_BUCKET`, `E2E_STORAGE_PRIVATE_BUCKET`
- Identity Resolver and Playground: `E2E_IDR_PUBLIC_BASE_URL`, `E2E_IDR_API_KEY`, `PLAYGROUND_BASE_URL`
- MinIO cleanup: `OBJECT_STORAGE_BUCKET_NAME`, `APP_ENDPOINT`, `OBJECT_STORAGE_PORT`, `OBJECT_STORAGE_USE_SSL`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`
- Tenant fixtures: `E2E_TENANT_MODE`, `E2E_TEST_ORG_ID`, `E2E_GROUP_ALPHA`, `E2E_GROUP_BETA`
- Harness controls: `E2E_DB_ACCESS`, `E2E_RESIDUE_POLICY`, optional `E2E_RUN_ID`, and the private-address capability inputs `FETCH_ALLOW_PRIVATE_URLS`, `VERIFY_ALLOW_PRIVATE_URLS`, `CYPRESS_VERIFY_ALLOW_PRIVATE_URLS`
- Compose database fallback: `E2E_DB_HOST`, `E2E_DB_PORT`, `E2E_DB_USER`, `E2E_DB_PASSWORD`, `E2E_DB_NAME`, `E2E_DB_SSL_REJECT_UNAUTHORIZED`

The capability flags are `E2E_DB_ACCESS`, `E2E_VCKIT_DID_WEB_RESOLVABLE`, and the private-address setting. The compose `test:e2e:open` and `test:e2e:closed` scripts set `E2E_DB_ACCESS=true`; all other invocations default to `false`. The proposed `E2E_IDP_E2E_REALM` identity-provider capability flag remains an unresolved orchestration decision and is not silently enabled here.

### Environment Variables

All variables and their defaults are set in [`cypress.config.ts`](./cypress.config.ts). Key variables:

| Variable                            | Purpose                                                                                                                                                            | Default                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `CYPRESS_BASE_URL`                  | RI application URL                                                                                                                                                 | `http://localhost:3003`                                                     |
| `E2E_VCKIT_BASE_URL`                | VCKit base URL stored in e2e service instances                                                                                                                     | `https://vckit.e2e.internal`                                                |
| `E2E_VCKIT_DID_WEB_RESOLVABLE`      | Declares whether the configured VCKit instance can resolve `did:web` documents over HTTPS during signing                                                           | `true`                                                                      |
| `E2E_IDP_PROVIDER`                  | `keycloak` or `zitadel`                                                                                                                                            | `keycloak`                                                                  |
| `E2E_IDP_BASE_URL`                  | Identity provider URL                                                                                                                                              | `http://localhost:8081`                                                     |
| `E2E_IDP_AUDIENCE`                  | Zitadel project ID (Zitadel only)                                                                                                                                  | (none)                                                                      |
| `E2E_TENANT_MODE`                   | `open` or `closed`                                                                                                                                                 | `open`                                                                      |
| `E2E_DB_HOST`                       | PostgreSQL host                                                                                                                                                    | `localhost`                                                                 |
| `E2E_DB_PORT`                       | PostgreSQL port                                                                                                                                                    | `5433`                                                                      |
| `E2E_USER2_PASSWORD`                | Second test user password (if different from first)                                                                                                                | (empty)                                                                     |
| `E2E_DB_SSL_REJECT_UNAUTHORIZED`    | Reject self-signed DB certs                                                                                                                                        | `true`                                                                      |
| `FETCH_ALLOW_PRIVATE_URLS`          | Application setting the harness reads to initialise its private-address capability key. Set to `false` when testing a deployment that rejects private addresses.   | Harness: `true` when neither application name is set; application: `false`. |
| `CYPRESS_VERIFY_ALLOW_PRIVATE_URLS` | Cypress input for the retained `VERIFY_ALLOW_PRIVATE_URLS` capability key. It is honoured only when neither application name is set, and never configures the app. | Unset.                                                                      |

The application still accepts `VERIFY_ALLOW_PRIVATE_URLS` as a deprecated name during RI v0.5 when the deployment forwards it. Blank or whitespace-only application values count as unset. The harness derives its initial capability key from the application settings. Cypress then merges its own inputs over `env` before the run starts: `cypress.env.json`, `CYPRESS_`- and `cypress_`-prefixed process variables, and `--env`. When either application name is set, a resolved key that differs from the application's boolean fails the run before any spec, naming the sources that can have supplied it. Agreement means the same boolean, so a string such as `"false"` from `cypress.env.json` or `--env` is refused too. When neither application name is set, the harness honours `CYPRESS_VERIFY_ALLOW_PRIVATE_URLS`, and falls back to `true` when that is unset as well, so an operator can still declare a remote instance's capability through any Cypress input. Both non-blank application names are a conflict and fail the application startup. See the [v0.5 migration guide](../../../documentation/docs/migration-guides/ri-v0.5.md#credential-fetch-settings-have-new-names) for the full mapping and warning period.

Eight spec cases still call `Cypress.env('VERIFY_ALLOW_PRIVATE_URLS')`. This is the harness capability key and does not read the old application setting. Six of them, in the service and data-model specs, skip when it is truthy, so a harness value of `true` against a strict app silently drops that SSRF coverage. The other two, in the credential verify specs, choose an assertion branch from it, so a value that does not match the running app either fails them or passes them for the wrong reason. Keep the harness value aligned with the running app. For a strict deployment, pass `FETCH_ALLOW_PRIVATE_URLS=false` to the Cypress process.

### did:web and HTTPS

The RI e2e Compose stack places VCKit behind the `vckit-tls` Caddy service. It serves `https://vckit.e2e.internal`, trusts the committed test CA inside VCKit, the RI app, the worker, and the Playground, and proxies every path to `vckit-api:3332`.

The `services.vckit.didWebResolvable` capability controls the two issuance tests that need VCKit to resolve a tenant-owned `did:web` document during signing. The Compose default is `true`. Set `CYPRESS_VCKIT_DID_WEB_RESOLVABLE=false` to skip both tests for an instance that cannot provide this capability. Cypress parses the `CYPRESS_` value as JSON, so use a boolean value rather than the string `"false"`.

The remaining DID ownership enforcement tests, including system default issuance, cross-tenant rejection, and fabricated DID rejection, run in all environments.
