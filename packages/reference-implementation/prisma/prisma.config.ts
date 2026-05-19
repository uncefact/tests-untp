import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'prisma/config';

// Resolve the directory containing this file in ESM mode (the `prisma/`
// directory was scoped to ESM via `prisma/package.json` so the seed and
// backfill scripts can import `@uncefact/untp-utils/multibase-digest`).
// `__dirname` is a CJS-only global, so reconstruct it from `import.meta.url`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from repository root
// Local dev: Loads environment variables from .env file
// Docker: Silently skips if file doesn't exist (vars already set by docker-compose)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { RI_POSTGRES_USER, RI_POSTGRES_PASSWORD, RI_POSTGRES_DB, RI_POSTGRES_HOST, RI_POSTGRES_PORT } = process.env;

// Validate required environment variables
const requiredEnvVars = {
  RI_POSTGRES_USER,
  RI_POSTGRES_PASSWORD,
  RI_POSTGRES_DB,
  RI_POSTGRES_HOST,
  RI_POSTGRES_PORT,
};

const missingVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// Construct the database URL from individual environment variables
const url = `postgresql://${RI_POSTGRES_USER}:${RI_POSTGRES_PASSWORD}@${RI_POSTGRES_HOST}:${RI_POSTGRES_PORT}/${RI_POSTGRES_DB}?schema=public`;

// Set RI_DATABASE_URL for Prisma schema to reference
process.env.RI_DATABASE_URL = url;

export default defineConfig({
  schema: './schema.prisma',
  migrations: {
    path: './migrations',
    seed: 'npx tsx seed.ts',
  },
});
