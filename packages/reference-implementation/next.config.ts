import dotenv from 'dotenv';
import path from 'path';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

import { databaseUrlFromEnvParts } from './src/lib/prisma/database-url';

// Load .env from repository root
// Local dev: Loads environment variables from .env file
// Docker: Silently skips if file doesn't exist (vars already set by docker-compose)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const nextConfig = (phase: string): NextConfig => {
  // Honour a pre-set RI_DATABASE_URL; construct one from the RI_POSTGRES_*
  // variables only when it is absent (the same rule as docker-entrypoint.sh,
  // prisma.config.ts, the seed, and the backfill scripts), so an explicit URL
  // is never silently retargeted by stale component variables (#766). Outside
  // the production build phase (where Docker supplies env at runtime), fail
  // loudly when neither form of database target is available.
  const constructedDatabaseUrl = databaseUrlFromEnvParts();
  if (!process.env.RI_DATABASE_URL && constructedDatabaseUrl) {
    process.env.RI_DATABASE_URL = constructedDatabaseUrl;
  }
  if (!process.env.RI_DATABASE_URL && phase !== PHASE_PRODUCTION_BUILD) {
    throw new Error(
      'No database target configured: set RI_DATABASE_URL, or all of RI_POSTGRES_USER, RI_POSTGRES_PASSWORD, RI_POSTGRES_DB, RI_POSTGRES_HOST and RI_POSTGRES_PORT',
    );
  }

  return {
    output: 'standalone',
    // Pin the standalone tracing root to the monorepo root. Without this,
    // Next.js infers the root from lockfile location, which silently moves
    // where `server.js` is emitted depending on the build environment.
    outputFileTracingRoot: path.resolve(__dirname, '../..'),
    reactStrictMode: false,
    eslint: { ignoreDuringBuilds: true },
    transpilePackages: ['@reference-implementation/components'],
  };
};

export default nextConfig;
