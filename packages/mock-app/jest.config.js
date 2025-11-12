import base from '../../jest.config.base.js';
const jestConfig = {
  ...base,
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testMatch: [
    '**/__tests__/**/*.test.tsx',  // Old pattern: tests in __tests__ directories
    '**/src/**/*.test.tsx',         // New pattern: tests alongside components
  ],
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  transformIgnorePatterns: [
    'node_modules/(?!@mock-app)',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^jose$': '<rootDir>/src/__mocks__/jose.ts',
    '^next-auth/react$': '<rootDir>/src/__mocks__/next-auth/react.ts',
    '^react($|/.+)': '<rootDir>/../../node_modules/react$1',
    '^react-dom($|/.+)': '<rootDir>/../../node_modules/react-dom$1',
  },
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          jsx: 'react-jsx',
          module: 'esnext',
          target: 'ES2017',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          esModuleInterop: true,
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
        },
      },
    ],
  },
};

export default jestConfig;
