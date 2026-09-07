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
    '^lucide-react$': '<rootDir>/node_modules/lucide-react/dist/cjs/lucide-react.js',
    '^.+\\.hbs$': '<rootDir>/__tests__/mocks/handlebars.ts',
    // `@uncefact/untp-utils/resolvers` ships ESM-only and its
    // `resolve-document.js` pulls in `MultibaseDigest` via the relative
    // `../multibase-digest/index.js` specifier, which in turn imports
    // `multiformats` through subpath exports that declare only an `import`
    // condition. Neither is resolvable by this package's Jest CJS resolver
    // without a bigger toolchain change, so the `multibase-digest` public
    // subpath and the internal `../multibase-digest/index.js` specifier are
    // both redirected to a deterministic stub.
    // Production code consumes the real package; only tests see this stub.
    '^@uncefact/untp-utils/multibase-digest$': '<rootDir>/__tests__/mocks/multibase-digest.ts',
    '(^|/)multibase-digest/index\\.js$': '<rootDir>/__tests__/mocks/multibase-digest.ts',
  },
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
