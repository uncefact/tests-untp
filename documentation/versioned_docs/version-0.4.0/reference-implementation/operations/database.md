---
sidebar_position: 3
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
| `RI_POSTGRES_PORT` | No, in the container | Database port | `5432` |
| `RI_POSTGRES_USER` | No, in the container | Database user | `postgres` |
| `RI_POSTGRES_PASSWORD` | No, in the container | Database password | `postgres` |
| `RI_POSTGRES_DB` | No, in the container | Database name | `ri` |

Set `RI_DATABASE_URL` directly when the connection string carries options the `RI_POSTGRES_*` parts cannot express, or when a secrets manager already supplies one. When it is set, the Reference Implementation uses it as given and does not construct a URL from the other variables.

The port, user, password, and database defaults above are the container entrypoint's fallbacks for quick local starts, applied only when `RI_POSTGRES_HOST` is set and `RI_DATABASE_URL` is not. Outside the container, for example running `pnpm prisma migrate dev`, `pnpm prisma studio`, or `next build`/`next start` directly, there is no partial defaulting: set either a full `RI_DATABASE_URL` or all five `RI_POSTGRES_*` variables, or the command fails with "No database target configured". Set explicit credentials in any real deployment, and see [Minimum Privileges](#minimum-privileges) for the account to provision.

## Minimum Privileges

Superuser access is not required. The migrations Prisma Migrate applies at startup perform standard DDL (creating, altering, and dropping the application's own tables, indexes, constraints, and enum types) plus data migrations on those tables, and never install PostgreSQL extensions.

On a shared PostgreSQL instance, provision a dedicated user that owns a dedicated database:

```sql
CREATE USER ri_user WITH PASSWORD '...';
CREATE DATABASE ri OWNER ri_user;
```

The Reference Implementation creates its tables in the database's default `public` schema; the connection URLs its tooling constructs always target `public`.

On a freshly created PostgreSQL 15+ database this is sufficient for the container's startup path (`prisma migrate deploy`) and for the application at runtime: the database owner is an implicit member of `pg_database_owner`, which owns the `public` schema, so `USAGE` and `CREATE` follow without further grants. On a database that was restored from a dump or upgraded from an earlier PostgreSQL major version, the `public` schema keeps its previous owner and permissions, so check that `ri_user` can create in it and that untrusted roles cannot.

The Docker Compose configuration in the repository provisions a dedicated `ri-db` container whose init user (`ri-postgres` by default) is that container's cluster superuser, which is the standard behaviour of the official PostgreSQL image for a single-purpose instance. That does not mean the application needs superuser rights; when pointing the Reference Implementation at a shared instance, the dedicated owner-user above is sufficient.

## Migrations, Backfills, and Seeding

On startup, the Reference Implementation automatically applies database migrations, converts existing rows to the formats the current version writes, and seeds system default records. See [Startup](./startup) for the full sequence, what gets seeded, and how to control each step.

## Local Development

For local development, the Prisma CLI provides useful tools:

```bash
cd packages/reference-implementation

# Visual database editor
pnpm prisma studio

# Create and apply a new migration
pnpm prisma migrate dev
```
