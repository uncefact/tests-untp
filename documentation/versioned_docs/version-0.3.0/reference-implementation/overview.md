---
sidebar_position: 1
title: Overview
---

The Reference Implementation is a ready-to-deploy, multi-tenant application that lets organisations issue, store, publish, and verify UNTP credentials — without needing to understand the underlying standards or build anything from scratch. This page explains why it exists, who it serves, and how organisations can progressively take ownership of the services it orchestrates.

## Why the Reference Implementation Exists

The United Nations Transparency Protocol (UNTP) is a protocol, not a platform. It defines how organisations share verifiable, tamper-proof information about products, facilities, and supply chain events — using W3C Verifiable Credentials and Decentralised Identifiers (DIDs). Any organisation that follows the specification can participate. There is no central authority, no single platform, and no vendor lock-in.

That openness is UNTP's strength, but it also creates an adoption barrier. Participating in UNTP requires understanding verifiable credentials, decentralised identifiers, credential storage, and identity resolution — technologies that most organisations have never worked with. The cost and complexity of learning these systems can stall adoption before it starts.

The Reference Implementation exists to remove that barrier. It abstracts the underlying complexity so that organisations can demonstrate the business value of UNTP participation without significant technical investment or deep understanding of the underlying standards:

- **Issue verifiable credentials** about products, facilities, conformity, and supply chain events
- **Store credentials** publicly or privately, with encryption handled automatically
- **Publish credentials** to an identity resolver so trading partners can discover them
- **Verify credentials** — fetch, check integrity, verify signatures, decrypt if private, and render for human review
- **Manage master data** — identifier schemes, organisations, facilities, and products; reuse this data at issuance time to reduce repetition
- **Manage decentralised identifiers** — create and manage DIDs for signing credentials, with a progressive adoption ramp from shared defaults to fully self-managed
- **Integrate via API** — all credential and configuration operations are available through a REST API for integration into existing systems

## Who It Serves

The Reference Implementation is designed to serve multiple deployment scenarios, not just a single organisation standing up its own instance. It is a multi-tenant system — each organisation operating within an instance is a separate tenant with fully isolated data, making a single instance suitable for hosting multiple organisations simultaneously.

| Scenario | Description |
|----------|-------------|
| **Pilot facilitators** | Provision an instance for a group of pilot participants, pre-configure tenants and users, and demonstrate UNTP capabilities across multiple organisations working together |
| **Pilot participants** | Log in to a provisioned instance, complete onboarding, and use the system to issue, store, publish, and verify credentials — building understanding of their role in the UNTP ecosystem |
| **Demo instances** | A publicly accessible instance (for UNTP core or its extensions) where users can self-register, explore UNTP capabilities, and evaluate whether the protocol fits their needs — without requiring an invitation or facilitator |
| **System integrators** | Consume the REST API to integrate UNTP credential operations into existing systems, using the Reference Implementation as the UNTP layer within their broader infrastructure |
| **Extension facilitators** | UNTP can be extended for specific domains (e.g. agriculture, critical raw materials, textiles). An extension facilitator can provision a dedicated Reference Implementation instance for their extension, or tenants within any existing Reference Implementation instance can register an extension and begin issuing credentials conforming to the extension — all using the same capabilities available for UNTP core |
| **Credential recipients** | Verify and view credentials without creating an account. This includes specification readers following links to example credentials, and supply chain partners verifying credentials they have received |

See [System Architecture](./system-architecture) for how multi-tenancy is enforced, including tenant isolation and how tenant identity is derived from authentication.

## Incremental Adoption

The Reference Implementation is not a black box to be used as-is forever. It is deliberately designed as an **onboarding ramp** — a starting point from which each layer of the system can be independently progressed toward full organisational ownership, without requiring the organisation to provision infrastructure or services that do not pertain to their core business.

The Reference Implementation orchestrates three external services:

| Service | What It Does |
|-----------------|-------------|
| Verifiable credential service | Signs and verifies W3C Verifiable Credentials; manages Decentralised Identifiers (DIDs) and cryptographic key material |
| Storage service | Stores credentials, render templates, and other binary data |
| Identity resolver service | Registers links for a given identifier so that related information, such as credentials, can be discovered |

All three are required — the Reference Implementation cannot operate without them. Each ships with a bundled default that works out of the box, but each can be independently progressed through three stages of ownership:

1. **Use the bundled default** — Zero provisioning, zero understanding required. It just works. The organisation focuses entirely on UNTP outcomes.

2. **Use the same open-source software, self-provisioned** — The organisation runs their own instance of the same software. They own the infrastructure but don't build anything custom.

3. **Bring your own implementation** — A completely different service, registered with the Reference Implementation through the service registry. Full ownership and control.

Each service progresses independently. An organisation might be at stage 3 for storage, stage 2 for the verifiable credential service, and still at stage 1 for identity resolution. There is no requirement to progress everything together, and no pressure to progress at all — the defaults are fully functional.

See [Service Architecture](./services/service-architecture) for how the service registry works.
