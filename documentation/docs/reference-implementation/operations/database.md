---
sidebar_position: 2
title: Database
---

# Database

The Reference Implementation uses a PostgreSQL database to store all of its data — tenants, users, service registrations, credentials metadata, configuration, and more. See [System Architecture](../system-architecture#database) for what the database contains and how it relates to the external services.

## Provisioning

When using the Docker Compose configuration from the [repository](https://github.com/uncefact/tests-untp), a PostgreSQL instance (`ri-db`) is provisioned automatically. Organisations using the [Reference Implementation Docker image](https://github.com/orgs/uncefact/packages/container/package/tests-untp%2Freference-implementation) directly will need to provision their own PostgreSQL instance (version 17 or later recommended).

## Configuration

The database connection can be configured either as a single connection string or as separate parts.

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `RI_DATABASE_URL` | No | A complete PostgreSQL connection string. Takes precedence over the `RI_POSTGRES_*` variables below when set. | — |
| `RI_POSTGRES_HOST` | Yes, if `RI_DATABASE_URL` is not set | Database hostname | — |
| `RI_POSTGRES_PORT` | No | Database port | `5432` |
| `RI_POSTGRES_USER` | No | Database user | `postgres` |
| `RI_POSTGRES_PASSWORD` | No | Database password | `postgres` |
| `RI_POSTGRES_DB` | No | Database name | `ri` |

Set `RI_DATABASE_URL` directly when the connection string carries options the `RI_POSTGRES_*` parts cannot express, or when a secrets manager already supplies one. When it is set, the Reference Implementation uses it as given and does not construct a URL from the other variables.

## Migrations and Seeding

On startup, the Reference Implementation automatically applies database migrations and seeds system default records. See [Startup](./startup) for the full sequence, what gets seeded, and how to control each step.

## Local Development

For local development, the Prisma CLI provides useful tools:

```bash
cd packages/reference-implementation

# Visual database editor
pnpm prisma studio

# Create and apply a new migration
pnpm prisma migrate dev
```
