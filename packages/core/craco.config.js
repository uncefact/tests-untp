const webpack = require('webpack');

module.exports = {
  jest: {
    configure: {
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      transform: {
        '^.+\\.ts?$': 'ts-jest',
        '^.+\\.tsx?$': 'ts-jest',
        '^.+\\.js?$': 'babel-jest',
        '^.+\\.jsx?$': 'babel-jest',
      },
      moduleNameMapper: {
        '^axios$': require.resolve('axios'),
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
        '!src/pages/Verify.tsx',
      ],
      watchPlugins: ['jest-watch-typeahead/filename', 'jest-watch-typeahead/testname'],
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
    configure: (webpackConfig, { env, paths }) => {
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        fs: false,
      };
      /* ... */
      return webpackConfig;
    },
    plugins: [
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
    ],
  },
};
