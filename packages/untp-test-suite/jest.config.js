import { defaults } from 'jest-config';

export default {
  rootDir: './',
  moduleFileExtensions: [...defaults.moduleFileExtensions, 'mts'],
  collectCoverage: false,
  collectCoverageFrom: ['!**/examples/**', '!**/types/**', '!**/build/**', '!**/node_modules/**', '!**/**/index.ts'],
  coverageReporters: ['text', 'lcov', 'json'],
  coverageProvider: 'v8',
  coverageDirectory: './coverage',
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['**/__tests__/**/*.test.*'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  automock: false,
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '\\.ts$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
};
