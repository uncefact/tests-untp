---
sidebar_position: 1
title: Identity Resolver Service
---

# Identity Resolver Service

The identity resolver service used by the Reference Implementation registers links for a given identifier so that related information — such as credentials — can be discovered. It is an independent external service — the Reference Implementation communicates with it at runtime but does not include it. The Reference Implementation cannot publish discoverable credentials without this service.

## Supported Adapters

The Reference Implementation communicates with the identity resolver service through an [adapter](../service-architecture#how-the-registry-works). Each adapter implements the integration for a specific implementation of a service.

| Adapter | Service | Documentation |
|---------|---------|---------------|
| `PYX_IDR` | Pyx Identity Resolver | [Pyx IDR Adapter](./pyx-idr-adapter) |

To integrate a different identity resolver service, a new adapter must be contributed to the [adapter registry](../service-architecture#how-the-registry-works) — see [Adding an Adapter](../adding-an-adapter).

## Adoption Path

This service can be independently progressed through the [adoption ramp](../../overview#incremental-adoption):

1. **Use the bundled default** — Pyx Identity Resolver, provisioned automatically by Docker Compose
2. **Self-provision** — Run your own instance of the same identity resolver software
3. **Bring your own** — Integrate a different resolver service by contributing an adapter to the [adapter registry](../service-architecture#how-the-registry-works)
