const { webpack } = require('webpack');

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
};
