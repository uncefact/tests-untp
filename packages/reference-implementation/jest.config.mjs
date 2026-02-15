import base from '../../jest.config.base.js';
const jestConfig = {
  ...base,
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testMatch: [
    '**/__tests__/**/*.test.{ts,tsx}',  // Old pattern: tests in __tests__ directories
    '**/src/**/*.test.{ts,tsx}',         // New pattern: tests alongside components
  ],
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  transformIgnorePatterns: [
    'node_modules/(?!@reference-implementation)',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^jose$': '<rootDir>/src/__mocks__/jose.ts',
    '^next-auth/react$': '<rootDir>/src/__mocks__/next-auth/react.ts',
    '^react($|/.+)': '<rootDir>/../../node_modules/react$1',
    '^react-dom($|/.+)': '<rootDir>/../../node_modules/react-dom$1',
    '^@uncefact/untp-ri-services/server$': '<rootDir>/../services/build/server.js',
    '^@uncefact/untp-ri-services/logging$': '<rootDir>/../services/build/logging/index.js',
    '^@uncefact/untp-ri-services/encryption$': '<rootDir>/../services/build/encryption/index.js',
    '^@uncefact/untp-ri-services/key-provider$': '<rootDir>/../services/build/key-provider/index.js',
    '^@uncefact/untp-ri-services$': '<rootDir>/../services/build/index.js',
  },
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          jsx: 'react-jsx',
          module: 'esnext',
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

export default jestConfig;
