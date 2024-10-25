import { defaults } from 'jest-config';
import base from '../../jest.config.base.js';

export default {
  ...base,
  rootDir: './',
  moduleFileExtensions: [...defaults.moduleFileExtensions, 'mts'],
  collectCoverage: false,
  collectCoverageFrom: ['!**/examples/**', '!**/types/**', '!**/build/**', '!**/node_modules/**', '!**/**/index.ts'],
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
};
