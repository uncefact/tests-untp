export default {
  rootDir: './',
  collectCoverage: false,
  testMatch: [],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/'],
  passWithNoTests: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
};
