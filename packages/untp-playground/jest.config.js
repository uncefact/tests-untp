/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

const config = {
  clearMocks: true,
  coverageReporters: ['text', 'lcov', 'json', 'json-summary'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^untp-test-suite-mocha$': '<rootDir>/../untp-test-suite-mocha/src/index.ts',
    '^lucide-react$': '<rootDir>/../../node_modules/lucide-react/dist/cjs/lucide-react.js',
    '^react$': '<rootDir>/../../node_modules/react',
    '^react-dom$': '<rootDir>/../../node_modules/react-dom',
    '^.+\\.hbs$': '<rootDir>/__tests__/mocks/handlebars.ts',
  },
  setupFiles: ['<rootDir>/jest.polyfills.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jsdom',
  testMatch: ['**/__tests__/**/*.(spec|test).[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '__tests__/mocks/*.ts'],
  modulePathIgnorePatterns: ['<rootDir>/build', '<rootDir>/dist', '<rootDir>/.next'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index',
    '!src/**/types',
    '!src/components/ui/**',
  ],
  transformIgnorePatterns: ['/node_modules/(?!lucide-react)'],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(config);
