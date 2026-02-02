import dotenv from "dotenv";
import path from "path";
import type { NextConfig } from 'next';

// Load .env from repository root
// Local dev: Loads environment variables from .env file
// Docker: Silently skips if file doesn't exist (vars already set by docker-compose)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const {
  RI_POSTGRES_USER,
  RI_POSTGRES_PASSWORD,
  RI_POSTGRES_DB,
  RI_POSTGRES_HOST,
  RI_POSTGRES_PORT,
  AUTH_KEYCLOAK_ISSUER,
  RI_APP_URL,
  DEFAULT_HUMAN_VERIFICATION_URL,
  DEFAULT_MACHINE_VERIFICATION_URL
} = process.env;

// Validate required environment variables
const requiredEnvVars = {
  RI_POSTGRES_USER,
  RI_POSTGRES_PASSWORD,
  RI_POSTGRES_DB,
  RI_POSTGRES_HOST,
  RI_POSTGRES_PORT,
  AUTH_KEYCLOAK_ISSUER,
  RI_APP_URL,
  DEFAULT_HUMAN_VERIFICATION_URL,
  DEFAULT_MACHINE_VERIFICATION_URL
};

const missingVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

// Skip validation during build phase (env vars are only available at runtime in Docker)
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
if (missingVars.length > 0 && !isBuildPhase) {
  throw new Error(
    `Missing required environment variables: ${missingVars.join(", ")}`
  );
}

// Construct the database URL from individual environment variables (use empty strings during build)
const databaseUrl = `postgresql://${RI_POSTGRES_USER || ''}:${RI_POSTGRES_PASSWORD || ''}@${RI_POSTGRES_HOST || ''}:${RI_POSTGRES_PORT || ''}/${RI_POSTGRES_DB || ''}?schema=public`;

// Set RI_DATABASE_URL for runtime access
process.env.RI_DATABASE_URL = databaseUrl;

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: false,
  transpilePackages: ['@mock-app/components'],
  env:{
    NEXT_PUBLIC_AUTH_KEYCLOAK_ISSUER: AUTH_KEYCLOAK_ISSUER || '',
    NEXT_PUBLIC_NEXTAUTH_URL: RI_APP_URL || '',
    NEXT_DEFAULT_HUMAN_VERIFICATION_URL: DEFAULT_HUMAN_VERIFICATION_URL || '',
    NEXT_DEFAULT_MACHINE_VERIFICATION_URL: DEFAULT_MACHINE_VERIFICATION_URL || ''
  }
};

export default nextConfig;
