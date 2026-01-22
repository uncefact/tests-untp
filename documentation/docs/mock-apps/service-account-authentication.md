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

- Keycloak identity provider running and configured
- A service account client configured in Keycloak (see [Keycloak Configuration](#keycloak-configuration))

## Keycloak Configuration

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

### Creating a Custom Service Account Client

To create a new service account client in Keycloak:

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

Use the OAuth2 client credentials grant to obtain an access token from Keycloak.

### Using cURL

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

### Response

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI...",
  "expires_in": 300,
  "refresh_expires_in": 0,
  "token_type": "Bearer",
  "not-before-policy": 0,
  "scope": "profile email"
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
| `AUTH_KEYCLOAK_ISSUER` | Keycloak realm issuer URL | Required |
| `AUTH_KEYCLOAK_SERVICE_ACCOUNT_CLIENT_ID` | Service account client ID | `ri-service-account` |
| `AUTH_KEYCLOAK_SERVICE_ACCOUNT_CLIENT_SECRET` | Service account client secret | `service-account-secret` |
| `AUTH_KEYCLOAK_SERVICE_ACCOUNT_AUDIENCE` | Expected token audience (optional) | - |
