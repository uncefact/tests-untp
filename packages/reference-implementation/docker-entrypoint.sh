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
else
    echo "Skipping database migrations (SKIP_MIGRATIONS is set)"
fi

# Execute the CMD (defaults to "node server.js" in production,
# overridden by docker-compose for E2E to include seeding)
cd /app
exec "$@"
