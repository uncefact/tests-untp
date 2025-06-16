import base from '../../jest.config.base.js';
const jestConfig = {
  ...base,
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    '(.+)\\.js': '$1',
    '\\.(css|less)$': '<rootDir>/__mocks__/styleMock.js',
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
