# Reference Implementation E2E Tests

End-to-end tests for the UNTP Reference Implementation using Cypress.

Playground E2E lives in its own package at `packages/untp-playground/e2e/`. See that directory for invocation details.

## Test Categories

| Category        | Directory                  | Runs when                        |
| --------------- | -------------------------- | -------------------------------- |
| **API tests**   | `cypress/e2e/api/`         | Always                           |
| **Open mode**   | `cypress/e2e/open_mode/`   | `E2E_TENANT_MODE=open` (default) |
| **Closed mode** | `cypress/e2e/closed_mode/` | `E2E_TENANT_MODE=closed`         |

API tests validate CRUD operations, validation, pagination, and error handling. They work identically in both tenant modes; the `seedTestOrg` task automatically detects the mode and resolves the correct tenant.

Open/closed mode tests validate tenant-specific behaviour: auto-provisioning, tenant isolation, and group-based tenant resolution.

By default (`E2E_TENANT_MODE=open`), the suite runs API tests + open mode tests. Set `E2E_TENANT_MODE=closed` to run API tests + closed mode tests instead.

## API login

`cy.apiLogin()` performs real Keycloak or Zitadel authentication, returns to a scriptless placeholder at `/`, and validates `/api/auth/session` before API setup starts. Cypress intercepts a single `GET /` during login, and later visits load the real application. Authentication, session and API responses are all real.

Keep API-only specs on that placeholder. Application pages start browser session fetches, and protected pages also fetch DIDs. Those concurrent cookie updates are the suspected cause of the 401s seen during shared setup (#783, #522). Specs that exercise the UI should visit their target page explicitly after API setup. The `cypress/e2e/api/auth_api/api-login.cy.ts` regression runs in both tenant modes and checks real authenticated API calls without background browser requests.

## Local Testing (Docker Compose)

No `.env.e2e` file is needed — all defaults in `cypress.config.ts` and `cypress/support/config.ts` point to the local Docker Compose services.

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

### Closed mode (local)

Both `-f` flags must be passed together on every compose invocation for closed mode, including any later ad-hoc command such as restarting a single service. Dropping the `docker-compose.e2e-closed.yml` override reverts `TENANT_MODE` to open.

Keep exactly one `FETCH_ALLOW_PRIVATE_URLS` value in the shell and use the same shell for these Compose commands and Cypress. The E2E Compose file forwards all six names, defaulting only its new boolean name to `true`, so a stale root `.env` old name alongside that default reaches the app and fails startup with the intended conflict.

```bash
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-closed.yml --profile ri --profile playground up -d --build
pnpm test:e2e:ri:closed
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-closed.yml --profile ri --profile playground down -v
```

## Testing a Deployed Instance

To run E2E tests against deployed instances of the RI and Playground (e.g. staging, production):

### Prerequisites

1. **Network access** from the test runner to:

   - The RI application URL
   - The identity provider (Keycloak or Zitadel)
   - The PostgreSQL database (direct connection for test setup/cleanup)

2. **Database access**:

   - Managed databases (DigitalOcean, AWS RDS, etc.) require SSL and restrict connections to trusted IP addresses.
   - Add the test runner's IP to the database's **trusted sources** or firewall rules.
   - SSL is enabled automatically when `E2E_DB_HOST` is not `localhost`.

3. **Identity provider**:
   - The RI's OIDC redirect URI must be registered in the IDP client configuration (e.g. `https://your-ri.example.com/api/auth/callback/zitadel`).
   - **Two test users** with passwords (for multi-user tenant tests).
   - **Two service accounts** with client credentials (for API auth tests).
   - All test users and service accounts must be in a **dedicated test group** (e.g. `org-e2e`) — not a group containing real data. Tests clean up all resource data within the test tenant.
   - For closed mode tenant isolation tests, a second group is needed (e.g. `org-e2e-beta`) with one SA assigned to each group.
   - For **Zitadel**: set `E2E_IDP_AUDIENCE` to the project ID so service account tokens include the `groups` claim.

### Setup

1. Create `packages/reference-implementation/e2e/.env.e2e` and set your deployment's URLs, credentials, and DB connection using the variables listed in [Environment Variables](#environment-variables) below:

   ```bash
   touch packages/reference-implementation/e2e/.env.e2e
   # Edit .env.e2e with your deployment's URLs, credentials, and DB connection
   ```

2. Run the tests (from repo root):

   ```bash
   pnpm test:e2e:ri              # Uses E2E_TENANT_MODE from .env.e2e
   pnpm test:e2e:ri:open         # Explicit open mode
   pnpm test:e2e:ri:closed       # Explicit closed mode
   pnpm test:e2e:playground      # Playground E2E (runs from packages/untp-playground/e2e/)
   ```

### Test Data Safety

Tests are designed to be safe to run against deployed instances, including production, provided the test users are in a **dedicated test tenant** (i.e. their own IDP group that contains no real data).

#### What tests clean up

- **Per-spec cleanup** (`before`/`after` hooks): Each spec deletes all resource data (credentials, DIDs, services, products, facilities, etc.) from the test tenant via direct DB operations. In closed mode, the tenant record itself is preserved — only the data within it is deleted.
- **User cleanup** (`before` hooks): Test user and OAuth Account records are deleted before each spec to prevent `OAuthAccountNotLinked` errors from stale sessions.
- **Service account cleanup**: The service account test specs clean up their own auto-provisioned SA users and associated tenants via the `cleanupServiceAccountData` task.
- **Global cleanup** (`after:run`): After all specs complete, Cypress runs a final cleanup that removes:
  - Human test users (`E2E_USER_EMAIL`, `E2E_USER2_EMAIL`) and their OAuth Account records
  - Orphaned OAuth Account records (where the user was already deleted)

#### What tests never touch

- **System seed data**: System DIDs, system service instances, and seeded data models are never modified or deleted.
- **Other tenants**: Cleanup only affects the tenant the test user belongs to. Real users in other IDP groups/tenants are completely isolated.
- **Real user accounts**: Cleanup targets users by their configured test email addresses or by the absence of an email (SA users). Real user accounts with different email addresses are never affected.

#### Tenant isolation

In closed mode, the tenant is determined by the IDP group claim. Test users must be assigned to a dedicated test group (e.g. `org-e2e`) that maps to a tenant used exclusively for testing. This ensures cleanup never affects production data. Multiple test tenants can coexist (e.g. `org-e2e-alpha` and `org-e2e-beta` for tenant isolation tests).

### Environment Variables

All variables and their defaults are set in [`cypress.config.ts`](./cypress.config.ts). Key variables:

| Variable                            | Purpose                                                                                                                                                            | Default                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `CYPRESS_BASE_URL`                  | RI application URL                                                                                                                                                 | `http://localhost:3003`                                                     |
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

Some credential issuance tests (issuing with a tenant-created DID, issuing with a DID on a non-primary VC service instance) require VCKit to resolve `did:web` DID documents during signing. The `did:web` specification requires HTTPS, so these tests are **automatically skipped** when the VCKit base URL is not HTTPS (i.e. in the local Docker Compose environment where VCKit runs on `http://vckit-api:3332`).

These tests run when VCKit is deployed with a publicly resolvable HTTPS domain (e.g. `https://vckit.example.com`). The remaining DID ownership enforcement tests (system default DID issuance, cross-tenant rejection, fabricated DID rejection) run in all environments.
