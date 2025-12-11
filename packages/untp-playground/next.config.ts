import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: true,
  ...(process.env.NEXT_PUBLIC_BASE_PATH && { basePath: process.env.NEXT_PUBLIC_BASE_PATH }),
  ...(process.env.NEXT_PUBLIC_ASSET_PREFIX && { assetPrefix: process.env.NEXT_PUBLIC_ASSET_PREFIX }),
  trailingSlash: false,
  output: 'standalone',

  webpack: (config, { isServer }) => {
    // Ensure Handlebars templates are loaded as raw strings
    config.module.rules.push({
      test: /\.hbs$/,
      use: 'raw-loader',
    });

    // Add aliases / fallbacks for browser environment
    config.resolve.alias = {
      ...config.resolve.alias,
      'rdf-canonize-native': false,
    };

    // Provide polyfills for Buffer and process in the browser
    config.plugins.push(
      new (require('webpack').ProvidePlugin)({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser',
      })
    );

    // Emit proper client-side source maps to help browser debugging.
    // Only set devtool for client bundles to avoid interfering with server build.
    if (!isServer) {
      config.devtool = 'source-map';
    }

    // Suppress the specific critical dependency warning emitted by some CommonJS modules
    // (e.g., dynamic `require()` usage in componentsjs) so that builds remain clean while
    // still producing source maps for debugging.
    // Webpack 5 supports `ignoreWarnings` which can accept regexes or functions.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      // Filter by the exact warning message pattern
      /require function is used in a way in which dependencies cannot be statically extracted/,
      /require.extensions is not supported by webpack. Use a loader instead./,
      // The "Critical dependency: the request of a dependency is an expression" warning arises because Webpack
      // encounters yargs (a transitive dependency of @comunica) making dynamic require() calls, where the module
      // path isn't a static string. Webpack's static analysis struggles with such expressions, as it cannot
      // determine all possible dependencies at build time.
      /Critical dependency: the request of a dependency is an expression/,
    ];

    return config;
  },
};

export default nextConfig;
