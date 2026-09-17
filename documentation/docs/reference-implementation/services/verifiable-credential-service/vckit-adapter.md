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
  When using the Docker Compose configuration from the [Reference Implementation repository](https://github.com/uncefact/tests-untp), VCKit and its database are provisioned automatically. When running the [Reference Implementation Docker image](https://github.com/orgs/uncefact/packages/container/package/tests-untp%2Freference-implementation) standalone, VCKit must be provisioned separately , refer to the [VCKit repository](https://github.com/uncefact/project-vckit) for setup instructions.

## Supported Version

The supported version of VCKit is `1.2.1`.

## Status issuance and serialisation

This adapter mints one status entry per requested purpose. Requesting both `revocation` and `suspension` creates one entry for each. When the caller names no purposes, the adapter mints `revocation`. The Reference Implementation always names the purposes itself, from the request or from `DEFAULT_STATUS_PURPOSES`, so that adapter default is not what an API caller sees. The general contract is described under [Status Entries](./#status-entries).

VCKit mints an entry by rewriting the whole encoded status list for an issuer, so two mints running at once on one list can lose an entry. The adapter therefore derives a serialisation key from the VCKit base origin and the status-list issuer and hands it to the caller's `serialise` hook, which wraps the provider call.

The Reference Implementation backs that hook with a transaction-scoped database mutex. It serialises participating mints and status sets that share one coordination database and one key, at the cost of holding an application connection for the duration of the provider call. It does not serialise any other VCKit client, and it does not establish that a provider request whose outcome is unknown has stopped. The acquisition budget is `STATUS_LOCK_ACQUIRE_MS`, described under [status settings](../../operations/startup#credential-fetch-settings). A credential is not issued when the budget expires or the lock is lost, and the caller sees the `503` described under [Issue a Credential](../../api/credentials#issue-a-credential).

VCKit's verifier fails a credential on any set bit, whatever the entry's `statusPurpose`. That is why only `revocation` and `suspension` are offered: no other purpose could be minted here and still carry its specified meaning.

The status entries captured at issuance come from the returned signed credential, without a second provider read during capture. A response that cannot be read, is malformed, is ambiguous or omits a requested purpose is reported as a capture failure while issuance continues. The [status API](../../api/credentials#change-issuer-status) reads and changes captured entries; only error-free singleton reads establish an observation. Unknown writes retain pending intent for explicit reconciliation.

## Multi-Tenancy

VCKit is a single-tenant system. The Reference Implementation adds a multi-tenancy isolation layer on top: each tenant's DIDs are registered in the Reference Implementation database, and the API enforces that tenants can only sign credentials using DIDs belonging to their own tenant.

## Environment Variables

The following environment variables configure the connection between the Reference Implementation and a VCKit instance:

| Variable                        | Description                            | Required | Default                 |
| ------------------------------- | -------------------------------------- | -------- | ----------------------- |
| `SYSTEM_VC_BASE_URL`            | Base URL of the VCKit instance         | Yes      | `http://localhost:3332` |
| `SYSTEM_VC_API_KEY`             | Authentication token for the VCKit API | Yes      | `test123`               |
| `SYSTEM_VC_ADAPTER_TYPE`        | Must be set to `VCKIT`                 | Yes      | `VCKIT`                 |
| `SYSTEM_VC_SERVICE_NAME`        | Display name for this service instance | No       | `System Default VC`     |
| `SYSTEM_VC_SERVICE_DESCRIPTION` | Description for this service instance  | No       | none                    |
| `SYSTEM_VC_API_VERSION`         | API version                            | No       | `1.0.0`                 |

These variables are used during [startup](../../operations/startup) to seed the default verifiable credential service instance into the [system tenant](../../system-architecture#system-tenant).

## API Configuration Schema

When creating or updating a VCKit service instance via the [Services API](../../api/services), the `config` object must conform to the following schema:

| Field        | Type           | Required | Default | Description                                                                     |
| ------------ | -------------- | -------- | ------- | ------------------------------------------------------------------------------- |
| `baseUrl`    | `string` (URL) | Yes      | none    | Base URL of the VCKit instance (e.g., `http://vckit-api:3332`)                  |
| `apiKey`     | `string`       | Yes      | none    | Authentication token for the VCKit API. **Sensitive**, masked in API responses. |
| `apiVersion` | `string`       | No       | `1.0.0` | API version to use when communicating with VCKit                                |

**Example:**

```json
{
  "baseUrl": "https://vckit.example.com",
  "apiKey": "your-api-key",
  "apiVersion": "1.0.0"
}
```

RI locking serialises participating operations sharing one coordination database and canonical provider/list identity. It does not serialise other VCKit clients or establish that an uncertain provider request has stopped.

The mutex surrounds the set call only. Preliminary reads and read-back happen outside it, within the same operation deadline. Losing the lock while a set is still in flight is an unknown outcome. Where that set call itself rejects, its own failure is reported instead, so a definitive provider refusal stays definitive. See [Credential status recovery](../../operations/credential-status-recovery) before enabling mutation.
