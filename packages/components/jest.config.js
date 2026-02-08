import base from '../../jest.config.base.js';
const jestConfig = {
  ...base,
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: [
    '**/__tests__/**/*.test.tsx',  // Old pattern: tests in __tests__ directories
    '**/src/**/*.test.tsx',         // New pattern: tests alongside components
  ],
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    '(.+)\\.js': '$1',
    '\\.(css|less)$': '<rootDir>/__mocks__/styleMock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^react($|/.+)': '<rootDir>/../../node_modules/react$1',
    '^react-dom($|/.+)': '<rootDir>/../../node_modules/react-dom$1',
    '^@uncefact/untp-ri-services$': '<rootDir>/../services/src/index.ts',
  },
  transform: {
    '^.+\\.m?tsx?$': [
      'ts-jest',

      {
        useESM: true,
        tsconfig: './tsconfig.json',
      },
    ],
  },
};

export default jestConfig;
