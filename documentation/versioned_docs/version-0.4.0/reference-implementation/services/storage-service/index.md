---
sidebar_position: 1
title: Storage Service
---

# Storage Service

The storage service used by the Reference Implementation stores credentials, render templates, and other binary data. It is an independent external service — the Reference Implementation communicates with it at runtime but does not include it. It supports both public and private storage modes — public storage returns a URI and integrity hash, while private storage encrypts the content and additionally returns a decryption key. The Reference Implementation cannot publish credentials without this service.

## Supported Adapters

The Reference Implementation communicates with the storage service through an [adapter](../service-architecture#how-the-registry-works). Each adapter implements the integration for a specific implementation of a service.

| Adapter | Service | Documentation |
|---------|---------|---------------|
| `UNCEFACT_STORAGE` | UNCEFACT Storage Service | [UNCEFACT Storage Adapter](./uncefact-storage-adapter) |

To integrate a different storage service, a new adapter must be contributed to the [adapter registry](../service-architecture#how-the-registry-works) — see [Adding an Adapter](../adding-an-adapter).

## Adoption Path

This service can be independently progressed through the [adoption ramp](../../overview#incremental-adoption):

1. **Use the bundled default** — UNCEFACT Storage Service, provisioned automatically by Docker Compose
2. **Self-provision** — Run your own instance of the same storage software
3. **Bring your own** — Integrate any storage backend by contributing an adapter to the [adapter registry](../service-architecture#how-the-registry-works)
