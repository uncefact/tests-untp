const base = require('../../jest.config.base');
module.exports = {
  ...base,
  collectCoverageFrom: ['<rootDir>/tests/**/*.{ts,tsx}', '!**/*.d.ts'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.test.ts'],
};
