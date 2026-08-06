import base from '../../jest.config.base.js';
const jestConfig = {
  ...base,
  testEnvironment: 'jsdom',
  testPathIgnorePatterns: ['/node_modules/', '/build/', '/__tests__/mocks/'],
  transform: {
    '\\.[jt]sx?$': 'ts-jest',
  },
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  moduleNameMapper: {
    // `@uncefact/untp-utils` ships ESM-only and pulls in `multiformats` via
    // subpath exports, neither of which Jest's CJS resolver in this package
    // can untangle. Production code consumes the real module from npm; tests
    // mock it per-file via jest.mock. This shim avoids Jest crashing during
    // module resolution when an adapter that depends on untp-utils is loaded.
    '^@uncefact/untp-utils/multibase-digest$': '<rootDir>/__tests__/mocks/multibase-digest.ts',
    '^@uncefact/untp-utils/resolvers$': '<rootDir>/../untp-utils/build/resolvers/index.js',
    '^@uncefact/untp-utils/validation$': '<rootDir>/../untp-utils/build/validation/index.js',
    '^@uncefact/untp-utils/conformity-vocabulary$': '<rootDir>/../untp-utils/build/conformity-vocabulary/index.js',
    '^@uncefact/untp-utils$': '<rootDir>/../untp-utils/build/index.js',
    // Strips the `.js` extension this package's ESM-style relative imports
    // use (e.g. `./utils/validate-public-url.js`) so Jest's CJS resolver
    // finds the `.ts` source. Anchored to relative-path specifiers only: an
    // unanchored pattern also matches bare package specifiers that happen to
    // end in `.js` (e.g. the `ipaddr.js` npm package), mangling them into an
    // unresolvable module name.
    '^(\\.{1,2}/.+)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
};

export default jestConfig;
