# Reference Implementation E2E Tests

End-to-end tests for the UNTP Reference Implementation using Cypress.

Playground E2E lives in its own package at `packages/untp-playground/e2e/`. See that directory for invocation details.

## Test Categories

| Category        | Directory                  | Runs when                        |
| --------------- | -------------------------- | -------------------------------- |
| **API tests**   | `cypress/e2e/api/`         | any instance (API only)          |
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

The suite targets any instance of the RI and its dependent services using configuration only: the compose stack in this repository, an instance provisioned in CI, or a deployment. Every spec runs the same way against each. Nothing in the suite reads or writes the RI's database; every record it needs is created through the RI API, tagged with the run id, and deleted through the RI API again.

### Prerequisites

1. **Network access** from the test runner to:

   - The RI application URL
   - The identity provider (Keycloak or Zitadel)
   - VCKit, the storage service, the Identity Resolver, and the Playground when the relevant specs are enabled

2. **Identity-provider accounts** the suite signs in with. The compose stack imports `cypress/fixtures/keycloak-realm-e2e.json`, which defines all of them; a deployment provides its own:

   - Two users with passwords. In open mode each user's first sign-in provisions that user's own tenant, so nothing has to exist before the run. In closed mode both users belong to the same group.
   - Two service-account clients with client credentials. In open mode each resolves to its own tenant; in closed mode one belongs to the first group and the other to a second group.
   - Redirect URIs configured for the RI under test.
   - For Zitadel, `E2E_IDP_AUDIENCE` must identify the project used by the service-account clients.

3. **A tenant containing no operator data.** The suite creates records only under the accounts above. Do not point it at accounts whose tenants hold data you want to keep: the records it creates are its own, but an operator reviewing the tenant will see tagged test records while a run is in progress.

### Setup

1. Create `packages/reference-implementation/e2e/.env.e2e` and set the URLs, credentials, dependent-service settings, tenant settings, and capability flags listed in [Environment Variables](#environment-variables) below:

   ```bash
   touch packages/reference-implementation/e2e/.env.e2e
   # Edit .env.e2e with the deployment configuration
   ```

2. Run the tests (from repo root). The same commands serve the compose stack and a deployed instance:

   ```bash
   pnpm test:e2e:ri              # Uses E2E_TENANT_MODE from .env.e2e
   pnpm test:e2e:ri:open         # Explicit open mode
   pnpm test:e2e:ri:closed       # Explicit closed mode
   pnpm test:e2e:playground      # Playground E2E (runs from packages/untp-playground/e2e/)
   ```

### Test Data Safety

Each Cypress run has one tag, `e2e-<RUN_ID>`. `runTag()` exposes that value to specs. Every record created by a spec carries the tag in an API-visible name, alias, description, identifier value, canonical identifier, or caller-selected id.

#### What tests clean up

- **Per-spec API cleanup**: the support hook lists every RI collection for every authenticated actor used by the run (both signed-in users and both service accounts) and deletes only rows containing that run's tag, in dependency order. Credentials the RI issued go through `DELETE /api/v1/credentials/{id}` and external library records through `DELETE /api/v1/library/{id}`; a run-owned DID still flagged default has the flag cleared first. Deleting is idempotent, so a row that has already gone is not a failure. The RI removes a deleted credential's stored copy on a best-effort basis (see the [credentials API](../../../documentation/docs/reference-implementation/api/credentials.md#delete-a-credential)); the proof below covers RI records, and a copy the RI could not remove is reported in the RI's own log, not by the suite.
- **Final API cleanup and proof**: the harness `after:run` repeats the tagged deletion, retires the one Identity Resolver namespace the publishing spec registered (`e2e-pub-<tag>`, through the resolver's own API), then lists every collection again. Any leftover id or listing failure fails the run and is reported.
- **Residue check**: before the first spec, the harness lists every collection and refuses to start when a row carries an `e2e-<other-run-id>` tag from an earlier run (`E2E_RESIDUE_POLICY=fail`, the default). `E2E_RESIDUE_POLICY=clean` runs the same tag-scoped API cleanup for those tags first and fails if it cannot converge. A run killed before its final cleanup leaves tagged rows behind; the next run's residue check finds them, and `clean` is the recovery. The Identity Resolver namespace the publishing spec registers is recorded in `.e2e-run-state/resolver-namespaces.json` before registration; a run retires its own namespace at the end and any namespace an earlier run left there at the start, through the resolver's API, and refuses to start if that fails.

#### What tests never touch

- **System seed data**: system DIDs, system service instances, and seeded data models are never modified or deleted.
- **Other tagged data**: cleanup matches the current run tag rather than deleting by tenant, user, or collection-wide ownership.
- **Users and tenants**: the accounts the suite signs in with are the operator's fixtures, and so are the RI users and tenants those accounts' first sign-ins provision. Signing in does create them; the suite keeps them deliberately, because the RI has no route to remove a user or a tenant and the next run signs in as the same accounts. They hold no test records once cleanup has run. Point the suite only at accounts set aside for it.
- **Conformity vocabulary entries**: the RI exposes browse routes only. The CVC spec exercises the browse contract against whatever the instance holds and creates nothing.

#### Tenant isolation

In closed mode, the tenant is determined by the IDP group claim. The two users and the first service account belong to one group and the second service account to another, such as `org-e2e-alpha` and `org-e2e-beta`, named in `E2E_GROUP_ALPHA` and `E2E_GROUP_BETA`.

#### Configuration inputs and capabilities

The following inputs are the complete configuration surface used by the RI e2e harness. Values are read from the process environment or `.env.e2e`; `CYPRESS_` variables are also available through Cypress environment merging.

- RI: `CYPRESS_BASE_URL`
- Identity provider: `E2E_IDP_PROVIDER`, `E2E_IDP_BASE_URL`, `E2E_IDP_REALM`, `E2E_IDP_CLIENT_ID`, `E2E_IDP_CLIENT_SECRET`, `E2E_IDP_AUDIENCE`
- Human accounts: `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_USER2_EMAIL`, `E2E_USER2_PASSWORD`
- Service accounts: `E2E_SA1_CLIENT_ID`, `E2E_SA1_CLIENT_SECRET`, `E2E_SA2_CLIENT_ID`, `E2E_SA2_CLIENT_SECRET`
- VCKit: `E2E_VCKIT_BASE_URL`, `E2E_VCKIT_API_KEY`, `E2E_VCKIT_DID_WEB_RESOLVABLE`
- Storage: `E2E_STORAGE_BASE_URL` (as the RI reaches it), `E2E_STORAGE_PUBLIC_BASE_URL` (the same service as the test runner reaches it; specs that fetch a stored copy rewrite the RI's prefix to this one), `E2E_STORAGE_API_KEY`, `E2E_STORAGE_API_VERSION`, `E2E_STORAGE_PUBLIC_BUCKET`, `E2E_STORAGE_PRIVATE_BUCKET`
- Identity Resolver and Playground: `E2E_IDR_PUBLIC_BASE_URL`, `E2E_IDR_API_KEY`, `PLAYGROUND_BASE_URL`
- Tenant mode and groups: `E2E_TENANT_MODE`, `E2E_GROUP_ALPHA`, `E2E_GROUP_BETA`
- Harness controls: `E2E_RESIDUE_POLICY`, optional `E2E_RUN_ID`, and the private-address capability inputs `FETCH_ALLOW_PRIVATE_URLS`, `VERIFY_ALLOW_PRIVATE_URLS`, `CYPRESS_VERIFY_ALLOW_PRIVATE_URLS`

The capability flags are `E2E_VCKIT_DID_WEB_RESOLVABLE` and the private-address setting. There is no database or object-store configuration: the suite never connects to either.

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
| `E2E_USER2_PASSWORD`                | Second test user password (if different from first)                                                                                                                | (empty)                                                                     |
| `FETCH_ALLOW_PRIVATE_URLS`          | Application setting the harness reads to initialise its private-address capability key. Set to `false` when testing a deployment that rejects private addresses.   | Harness: `true` when neither application name is set; application: `false`. |
| `CYPRESS_VERIFY_ALLOW_PRIVATE_URLS` | Cypress input for the retained `VERIFY_ALLOW_PRIVATE_URLS` capability key. It is honoured only when neither application name is set, and never configures the app. | Unset.                                                                      |

The application still accepts `VERIFY_ALLOW_PRIVATE_URLS` as a deprecated name during RI v0.5 when the deployment forwards it. Blank or whitespace-only application values count as unset. The harness derives its initial capability key from the application settings. Cypress then merges its own inputs over `env` before the run starts: `cypress.env.json`, `CYPRESS_`- and `cypress_`-prefixed process variables, and `--env`. When either application name is set, a resolved key that differs from the application's boolean fails the run before any spec, naming the sources that can have supplied it. Agreement means the same boolean, so a string such as `"false"` from `cypress.env.json` or `--env` is refused too. When neither application name is set, the harness honours `CYPRESS_VERIFY_ALLOW_PRIVATE_URLS`, and falls back to `true` when that is unset as well, so an operator can still declare a remote instance's capability through any Cypress input. Both non-blank application names are a conflict and fail the application startup. See the [v0.5 migration guide](../../../documentation/docs/migration-guides/ri-v0.5.md#credential-fetch-settings-have-new-names) for the full mapping and warning period.

Eight spec cases still call `Cypress.env('VERIFY_ALLOW_PRIVATE_URLS')`. This is the harness capability key and does not read the old application setting. Six of them, in the service and data-model specs, skip when it is truthy, so a harness value of `true` against a strict app silently drops that SSRF coverage. The other two, in the credential verify specs, choose an assertion branch from it, so a value that does not match the running app either fails them or passes them for the wrong reason. Keep the harness value aligned with the running app. For a strict deployment, pass `FETCH_ALLOW_PRIVATE_URLS=false` to the Cypress process.

### did:web and HTTPS

The RI e2e Compose stack places VCKit behind the `vckit-tls` Caddy service. It serves `https://vckit.e2e.internal`, trusts the committed test CA inside VCKit, the RI app, the worker, and the Playground, and proxies every path to `vckit-api:3332`.

The `services.vckit.didWebResolvable` capability controls the two issuance tests that need VCKit to resolve a tenant-owned `did:web` document during signing. The Compose default is `true`. Set `CYPRESS_VCKIT_DID_WEB_RESOLVABLE=false` to skip both tests for an instance that cannot provide this capability. Cypress parses the `CYPRESS_` value as JSON, so use a boolean value rather than the string `"false"`.

The remaining DID ownership enforcement tests, including system default issuance, cross-tenant rejection, and fabricated DID rejection, run in all environments.
