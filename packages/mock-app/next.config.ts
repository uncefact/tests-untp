import type { NextConfig } from 'next';

// Environment variables are validated at runtime in instrumentation.ts

const nextConfig: NextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@mock-app/components'],
  output: 'standalone'
};

export default nextConfig;
