---
sidebar_position: 7
title: Pyx IDR Adapter
---

# Pyx IDR Adapter

The [Pyx Identity Resolver](https://github.com/pyx-industries/pyx-identity-resolver) is the default [identity resolver service](.) bundled with the Reference Implementation.

## About

The Pyx Identity Resolver is a standards-compliant identity resolution service. It uses MinIO as its object store backend.

- **Repository:** [github.com/pyx-industries/pyx-identity-resolver](https://github.com/pyx-industries/pyx-identity-resolver)
- **Docker image:** `ghcr.io/pyx-industries/pyx-identity-resolver`
When using the Docker Compose configuration from the [Reference Implementation repository](https://github.com/uncefact/tests-untp), the identity resolver and its MinIO backend are provisioned automatically. When running the [Reference Implementation Docker image](https://github.com/orgs/uncefact/packages/container/package/tests-untp%2Freference-implementation) standalone, the identity resolver must be provisioned separately — refer to the [Pyx Identity Resolver repository](https://github.com/pyx-industries/pyx-identity-resolver) for setup instructions.

## Supported Version

The supported version of the Pyx Identity Resolver is `3.0.0`.

## Environment Variables

The following environment variables configure the connection between the Reference Implementation and a Pyx Identity Resolver instance:

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SYSTEM_IDR_BASE_URL` | Base URL of the identity resolver | Yes | `http://localhost:3000` |
| `SYSTEM_IDR_API_KEY` | Authentication token for the identity resolver API | Yes | `test123` |
| `SYSTEM_IDR_ADAPTER_TYPE` | Must be set to `PYX_IDR` | Yes | `PYX_IDR` |
| `SYSTEM_IDR_SERVICE_NAME` | Display name for this service instance | No | `System Default IDR` |
| `SYSTEM_IDR_SERVICE_DESCRIPTION` | Description for this service instance | No | — |
| `SYSTEM_IDR_API_VERSION` | API version | No | `3.0.0` |
| `SYSTEM_IDR_DEFAULT_LINK_TYPE` | Default link type for credential registration | Yes | `untp:dpp` |
| `SYSTEM_IDR_DEFAULT_MIME_TYPE` | Default MIME type | Yes | `text/html` |
| `SYSTEM_IDR_DEFAULT_LANGUAGE` | Default language code | Yes | `en` |
| `SYSTEM_IDR_DEFAULT_CONTEXT` | Default regional context | Yes | `au` |
| `SYSTEM_IDR_DEFAULT_FWQS` | Whether to forward query strings to target URLs | No | `true` |

These variables are used during [startup](../../operations/startup) to seed the default identity resolver service instance into the [system tenant](../../system-architecture#system-tenant).

## API Configuration Schema

When creating or updating a Pyx IDR service instance via the [Services API](../../api/services), the `config` object must conform to the following schema:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `baseUrl` | `string` (URL) | Yes | — | Base URL of the identity resolver (e.g., `http://identity-resolver-service:3000`) |
| `apiKey` | `string` | Yes | — | Authentication token for the identity resolver API. **Sensitive** — masked in API responses. |
| `apiVersion` | `string` | Yes | `3.0.0` | API version to use when communicating with the identity resolver. Currently only `3.0.0` is accepted. |
| `defaultLinkType` | `string` (enum) | Yes | — | Default link type for credential registration. Accepted values: `untp:dpp`, `untp:dcc`, `untp:dte`, `untp:idr`, `untp:dfr`, `untp:dia`, `untp:cvc`. |
| `defaultMimeType` | `string` | Yes | — | Default MIME type for linked resources (e.g., `text/html`) |
| `defaultIanaLanguage` | `string` | Yes | — | Default language code (e.g., `en`) |
| `defaultContext` | `string` | Yes | — | Default regional context (e.g., `au`) |
| `defaultFwqs` | `boolean` | No | `false` | Whether to forward query strings to target URLs |

The `defaultLinkType`, `defaultMimeType`, `defaultIanaLanguage`, `defaultContext`, and `defaultFwqs` fields correspond to the default values used when registering links in the identity resolver. For details on what these values mean and how they affect link registration, see the [Pyx Identity Resolver link registration documentation](https://pyx-industries.github.io/pyx-identity-resolver/docs/developer-guide/#link-registration).

**Example:**

```json
{
  "baseUrl": "https://idr.example.com",
  "apiKey": "your-api-key",
  "apiVersion": "3.0.0",
  "defaultLinkType": "untp:dpp",
  "defaultMimeType": "text/html",
  "defaultIanaLanguage": "en",
  "defaultContext": "au",
  "defaultFwqs": false
}
```
