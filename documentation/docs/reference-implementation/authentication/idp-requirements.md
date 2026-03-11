---
sidebar_position: 3
title: IDP Requirements
---

# IDP Requirements

The Reference Implementation delegates authentication to a federated identity provider (IDP). This page describes the token claims, environment variables, and IDP configuration required for each [tenant mode](./tenant-modes).

The Reference Implementation currently supports two IDPs: **Keycloak** and **Zitadel**. The operator must specify which IDP the instance is configured to use. Support for additional providers requires changes to the Reference Implementation — [open an issue](https://github.com/uncefact/tests-untp/issues) to request support for another provider.

## Token Claims

The claims required in the IDP token depend on the [tenant mode](./tenant-modes). The provider-specific sections below describe how to configure each supported IDP to provide these claims.

### [Open Mode](./tenant-modes#open-mode)

| Claim | Required | Purpose |
|-------|----------|---------|
| `sub` | Yes | Unique user identifier — used to look up or create the user record |
| `name` | No | Used to name the auto-created tenant (e.g., "Alice Organisation") |
| `email` | No | Fallback for tenant naming if `name` is not available |

### [Closed Mode](./tenant-modes#closed-mode)

| Claim | Required | Purpose |
|-------|----------|---------|
| `sub` | Yes | Unique user identifier |
| Group claim (configurable) | Yes | Tenant identifier — used to resolve the tenant |
| `name` | No | Used for user record creation |
| `email` | No | Fallback for user identification |

The group claim name and format are configured via environment variables — see [Tenant Modes configuration](./tenant-modes#configuration).

### Service Accounts

Service accounts authenticate via Bearer tokens obtained from the IDP using the OAuth2 client credentials flow. The token must include:

| Claim | Required | Purpose |
|-------|----------|---------|
| `sub` | Yes | Unique service account identifier |
| `aud` | Yes | Token audience — must match `AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE` |
| `azp` | No | Authorised party — logged for audit purposes |
| Group claim | Yes ([closed mode](./tenant-modes#closed-mode) only) | Tenant identifier |

The `aud` claim is validated on every service account request. If it does not match the configured `AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE`, the token is rejected. See the provider-specific sections below for how to configure the audience.

See [Tenant Modes](./tenant-modes) for how service accounts are associated with tenants in each mode.

## Keycloak

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `AUTH_OIDC_PROVIDER` | Must be set to `keycloak` | Yes | `keycloak` |
| `AUTH_OIDC_ISSUER` | Keycloak realm issuer URL (e.g., `http://localhost:8080/realms/untp-reference-implementation`) | Yes | — |
| `AUTH_OIDC_CLIENT_ID` | OAuth2 client ID configured in Keycloak | Yes | `ri-app` |
| `AUTH_OIDC_CLIENT_SECRET` | OAuth2 client secret | Yes | — |
| `AUTH_OIDC_AUTHORIZATION_URL` | Browser-facing authorisation URL override | No | — |
| `AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE` | Expected audience claim in service account tokens — must match the audience mapper configured on the service account client | Yes | `ri-api` |
| `AUTH_SECRET` | Secret used to encrypt sessions (generate with `openssl rand -base64 32`) | Yes | — |
| `AUTH_TRUST_HOST` | Set to `true` when the Reference Implementation runs behind a reverse proxy or in a containerised environment where the host header may differ from the actual origin | No | — |
| `RI_APP_URL` | Base URL of the Reference Implementation (used for post-logout redirect) | Yes | `http://localhost:3003` |

`AUTH_OIDC_AUTHORIZATION_URL` is needed when Keycloak's issuer URL is only reachable from within Docker (e.g., `http://keycloak:8080/...`) but the browser needs a different URL (e.g., `http://localhost:8080/...`). If the issuer URL is reachable from both the server and the browser, this variable is not needed.

### IDP Configuration

#### Service account setup

Service account clients require two protocol mappers to work with the Reference Implementation:

1. **Audience mapper** — adds the `aud` claim to the access token so the Reference Implementation can validate the token:
   - Mapper type: `Audience`
   - Included Custom Audience: the value of `AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE` (e.g., `ri-api`)
   - Add to access token: enabled

2. **Group membership mapper** (required for [closed mode](./tenant-modes#closed-mode)) — adds the `groups` claim so the Reference Implementation can resolve the tenant:
   - Mapper type: `Group Membership`
   - Token claim name: `groups` (must match `TENANT_CLAIM_NAME`)
   - Add to access token: enabled
   - Full group path: enabled

The Docker Compose configuration includes two pre-configured service account clients (`ri-service-account` and `ri-service-account-2`) with both mappers already set up.

#### Open mode

In [open mode](./tenant-modes#open-mode), no special IDP configuration is needed beyond a standard OIDC client and the service account setup above. The `sub` claim is included by default in Keycloak tokens. Each service account is automatically provisioned its own tenant on first request.

#### Closed mode

For [closed mode](./tenant-modes#closed-mode), Keycloak must be configured to include group membership in the access token:

1. **Create groups** in the Keycloak realm — one per tenant (e.g., `/acme-corp`, `/globex-inc`)
2. **Assign users to groups** — each user should be in exactly one group
3. **Add a group membership mapper** to the OIDC client (the `ri-app` client used for browser sessions):
   - Mapper type: `Group Membership`
   - Token claim name: `groups` (must match `TENANT_CLAIM_NAME`)
   - Add to access token: enabled
   - Full group path: enabled

The mapper ensures the access token includes a `groups` array, e.g., `["/acme-corp"]`.

For service accounts in closed mode, the service account user must also have group membership. In the Keycloak realm import, this is configured by adding the service account user with a `groups` assignment:

```json
{
  "username": "service-account-ri-service-account",
  "enabled": true,
  "serviceAccountClientId": "ri-service-account",
  "groups": ["/acme-corp"]
}
```

The Docker Compose configuration includes two service accounts assigned to separate groups (`/acme-corp` and `/globex-inc`) for testing tenant isolation in closed mode.

## Zitadel

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `AUTH_OIDC_PROVIDER` | Must be set to `zitadel` | Yes | — |
| `AUTH_OIDC_ISSUER` | Zitadel instance URL (e.g., `https://my-instance.zitadel.cloud`) | Yes | — |
| `AUTH_OIDC_CLIENT_ID` | OAuth2 client ID configured in Zitadel | Yes | `ri-app` |
| `AUTH_OIDC_CLIENT_SECRET` | OAuth2 client secret | Yes | — |
| `AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE` | Zitadel project resource ID — required for service account token validation | Yes | — |
| `AUTH_SECRET` | Secret used to encrypt sessions (generate with `openssl rand -base64 32`) | Yes | — |
| `AUTH_TRUST_HOST` | Set to `true` when the Reference Implementation runs behind a reverse proxy or in a containerised environment where the host header may differ from the actual origin | No | — |
| `RI_APP_URL` | Base URL of the Reference Implementation (used for post-logout redirect) | Yes | `http://localhost:3003` |

### IDP Configuration

In [open mode](./tenant-modes#open-mode), no special configuration is needed. Zitadel includes `sub` in tokens by default.

For [closed mode](./tenant-modes#closed-mode), there are two approaches to mapping users to tenants in Zitadel. Both are supported — choose the one that best fits your deployment.

#### Organisation-based tenancy (recommended)

Each tenant maps to a separate Zitadel organisation. Users belong to the organisation that represents their tenant, and Zitadel automatically includes the organisation ID in the token.

```
TENANT_CLAIM_NAME=urn:zitadel:iam:user:resourceowner:id
TENANT_CLAIM_FORMAT=string
```

No custom actions or role configuration is required. This is the recommended approach — it uses Zitadel's native organisation model, and the claim is included automatically with zero additional configuration.

#### Role-based tenancy

All users exist within a single Zitadel organisation and are assigned project roles that represent their tenant (e.g., `org-acme`, `org-globex`). A custom Zitadel action flattens the role grants into a `groups` claim array that the Reference Implementation can read.

```
TENANT_CLAIM_NAME=groups
TENANT_CLAIM_FORMAT=array_first
```

This approach requires a custom action in Zitadel to transform the role claim, and project role assertion must be enabled on the Zitadel project. Each user or service account should have exactly one role grant. This may suit environments where a single Zitadel organisation manages all users and tenants are represented as lightweight role assignments rather than separate organisations.
