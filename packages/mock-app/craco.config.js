const webpack = require('webpack');

module.exports = {
  jest: {
    configure: {
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      globals: {
        "ts-jest": {
          "useESM": true
        }
      },
      extensionsToTreatAsEsm: [
        ".ts"
      ],
      transform: {
        '^.+\\.ts?$': 'ts-jest',
        '^.+\\.tsx?$': 'ts-jest',
        '^.+\\.js?$': 'babel-jest',
        '^.+\\.jsx?$': 'babel-jest',
      },
      moduleNameMapper: {
        '^axios$': require.resolve('axios'),
        "(.+)\\.js": "$1"
      },
      setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
      collectCoverage: true,
      collectCoverageFrom: [
        'src/**/*.{ts,tsx}',
        '!src/**/*.d.ts',
        '!src/**/*.stories.{ts,tsx}',
        '!src/reportWebVitals.ts',
        '!src/setupTests.ts',
        '!src/index.tsx',
        '!src/**/*.test.{ts,tsx}',
        '!src/models/**/*.{ts,tsx}',
      ],
    },
  },
  babel: {
    presets: ['@babel/preset-react', '@babel/preset-env', '@babel/preset-typescript'],
    plugins: ['@babel/plugin-syntax-import-assertions'],
    loaderOptions: (babelLoaderOptions) => {
      return babelLoaderOptions;
    },
  },
  webpack: {
    configure: (webpackConfig) => {
      // Polyfill the missing modules
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        crypto: 'crypto-browserify',
        stream: 'stream-browserify',
        buffer: 'buffer',
        process: 'process/browser',
      };

      webpackConfig.plugins = [
        ...webpackConfig.plugins,
        new webpack.ProvidePlugin({
          process: 'process/browser',
          Buffer: ['buffer', 'Buffer'],
        }),
      ];

      // Add a rule to handle fully specified ESM imports without extensions
      webpackConfig.module.rules.push({
        test: /\.m?js/,
        resolve: {
          fullySpecified: false, // Allow imports without extensions
        },
      });

      return webpackConfig;
    },
  },
};
