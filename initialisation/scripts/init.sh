#!/bin/sh
set -e

echo "🚀 Initializing $ENVIRONMENT environment..."
echo ""

# 1. Generate Keycloak realm
echo "📝 Step 1: Generating Keycloak realm..."
CONFIG_FILE="/app/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Config file not found: $CONFIG_FILE"
    exit 1
fi

echo "   Using config: $CONFIG_FILE"
cd /app && node_modules/.bin/tsx provision-env.ts "$CONFIG_FILE"
echo ""

# 2. Verify realm file was created (or already exists)
REALM="${KEYCLOAK_REALM:-ri-${ENVIRONMENT}}"
REALM_FILE="/keycloak-realms/${REALM}.json"
if [ ! -f "$REALM_FILE" ]; then
    echo "ℹ️  Realm file not created - realm may already exist in Keycloak"
else
    echo "✅ Realm file ready: $REALM_FILE"
    echo "   File size: $(wc -c < "$REALM_FILE") bytes"
fi
echo ""

# 3. Wait for PostgreSQL (for future migration steps)
echo "⏳ Step 2: Waiting for PostgreSQL..."
until pg_isready -h ri-db -p ${POSTGRES_PORT} -U ${POSTGRES_USER} -d ${POSTGRES_DB} > /dev/null 2>&1; do
    echo -n "."
    sleep 1
done
echo " ✅ PostgreSQL ready"
echo ""

# 4. TODO: Database seeding
echo "📦 Step 3: Database seeding"
echo "   ⚠️  TODO: Implement database seeding"
echo "   - Seed initial application data"
echo "   - Create default organisations, users, and settings"
echo "   - This should be idempotent (safe to run multiple times)"
echo ""

echo "✅ Initialization complete!"
echo "   Keycloak can now import realm: ${REALM}"
