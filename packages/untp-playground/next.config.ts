import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  ...(process.env.NEXT_PUBLIC_BASE_PATH && { basePath: process.env.NEXT_PUBLIC_BASE_PATH }),
  ...(process.env.NEXT_PUBLIC_ASSET_PREFIX && { assetPrefix: process.env.NEXT_PUBLIC_ASSET_PREFIX }),
  trailingSlash: false,
  output: 'standalone',

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Provide fallbacks for 'fs' and 'path' modules to prevent errors on the client side
      config.resolve.fallback = {
        fs: false,
        path: false,
      };
    }

    return config;
  },
};

export default nextConfig;
