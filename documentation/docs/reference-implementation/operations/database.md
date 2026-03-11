---
sidebar_position: 2
title: Database
---

# Database

The Reference Implementation uses a PostgreSQL database to store all of its data — tenants, users, service registrations, credentials metadata, configuration, and more. See [System Architecture](../system-architecture#database) for what the database contains and how it relates to the external services.

## Provisioning

When using the Docker Compose configuration from the [repository](https://github.com/uncefact/tests-untp), a PostgreSQL instance (`ri-db`) is provisioned automatically. Organisations using the [Reference Implementation Docker image](https://github.com/orgs/uncefact/packages/container/package/tests-untp%2Freference-implementation) directly will need to provision their own PostgreSQL instance (version 17 or later recommended).

## Configuration

The following environment variables must be passed to the Reference Implementation to configure the database connection:

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `RI_POSTGRES_HOST` | Yes | Database hostname | — |
| `RI_POSTGRES_PORT` | No | Database port | `5432` |
| `RI_POSTGRES_USER` | No | Database user | `postgres` |
| `RI_POSTGRES_PASSWORD` | No | Database password | `postgres` |
| `RI_POSTGRES_DB` | No | Database name | `ri` |

## Migrations and Seeding

On startup, the Reference Implementation automatically applies database migrations and seeds system default records. See [Startup](./startup) for the full sequence, what gets seeded, and how to control each step.

## Local Development

For local development, the Prisma CLI provides useful tools:

```bash
cd packages/reference-implementation

# Visual database editor
yarn prisma studio

# Create and apply a new migration
yarn prisma migrate dev
```
