#!/bin/sh
set -e

CONFIG_MOUNT_PATH="${CONFIG_MOUNT_PATH:-/config/app-config.json}"
CONFIG_DEST_PATH="${CONFIG_DEST_PATH:-/app/config/app-config.json}"

echo "Starting mock-app entrypoint..."

# Copy configuration file from mounted volume if it exists
if [ -f "$CONFIG_MOUNT_PATH" ]; then
    echo "Found configuration file at $CONFIG_MOUNT_PATH"
    mkdir -p "$(dirname "$CONFIG_DEST_PATH")"
    cp "$CONFIG_MOUNT_PATH" "$CONFIG_DEST_PATH"
    echo "Configuration copied to $CONFIG_DEST_PATH"
else
    echo "No configuration file found at $CONFIG_MOUNT_PATH, using built-in configuration"
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

# Start the application
echo "Starting Next.js server..."
cd /app
exec node server.js
