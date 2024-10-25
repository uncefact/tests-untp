module.exports = {
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: ['<rootDir>/src/**/*.{ts,tsx}', '<rootDir>/src/**/*.{js,jsx}', '!**/*.d.ts'],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['json', 'json-summary', 'text', 'lcov'],
  verbose: true,
};
