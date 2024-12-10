import base from '../../jest.config.base.js';
const jestConfig = {
  ...base,
  collectCoverageFrom: ['<rootDir>/tests/**/*.{ts,tsx}', '!**/*.d.ts', '!<rootDir>/tests/**/*.test.{ts,tsx}'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.test.ts'],
};

export default jestConfig;
