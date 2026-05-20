---
sidebar_position: 5
title: UNCEFACT Storage Adapter
---

# UNCEFACT Storage Adapter

The [UNCEFACT Storage Service](https://github.com/uncefact/project-storage-service) is the default [storage service](.) bundled with the Reference Implementation.

## About

The UNCEFACT Storage Service is a standalone service that provides public and private bucket-based storage for credentials, render templates, and other binary data. It supports encryption for private storage and returns URIs, integrity hashes, and decryption keys for stored items.

- **Repository:** [github.com/uncefact/project-storage-service](https://github.com/uncefact/project-storage-service)
- **Docker image:** `ghcr.io/uncefact/project-storage-service`
When using the Docker Compose configuration from the [Reference Implementation repository](https://github.com/uncefact/tests-untp), the storage service is provisioned automatically. When running the [Reference Implementation Docker image](https://github.com/orgs/uncefact/packages/container/package/tests-untp%2Freference-implementation) standalone, the storage service must be provisioned separately — refer to the [storage service repository](https://github.com/uncefact/project-storage-service) for setup instructions.

## Supported Version

The supported version of the UNCEFACT Storage Service is `4.0.0`. The adapter also retains compatibility with the previous `3.x` deployments via the `apiVersion` configuration option.

## Environment Variables

The following environment variables configure the connection between the Reference Implementation and a UNCEFACT Storage Service instance:

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SYSTEM_STORAGE_BASE_URL` | Base URL of the storage service | Yes | `http://localhost:3334` |
| `SYSTEM_STORAGE_API_KEY` | Authentication token for the storage service API | Yes | `test123` |
| `SYSTEM_STORAGE_ADAPTER_TYPE` | Must be set to `UNCEFACT_STORAGE` | Yes | `UNCEFACT_STORAGE` |
| `SYSTEM_STORAGE_SERVICE_NAME` | Display name for this service instance | No | `System Default Storage` |
| `SYSTEM_STORAGE_SERVICE_DESCRIPTION` | Description for this service instance | No | — |
| `SYSTEM_STORAGE_API_VERSION` | API version (MAJOR.MINOR). `4.0` targets storage service >= 4.0.0; `3.1.0` targets the legacy 3.x deployment. | No | `4.0` |
| `SYSTEM_STORAGE_PUBLIC_BUCKET` | Bucket name for public (unencrypted) storage | Yes | `public-data` |
| `SYSTEM_STORAGE_PRIVATE_BUCKET` | Bucket name for private (encrypted) storage | Yes | `private-data` |

The public and private bucket names can be the same if separate buckets are not required.

These variables are used during [startup](../../operations/startup) to seed the default storage service instance into the [system tenant](../../system-architecture#system-tenant).

## API Configuration Schema

When creating or updating a UNCEFACT Storage service instance via the [Services API](../../api/services), the `config` object must conform to the following schema:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `baseUrl` | `string` (URL) | Yes | — | Base URL of the storage service (e.g., `http://storage-service:3334`) |
| `apiKey` | `string` | No | — | Authentication token for the storage service API. **Sensitive** — masked in API responses. |
| `apiVersion` | `string` | No | `4.0` | API version (MAJOR.MINOR) to use when communicating with the storage service. Mirrors the value reported in the service's `version.json`. `4.0` targets storage service >= 4.0.0; `3.1.0` is also accepted for 3.x deployments. |
| `publicBucket` | `string` | Yes | — | Bucket name for public (unencrypted) storage. Can be the same value as `privateBucket`. |
| `privateBucket` | `string` | Yes | — | Bucket name for private (encrypted) storage. Can be the same value as `publicBucket`. |

**Example:**

```json
{
  "baseUrl": "https://storage.example.com",
  "apiKey": "your-api-key",
  "apiVersion": "4.0",
  "publicBucket": "public-data",
  "privateBucket": "private-data"
}
```
