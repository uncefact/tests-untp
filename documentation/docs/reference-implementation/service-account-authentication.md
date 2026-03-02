---
sidebar_position: 12
title: Service Account Authentication
---

import Disclaimer from '../_disclaimer.mdx';

<Disclaimer />

## Overview

The Reference Implementation APIs support two authentication methods:

1. **Session-based authentication** - For interactive users via the web UI (uses OAuth2 authorization code flow)
2. **Service account authentication** - For automated integrations and machine-to-machine (M2M) access

This guide covers how to configure and use service account authentication for programmatic API access.

## Prerequisites

- An OIDC-compliant identity provider running and configured (e.g. Keycloak, Zitadel)
- A service account client configured in your identity provider (see [Identity Provider Configuration](#identity-provider-configuration))

## Identity Provider Configuration

The default Keycloak realm includes a pre-configured service account client:

| Property | Value |
|----------|-------|
| Client ID | `ri-service-account` |
| Client Secret | `service-account-secret` |
| Grant Type | Client Credentials |

:::warning Production Usage
For production deployments, you should:
1. Change the default client secret to a secure, randomly generated value
2. Configure appropriate client scopes and role mappings
:::

### Creating a Custom Service Account Client (Keycloak)

The steps below are Keycloak-specific. Consult your provider's documentation for other OIDC providers.

1. Navigate to your Keycloak Admin Console
2. Select your realm (e.g., `untp-reference-implementation`)
3. Go to **Clients** → **Create client**
4. Configure the client:
   - **Client ID**: Your desired client ID (e.g., `my-integration`)
   - **Client authentication**: ON
   - **Authorization**: OFF
   - **Authentication flow**: Check only "Service accounts roles"
5. Save the client and note the generated client secret from the **Credentials** tab

## Obtaining an Access Token

Use the OAuth2 client credentials grant to obtain an access token from your OIDC provider's token endpoint.

### Using cURL (Keycloak example)

```bash
# Set your configuration
KEYCLOAK_URL="http://localhost:8080"
REALM="untp-reference-implementation"
CLIENT_ID="ri-service-account"
CLIENT_SECRET="service-account-secret"

# Request an access token
curl -X POST "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}"
```

:::tip Other Providers
The token endpoint URL varies by provider. The Reference Implementation discovers it automatically via OIDC Discovery (`.well-known/openid-configuration`). For manual token requests, consult your provider's documentation.
:::

### Response

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI...",
  "expires_in": 300,
  "refresh_expires_in": 0,
  "token_type": "Bearer",
  "not-before-policy": 0,
  "scope": "profile email roles"
}
```

## Calling the API with a Bearer Token

Once you have an access token, include it in the `Authorization` header of your API requests.

### Using cURL

```bash
# Using the token obtained above
ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI..."

# Call the credentials API
curl -X POST "http://localhost:3003/api/v1/credentials" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Environment Variables

Configure the following environment variables for service account support:

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_OIDC_ISSUER` | OIDC provider issuer URL | Required |
| `AUTH_OIDC_PROVIDER` | Provider type (`keycloak` or `zitadel`) | `keycloak` |
| `AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE` | Expected token audience (must match IdP audience claim) | Required |
