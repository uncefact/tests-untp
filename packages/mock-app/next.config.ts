import dotenv from "dotenv";
import path from "path";
import type { NextConfig } from 'next';

// Load .env from repository root
// Local dev: Loads environment variables from .env file
// Docker: Silently skips if file doesn't exist (vars already set by docker-compose)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  reactStrictMode: false,
};

export default nextConfig;
