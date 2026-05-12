import base from '../../jest.config.base.js';

const jestConfig = {
  ...base,
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/build/'],
  transform: {
    '\\.[jt]sx?$': 'ts-jest',
  },
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  moduleNameMapper: {
    '(.+)\\.js': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
};

export default jestConfig;
