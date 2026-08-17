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

## Local Testing (Docker Compose)

No `.env.e2e` file is needed — all defaults in `cypress.config.ts` and `cypress/support/config.ts` point to the local Docker Compose services.

Ensure you have completed the [prerequisites](../../../README.md#prerequisites) in the root README before running.

> **Important**: The standard `docker-compose.yml` stack's `ri-db` service and this E2E stack's `e2e-ri-db` service both bind to host port 5433. Stop the standard stack (or its `ri-db` service) before starting the E2E stack below, otherwise the E2E stack fails to bind that port and does not start.

```bash
# Start the E2E stack (the `ri` profile activates the RI app + its dependencies)
docker compose -f docker-compose.e2e.yml --profile ri up -d --build

# Run tests (from repo root)
pnpm test:e2e:ri             # Headless (default: open mode)
pnpm test:e2e:ri:open        # Explicit open mode
pnpm test:e2e:ri:open-ui     # Interactive UI

# Teardown; use -v to remove volumes for a clean DB next time
docker compose -f docker-compose.e2e.yml --profile ri down -v
```

> **Important**: Always use `-v` when tearing down. Without it, stale user records persist in the database and cause `OAuthAccountNotLinked` errors on the next run.

### Closed mode (local)

Both `-f` flags must be passed together on every compose invocation for closed mode, including any later ad-hoc command such as restarting a single service. Dropping the `docker-compose.e2e-closed.yml` override reverts `TENANT_MODE` to open.

```bash
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-closed.yml --profile ri up -d --build
pnpm test:e2e:ri:closed
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e-closed.yml --profile ri down -v
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

| Variable                         | Purpose                                             | Default                 |
| -------------------------------- | --------------------------------------------------- | ----------------------- |
| `CYPRESS_BASE_URL`               | RI application URL                                  | `http://localhost:3003` |
| `E2E_IDP_PROVIDER`               | `keycloak` or `zitadel`                             | `keycloak`              |
| `E2E_IDP_BASE_URL`               | Identity provider URL                               | `http://localhost:8081` |
| `E2E_IDP_AUDIENCE`               | Zitadel project ID (Zitadel only)                   | —                       |
| `E2E_TENANT_MODE`                | `open` or `closed`                                  | `open`                  |
| `E2E_DB_HOST`                    | PostgreSQL host                                     | `localhost`             |
| `E2E_DB_PORT`                    | PostgreSQL port                                     | `5433`                  |
| `E2E_USER2_PASSWORD`             | Second test user password (if different from first) | (empty)                 |
| `E2E_DB_SSL_REJECT_UNAUTHORIZED` | Reject self-signed DB certs                         | `true`                  |
| `VERIFY_ALLOW_PRIVATE_URLS`      | SSRF validation (`false` for deployed)              | `true`                  |

### did:web and HTTPS

Some credential issuance tests (issuing with a tenant-created DID, issuing with a DID on a non-primary VC service instance) require VCKit to resolve `did:web` DID documents during signing. The `did:web` specification requires HTTPS, so these tests are **automatically skipped** when the VCKit base URL is not HTTPS (i.e. in the local Docker Compose environment where VCKit runs on `http://vckit-api:3332`).

These tests run when VCKit is deployed with a publicly resolvable HTTPS domain (e.g. `https://vckit.example.com`). The remaining DID ownership enforcement tests (system default DID issuance, cross-tenant rejection, fabricated DID rejection) run in all environments.
