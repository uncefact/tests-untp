---
sidebar_position: 1
title: Verifiable Credential Service
---

# Verifiable Credential Service

The verifiable credential service used by the Reference Implementation signs and verifies W3C Verifiable Credentials, creates and manages Decentralised Identifiers (DIDs), and handles cryptographic key material. It is an independent external service — the Reference Implementation communicates with it at runtime but does not include it. The Reference Implementation cannot issue or verify credentials without this service.

Any verifiable credential service used with the Reference Implementation must be conformant to the [UNTP Verifiable Credential profile](https://untp.unece.org/docs/specification/VerifiableCredentials).

## Supported Adapters

The Reference Implementation communicates with the verifiable credential service through an [adapter](../service-architecture#how-the-registry-works). Each adapter implements the integration for a specific implementation of a service.

| Adapter | Service                                           | Documentation                    |
| ------- | ------------------------------------------------- | -------------------------------- |
| `VCKIT` | VCKit — open-source verifiable credential toolkit | [VCKit Adapter](./vckit-adapter) |

To integrate a different verifiable credential service, a new adapter must be contributed to the [adapter registry](../service-architecture#how-the-registry-works) — see [Adding an Adapter](../adding-an-adapter).

## Status Entries

The service interface leaves status purposes open. Each provider decides which purposes it can mint, while the Reference Implementation applies its own issuance policy at the API boundary. See [Issue a Credential](../../api/credentials#issue-a-credential) for the purposes this system offers.

Signing takes an optional `statusPurposes` list. It names the purposes to mint and the order they appear in, an empty array asks for no status entries, and an absent option leaves the adapter's own default in force. One minted entry is written to the credential as a single `credentialStatus` object and several are written as an array, which is what the Bitstring Status List specification allows.

Issued credentials carry `statusListIndex` as an integer so they validate against the published UNTP v0.7.0 schemas. The [Bitstring Status List specification](https://www.w3.org/TR/2025/REC-vc-bitstring-status-list-20250515/#bitstringstatuslistentry) requires a string in base 10, so parsing and capture accept either wire shape and canonicalise the value to a decimal string for stored `CredentialStatusEntry` rows and comparisons. Revert the issued value to a string when the UNTP schema is corrected upstream.

Signing also takes an optional `serialise` hook. Where a provider mints an entry by rewriting a whole status list, concurrent mints on one list can lose entries, so the adapter hands the caller a key naming the list it is about to rewrite and runs the mint inside whatever the caller wraps around it. The key is opaque and is only fit for use as a lock name. A caller that supplies no hook gets no serialisation. The Reference Implementation supplies one backed by a database mutex, described under [status settings](../../operations/startup#credential-fetch-settings).

## Adoption Path

This service can be independently progressed through the [adoption ramp](../../overview#incremental-adoption):

1. **Use the bundled default** — VCKit, provisioned automatically by Docker Compose
2. **Self-provision** — Run your own VCKit instance with your own infrastructure
3. **Bring your own** — Integrate a different verifiable credential service by contributing an adapter to the [adapter registry](../service-architecture#how-the-registry-works)
