import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  ...(process.env.NEXT_PUBLIC_BASE_PATH && { basePath: process.env.NEXT_PUBLIC_BASE_PATH }),
  ...(process.env.NEXT_PUBLIC_ASSET_PREFIX && { assetPrefix: process.env.NEXT_PUBLIC_ASSET_PREFIX }),
  trailingSlash: false,
  output: 'standalone',
  eslint: {
    // Linting is handled by the root `yarn lint` step; skip during `next build`
    // to avoid path resolution issues in the monorepo workspace.
    ignoreDuringBuilds: true,
  },

  webpack: (config, { isServer }) => {
    config.module.rules.push({
      test: /\.hbs$/,
      use: 'raw-loader',
    });

    return config;
  },
};

export default nextConfig;
