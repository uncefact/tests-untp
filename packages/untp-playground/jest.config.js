const { defaults } = require('jest-config');
const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  rootDir: './',
  moduleFileExtensions: [...defaults.moduleFileExtensions, 'mts'],
  collectCoverage: false,
  collectCoverageFrom: [
    '!**/infra/**',
    '!**/.next/**',
    '!**/types/**',
    '!**/build/**',
    '!**/node_modules/**',
    '!**/**/index.ts',
  ],
  coverageReporters: ['text', 'lcov', 'json', 'json-summary'],
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
  passWithNoTests: true, // TODO: remove this after adding tests
};
