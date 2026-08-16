#!/bin/sh
set -e

echo "Starting reference-implementation entrypoint..."

# Construct RI_DATABASE_URL from individual Postgres variables if not already set
if [ -z "$RI_DATABASE_URL" ] && [ -n "$RI_POSTGRES_HOST" ]; then
    RI_POSTGRES_USER="${RI_POSTGRES_USER:-postgres}"
    RI_POSTGRES_PASSWORD="${RI_POSTGRES_PASSWORD:-postgres}"
    RI_POSTGRES_DB="${RI_POSTGRES_DB:-ri}"
    RI_POSTGRES_PORT="${RI_POSTGRES_PORT:-5432}"
    export RI_DATABASE_URL="postgresql://${RI_POSTGRES_USER}:${RI_POSTGRES_PASSWORD}@${RI_POSTGRES_HOST}:${RI_POSTGRES_PORT}/${RI_POSTGRES_DB}"
    echo "Constructed RI_DATABASE_URL from individual Postgres variables"
fi

# Run database migrations if SKIP_MIGRATIONS is not set
if [ "${SKIP_MIGRATIONS:-false}" = "false" ]; then
    echo "Running database migrations..."
    cd /app/prisma
    node /app/node_modules/prisma/build/index.js migrate deploy --config=prisma.config.ts
    echo "Database migrations completed"

    # Run paired data backfills. Each backfill script is idempotent and
    # safe to rerun; together with the schema migrations they bring an
    # existing database fully in sync with the application's data
    # expectations. Keep this block ordered after migrate deploy so
    # column renames / adds have already landed by the time the
    # backfills run. This is an explicit ordered list, not a directory scan,
    # so a new file under backfills/ runs only once it is added here. Only
    # backfills whose writes can be turned back, and which paginate and take
    # no lock, belong here: under set -e a throw stops the container starting.
    # See docs/adrs/043-data-backfill-conventions.md.
    if [ "${SKIP_BACKFILLS:-false}" = "false" ]; then
        echo "Running database backfills..."
        cd /app/prisma
        /app/node_modules/.bin/tsx backfills/2026-05-19-hex-to-multibase.ts
        echo "Database backfills completed"
    else
        echo "Skipping database backfills (SKIP_BACKFILLS is set)"
    fi
else
    echo "Skipping database migrations (SKIP_MIGRATIONS is set)"
fi

# Run database seed (all operations are idempotent upserts)
if [ "${SKIP_SEED:-false}" = "false" ]; then
    echo "Running database seed..."
    cd /app/prisma
    # Run as the binary directly. Under pnpm, .bin/tsx is a shell
    # wrapper script that delegates into the .pnpm virtual store;
    # prefixing with `node` (as the previous yarn-1 invocation did)
    # makes node try to parse the shell script as JavaScript and
    # fail with "SyntaxError: missing ) after argument list".
    /app/node_modules/.bin/tsx seed.ts
    echo "Database seed completed"
else
    echo "Skipping database seed (SKIP_SEED is set)"
fi

cd /app
exec "$@"
