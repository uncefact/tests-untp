---
sidebar_position: 1
title: Verifiable Credential Service
---

# Verifiable Credential Service

The verifiable credential service used by the Reference Implementation signs and verifies W3C Verifiable Credentials, creates and manages Decentralised Identifiers (DIDs), and handles cryptographic key material. It is an independent external service — the Reference Implementation communicates with it at runtime but does not include it. The Reference Implementation cannot issue or verify credentials without this service.

Any verifiable credential service used with the Reference Implementation must be conformant to the [UNTP Verifiable Credential profile](https://untp.unece.org/docs/specification/VerifiableCredentials).

## Supported Adapters

The Reference Implementation communicates with the verifiable credential service through an [adapter](../service-architecture#how-the-registry-works). Each adapter implements the integration for a specific implementation of a service.

| Adapter | Service | Documentation |
|---------|---------|---------------|
| `VCKIT` | VCKit — open-source verifiable credential toolkit | [VCKit Adapter](./vckit-adapter) |

To integrate a different verifiable credential service, a new adapter must be contributed to the [adapter registry](../service-architecture#how-the-registry-works) — see [Adding an Adapter](../adding-an-adapter).

## Adoption Path

This service can be independently progressed through the [adoption ramp](../../overview#incremental-adoption):

1. **Use the bundled default** — VCKit, provisioned automatically by Docker Compose
2. **Self-provision** — Run your own VCKit instance with your own infrastructure
3. **Bring your own** — Integrate a different verifiable credential service by contributing an adapter to the [adapter registry](../service-architecture#how-the-registry-works)
