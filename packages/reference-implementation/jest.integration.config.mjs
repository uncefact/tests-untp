import base from '../../jest.config.base.js';

/**
 * Integration-layer jest config (ADR-029; #900): real Postgres via the rig's
 * globalSetup, node environment, `*.integration.test.ts` only. Deliberately
 * NOT the unit config plus overrides: a `--testMatch` override cannot lift an
 * inherited `testPathIgnorePatterns`, and the unit config's module doubles
 * (jsdom setup, the truncated-digest stub) would silently weaken these
 * suites. Only the transform and workspace build mappings are shared; the
 * digest double here hashes the full payload (see rig/multibase-digest-stub.ts).
 */
const jestConfig = {
  ...base,
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['**/__tests__/integration/**/*.integration.test.ts'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  globalSetup: '<rootDir>/__tests__/integration/rig/global-setup.ts',
  globalTeardown: '<rootDir>/__tests__/integration/rig/global-teardown.ts',
  // Suites share one database; truncation between tests requires serial runs.
  maxWorkers: 1,
  testTimeout: 30_000,
  transformIgnorePatterns: ['node_modules/(?!@reference-implementation|uuid)'],
  moduleNameMapper: {
    // The untp-utils build reaches its multibase-digest module via relative
    // imports (bypassing the bare-specifier mapping below), and that module
    // imports `multiformats` subpath exports jest's resolver cannot unpack.
    // Both routes land on the same full-payload stub. Listed before the
    // generic `.js`-strip rule: first match wins.
    '^\\.{1,2}/multibase-digest(?:/index)?(?:\\.js)?$': '<rootDir>/__tests__/integration/rig/multibase-digest-stub.ts',
    // The resolver's SSRF guard refuses loopback; suites serve all documents
    // from a loopback fixture server, so the guard alone is swapped (the
    // stub re-exports the rest of the real node module untouched).
    '^\\.{1,2}/node(?:/index)?(?:\\.js)?$': '<rootDir>/__tests__/integration/rig/untp-utils-node-stub.ts',
    '^@uncefact/untp-utils/node$': '<rootDir>/__tests__/integration/rig/untp-utils-node-stub.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@uncefact/untp-ri-services/server$': '<rootDir>/../services/build/server.js',
    '^@uncefact/untp-ri-services/logging$': '<rootDir>/../services/build/logging/index.js',
    '^@uncefact/untp-ri-services/encryption$': '<rootDir>/../services/build/encryption/index.js',
    '^@uncefact/untp-ri-services/data-model-bridges$': '<rootDir>/../services/build/data-model-bridges/index.js',
    '^@uncefact/untp-ri-services/verifiable-credential$': '<rootDir>/../services/build/verifiable-credential/index.js',
    '^@uncefact/untp-ri-services/key-provider$': '<rootDir>/../services/build/key-provider/index.js',
    '^@uncefact/untp-ri-services/cvc$': '<rootDir>/../services/build/cvc/index.js',
    '^@uncefact/untp-ri-services$': '<rootDir>/../services/build/index.js',
    '^@uncefact/untp-utils/multibase-digest$': '<rootDir>/__tests__/integration/rig/multibase-digest-stub.ts',
    '^@uncefact/untp-utils/validation$': '<rootDir>/../untp-utils/build/validation/index.js',
    '^@uncefact/untp-utils/loaders$': '<rootDir>/../untp-utils/build/loaders/index.js',
    '^@uncefact/untp-utils/cache$': '<rootDir>/../untp-utils/build/cache/index.js',
    '^@uncefact/untp-utils/conformity-vocabulary$': '<rootDir>/../untp-utils/build/conformity-vocabulary/index.js',
    '^@uncefact/untp-utils$': '<rootDir>/../untp-utils/build/index.js',
  },
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'esnext',
          target: 'ES2022',
          lib: ['esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          esModuleInterop: true,
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          baseUrl: '.',
          paths: {
            '@uncefact/untp-ri-services': ['../services/build/index.d.ts'],
            '@uncefact/untp-ri-services/*': ['../services/build/*.d.ts'],
            '@/*': ['./src/*'],
          },
        },
      },
    ],
  },
};

export default jestConfig;
