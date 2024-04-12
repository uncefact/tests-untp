export default {
  preset: 'ts-jest',
  testEnvironment: 'node', // or 'jsdom' for frontend
  testMatch: ['**/integration/**/*.integration.test.*'], // or '**/integration/**/*.js' if your directory is named 'integration',
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
