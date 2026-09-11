#!/bin/sh
set -eu

. "$(dirname "$0")/docker-entrypoint-role.sh"

# These assertions catch a missing first marker, an unknown marker, a worker
# path hidden in a web command, and maintenance dispatch by substring.
[ "$(derive_process_role --process-role=worker node --import tsx src/worker/main.ts)" = worker ]
[ "$(derive_process_role node --import tsx src/worker/main.ts)" = web ]
[ "$(derive_process_role node packages/reference-implementation/server.js src/worker/main.ts)" = web ]
if derive_process_role --process-role=web >/dev/null 2>&1; then
    exit 1
fi

is_maintenance_command node_modules/.bin/tsx scripts/audit-encryption.ts
is_maintenance_command node_modules/.bin/tsx scripts/backfill-decryption-keys.ts
is_maintenance_command node_modules/.bin/tsx scripts/backfill-credential-details.ts
is_maintenance_command node_modules/.bin/tsx scripts/rotate-encryption-key.ts
is_maintenance_command node_modules/.bin/tsx prisma/backfills/2026-05-19-hex-to-multibase.ts
is_maintenance_command pnpm audit:encryption
is_maintenance_command pnpm backfill:decryption-keys
is_maintenance_command pnpm backfill:credential-details
is_maintenance_command pnpm rotate:encryption-key
if is_maintenance_command node scripts/rotate-encryption-key.ts; then
    exit 1
fi
