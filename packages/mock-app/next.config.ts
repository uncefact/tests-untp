import type { NextConfig } from 'next';

// Environment variables are validated at runtime in instrumentation.ts

const nextConfig: NextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@mock-app/components'],
  output: 'standalone',
  eslint: {
    // Run ESLint separately with `npm run lint` instead of during build
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
