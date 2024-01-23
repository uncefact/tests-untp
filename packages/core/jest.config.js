import { defaults } from 'jest-config';

const jestConfig = {
  rootDir: './',
  moduleFileExtensions: [...defaults.moduleFileExtensions, 'mts'],
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['**/__tests__/**/*.test.*'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
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
