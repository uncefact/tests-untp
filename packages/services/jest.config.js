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
    '(.+)\\.js': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
};

export default jestConfig;
