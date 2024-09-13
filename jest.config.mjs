import { defaults } from 'jest-config';
import ComponentPkg from './packages/components/package.json' assert { type: 'json' };
import MockAppPkg from './packages/mock-app/package.json' assert { type: 'json' };

export default {
  rootDir: './',
  moduleFileExtensions: [...defaults.moduleFileExtensions, 'mts'],
  collectCoverage: false,
  collectCoverageFrom: [
    'packages/**/src/**/*.ts',
    '!**/examples/**',
    '!**/types/**',
    '!**/build/**',
    '!**/node_modules/**',
    '!packages/services/src/identityProviders/GS1Provider.ts' // This file call a function that is not exported
  ],
  coverageReporters: ['text', 'lcov', 'json'],
  coverageProvider: 'v8',
  coverageDirectory: './coverage',
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['**/__tests__/**/*.test.*'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/', 
  ],
  testEnvironment: 'node',
  automock: false,
  extensionsToTreatAsEsm: ['.ts'],
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      setupFilesAfterEnv: ['<rootDir>/packages/components/src/setupTests.ts'],
      displayName: ComponentPkg.name,
      testMatch: ['<rootDir>/packages/components/**/?(*.)+(spec|test).[jt]s?(x)'],
      transform: {
        '^.+\\.m?tsx?$': [
          'ts-jest',
          {
            useESM: true,
            tsconfig: '<rootDir>/packages/components/tsconfig.json',
          },
        ],
      },
    },
    {
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      setupFilesAfterEnv: ['<rootDir>/packages/mock-app/jest.config.js'],
      displayName: MockAppPkg.name,
      testMatch: ['<rootDir>/packages/mock-app/jest.config.js'],
      transform: {
      '^.+\\.m?tsx?$': [
        'ts-jest',
        {
          useESM: true,
          tsconfig: '<rootDir>/packages/mock-app/tsconfig.json',
        },
      ],
    },
    },
     {
      // Default Node.js environment tests for all other packages
      preset: 'ts-jest',
      displayName: 'Node.js environment',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/packages/**/src/**/?(*.)+(spec|test).[jt]s?(x)'],
      testPathIgnorePatterns: [
        '<rootDir>/node_modules/', 
        '<rootDir>/packages/components', 
        '<rootDir>/packages/mock-app', 
        '<rootDir>/packages/services/src/__tests__/gs1.test.ts' // This file call a library that is not exported, so it is ignored
      ],
      transform: {
        '^.+\\.m?tsx?$': [
          'ts-jest',
          {
            useESM: true,
            tsconfig: '<rootDir>/packages/tsconfig.settings.json',
          },
        ],
      },
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      }
    },
  ],
};
