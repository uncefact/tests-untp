---
sidebar_position: 3
title: VCKit Adapter
---

# VCKit Adapter

[VCKit](https://github.com/uncefact/project-vckit) is an open-source verifiable credential toolkit that provides credential signing, verification, DID management, and cryptographic key management. It is the default [verifiable credential service](.) bundled with the Reference Implementation.

## About VCKit

VCKit is a standalone service that exposes a set of REST APIs for working with W3C Verifiable Credentials and Decentralised Identifiers. It requires its own PostgreSQL database for storing keys, DIDs, and credential metadata.

- **Repository:** [github.com/uncefact/project-vckit](https://github.com/uncefact/project-vckit)
- **Docker image:** `ghcr.io/uncefact/project-vckit`
When using the Docker Compose configuration from the [Reference Implementation repository](https://github.com/uncefact/tests-untp), VCKit and its database are provisioned automatically. When running the [Reference Implementation Docker image](https://github.com/orgs/uncefact/packages/container/package/tests-untp%2Freference-implementation) standalone, VCKit must be provisioned separately — refer to the [VCKit repository](https://github.com/uncefact/project-vckit) for setup instructions.

## Supported Version

The supported version of VCKit is `1.2.1`.

## Multi-Tenancy

VCKit is a single-tenant system. The Reference Implementation adds a multi-tenancy isolation layer on top: each tenant's DIDs are registered in the Reference Implementation database, and the API enforces that tenants can only sign credentials using DIDs belonging to their own tenant.

## Environment Variables

The following environment variables configure the connection between the Reference Implementation and a VCKit instance:

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SYSTEM_VC_BASE_URL` | Base URL of the VCKit instance | Yes | `http://localhost:3332` |
| `SYSTEM_VC_API_KEY` | Authentication token for the VCKit API | Yes | `test123` |
| `SYSTEM_VC_ADAPTER_TYPE` | Must be set to `VCKIT` | Yes | `VCKIT` |
| `SYSTEM_VC_SERVICE_NAME` | Display name for this service instance | No | `System Default VC` |
| `SYSTEM_VC_SERVICE_DESCRIPTION` | Description for this service instance | No | — |
| `SYSTEM_VC_API_VERSION` | API version | No | `1.0.0` |

These variables are used during [startup](../../operations/startup) to seed the default verifiable credential service instance into the [system tenant](../../system-architecture#system-tenant).

## API Configuration Schema

When creating or updating a VCKit service instance via the [Services API](../../api/services), the `config` object must conform to the following schema:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `baseUrl` | `string` (URL) | Yes | — | Base URL of the VCKit instance (e.g., `http://vckit-api:3332`) |
| `apiKey` | `string` | Yes | — | Authentication token for the VCKit API. **Sensitive** — masked in API responses. |
| `apiVersion` | `string` | No | `1.0.0` | API version to use when communicating with VCKit |

**Example:**

```json
{
  "baseUrl": "https://vckit.example.com",
  "apiKey": "your-api-key",
  "apiVersion": "1.0.0"
}
```
