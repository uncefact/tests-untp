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

:::warning[Upgrading a checkout that used quay.io/minio/minio]
The object store keeps its data in `./minio_data` on the host. The Compose files now run it from the `pgsty/minio` image, and a checkout whose Compose file uses the `quay.io/minio/minio` image cannot read object store data that the new image has written. If you may need to go back to such a checkout, stop the running stack with `docker compose down` and copy `./minio_data` somewhere safe before you start the upgraded stack.
:::

:::warning[Upgrading a checkout whose storage service ran as root]
The storage service now runs as uid 1000 rather than root, and keeps uploads in the `storage_service_data` Docker volume. A volume that an earlier version of the stack wrote to stays owned by root, and uploads fail until you change its owner once. Before you start the upgraded stack, stop the running stack with `docker compose down` and find the volume's full name with `docker volume ls`. Compose prefixes it with the project name, which defaults to the checkout's directory name, so a checkout in `tests-untp` has `tests-untp_storage_service_data`. Then change its owner:

```bash
docker run --rm -v tests-untp_storage_service_data:/data alpine chown -R 1000:1000 /data
```

A wrong volume name creates a new, empty volume and changes that one instead. A fresh checkout needs no step.
:::

Clone the repository and start all services:

```bash
git clone https://github.com/uncefact/tests-untp.git
cd tests-untp
cp .env.example .env
docker compose up -d --build
```

This starts the Reference Implementation along with all of its dependencies — the database, identity provider, verifiable credential service, storage service, and identity resolver service.

On first start, the Reference Implementation automatically applies database migrations, converts existing rows to the formats the current version writes, and seeds system default records (the system tenant, data models, service instances, render templates, and more). Registrars and identifier schemes are not among them. They come from a seed manifest you mount at `/app/seed/custom`, so a stack started without one has no identifier schemes and cannot create an identifier until you supply some. See [Startup](./operations/startup) for the full details of what happens during this process, and [Custom Seed](./operations/custom-seed) for supplying your own manifest.

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
| Object Store | `identity-resolver-service-object-store` | `http://localhost:9000` | MinIO instance used by the identity resolver for persistent storage |
| Reference Implementation Database | `ri-db` | `localhost:5433` | PostgreSQL database for the Reference Implementation |

## Stop the Stack

```bash
docker compose down
```

This stops the containers and keeps all data, both the named volumes and the object store's data in `./minio_data`.

To remove all data and start fresh, remove the named volumes and the object store's data. `docker compose down -v` removes the named volumes but not `./minio_data`, which is a directory on the host. On a native Linux Docker engine those files belong to root, so use `sudo rm -rf ./minio_data` there.

:::warning
The `-v` flag removes all named volumes. This deletes all database data and forces Keycloak to re-import its realm configuration on the next start. Removing `./minio_data` deletes the identity resolver's stored data. Only use this when you need a clean slate.
:::

```bash
docker compose down -v
rm -rf ./minio_data
```

To go back to a checkout whose Compose file uses the `quay.io/minio/minio` image, stop the stack and replace `./minio_data` with the copy you took before upgrading. Without that copy, remove `./minio_data` instead, and the identity resolver starts with no stored data.

To reset a specific service's data without affecting others, remove its volume individually. For example, to reset Keycloak so it re-imports the latest realm configuration:

```bash
docker compose down
docker volume rm tests-untp_keycloak-data
docker compose up -d --build
```

## Next Steps

- [System Architecture](./system-architecture) — understand how the components connect
- [Authentication](./authentication) — how users and service accounts authenticate
- [Service Architecture](./services/service-architecture) — how the Reference Implementation communicates with external services
