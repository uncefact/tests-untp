import dotenv from 'dotenv';
import path from 'path';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

// Load .env from repository root
// Local dev: Loads environment variables from .env file
// Docker: Silently skips if file doesn't exist (vars already set by docker-compose)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const nextConfig = (phase: string): NextConfig => {
  const { RI_POSTGRES_USER, RI_POSTGRES_PASSWORD, RI_POSTGRES_DB, RI_POSTGRES_HOST, RI_POSTGRES_PORT } = process.env;

  // Validate required environment variables (skip during build phase for Docker)
  if (phase !== PHASE_PRODUCTION_BUILD) {
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
  }

  // Construct the database URL from individual environment variables
  const databaseUrl = `postgresql://${RI_POSTGRES_USER || ''}:${RI_POSTGRES_PASSWORD || ''}@${RI_POSTGRES_HOST || ''}:${
    RI_POSTGRES_PORT || ''
  }/${RI_POSTGRES_DB || ''}?schema=public`;

  // Set RI_DATABASE_URL for runtime access
  process.env.RI_DATABASE_URL = databaseUrl;

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
