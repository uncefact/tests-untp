---
sidebar_position: 2
title: Quick Start
---

# Quick Start

This page walks through getting an instance of the Reference Implementation running using Docker Compose. By the end, you will have the Reference Implementation and all of its dependent services running locally.

:::tip[Read the documentation first]
Before diving in, we strongly recommend reading the [System Architecture](./system-architecture) and [Service Architecture](./services/service-architecture) pages. The Reference Implementation is a multi-component system with a federated identity provider, three external services, and a multi-tenant data model. Understanding how these pieces fit together will answer the vast majority of questions that come up during setup and operation — and will save significant time troubleshooting.
:::

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose (latest version recommended)

## Start the Stack

Clone the repository and start all services:

```bash
git clone https://github.com/uncefact/tests-untp.git
cd tests-untp
cp .env.example .env
docker compose up -d
```

This starts the Reference Implementation along with all of its dependencies — the database, identity provider, verifiable credential service, storage service, and identity resolver service.

On first start, the Reference Implementation automatically applies database migrations and seeds system default records (the system tenant, identifier schemes, data models, service instances, render templates, and more). See [Startup](./operations/startup) for the full details of what happens during this process.

## Access the API

The web UI is currently under active development. The primary interface is the REST API.

All API endpoints require a Bearer token. The Docker Compose configuration includes a pre-configured service account — see [Authentication](./authentication#obtaining-a-token) for how to obtain a token.

Interactive API documentation (Swagger UI) is available at [http://localhost:3003/api-docs](http://localhost:3003/api-docs) — it lists every endpoint with request/response schemas and lets you try requests directly from the browser.

## What's Running

The Docker Compose stack starts the following services. Each is an independent component — see [System Architecture](./system-architecture) for how they connect.

| Service | Container | URL | Description |
|---------|-----------|-----|-------------|
| Reference Implementation | `ri` | `http://localhost:3003` | REST API (and web UI, when available) |
| Keycloak | `keycloak` | `http://localhost:8080` | Federated identity provider — handles authentication and issues tokens |
| VCKit | `vckit-api` | `http://localhost:3332` | Verifiable credential service — signs and verifies credentials, manages DIDs |
| VCKit Database | `db` | `localhost:5432` | PostgreSQL database for VCKit (key material, DIDs, credential metadata) |
| Storage Service | `storage-service` | `http://localhost:3334` | Stores credentials, render templates, and other binary data |
| Identity Resolver | `identity-resolver-service` | `http://localhost:3000` | Resolves identifiers to linked resources such as credentials |
| Object Store | `identity-resolver-service-object-store` | `http://localhost:9000` | MinIO instance used by the identity resolver and storage service for persistent storage |
| Reference Implementation Database | `ri-db` | `localhost:5433` | PostgreSQL database for the Reference Implementation |

## Stop the Stack

```bash
docker compose down
```

To remove all data and start fresh:

```bash
docker compose down -v
```

:::warning
The `-v` flag removes all named volumes. This deletes all database data and forces Keycloak to re-import its realm configuration on the next start. Only use this when you need a clean slate.
:::

To reset a specific service's data without affecting others, remove its volume individually. For example, to reset Keycloak so it re-imports the latest realm configuration:

```bash
docker compose down
docker volume rm tests-untp_keycloak-data
docker compose up -d
```

## Next Steps

- [System Architecture](./system-architecture) — understand how the components connect
- [Authentication](./authentication) — how users and service accounts authenticate
- [Service Architecture](./services/service-architecture) — how the Reference Implementation communicates with external services
