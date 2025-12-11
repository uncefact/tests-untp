/* eslint-disable @typescript-eslint/no-require-imports */
const base = require('../../jest.config.base.js');

const jestConfig = {
  ...base,
  rootDir: '.',
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testMatch: [
    '**/__tests__/**/*.test.tsx',  // Old pattern: tests in __tests__ directories
    '**/src/**/*.test.tsx',         // New pattern: tests alongside components
  ],
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  transformIgnorePatterns: [
    'node_modules/(?!@mock-app)',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',

    // General alias for mock-app's root
    '^@/(.*)$': '<rootDir>/src/$1',

    // Mocks and external packages
    '^jose$': '<rootDir>/src/__mocks__/jose.ts',
    '^next-auth/react$': '<rootDir>/src/__mocks__/next-auth/react.ts',
    '^react($|/.+)': '<rootDir>/../../node_modules/react$1',
    '^react-dom($|/.+)': '<rootDir>/../../node_modules/react-dom$1',
  },
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          target: 'ES2017',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          esModuleInterop: true,
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
        },
      },
    ],
  },
};

module.exports = jestConfig;
