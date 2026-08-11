import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'prisma/config';

import { databaseUrlFromEnvParts } from '../src/lib/prisma/database-url.js';

// Resolve the directory containing this file in ESM mode (the `prisma/`
// directory was scoped to ESM via `prisma/package.json` so the seed and
// backfill scripts can import `@uncefact/untp-utils/multibase-digest`).
// `__dirname` is a CJS-only global, so reconstruct it from `import.meta.url`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from repository root
// Local dev: Loads environment variables from .env file
// Docker: Silently skips if file doesn't exist (vars already set by docker-compose)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Honour a pre-set RI_DATABASE_URL; construct one from the RI_POSTGRES_*
// variables only when it is absent (the same rule as docker-entrypoint.sh
// and the backfill scripts), so an explicit URL is never silently retargeted
// by stale component variables (#766). Fail loudly when neither form of
// database target is available, since every Prisma command needs one.
const constructedDatabaseUrl = databaseUrlFromEnvParts();
if (!process.env.RI_DATABASE_URL && constructedDatabaseUrl) {
  process.env.RI_DATABASE_URL = constructedDatabaseUrl;
}
if (!process.env.RI_DATABASE_URL) {
  throw new Error(
    'No database target configured: set RI_DATABASE_URL, or all of RI_POSTGRES_USER, RI_POSTGRES_PASSWORD, RI_POSTGRES_DB, RI_POSTGRES_HOST and RI_POSTGRES_PORT',
  );
}

export default defineConfig({
  schema: './schema.prisma',
  migrations: {
    path: './migrations',
    seed: 'npx tsx seed.ts',
  },
});
