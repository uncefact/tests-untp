module.exports = {
  testEnvironment: 'node', // or 'jsdom' for frontend
  testMatch: ['**/integration/**/*.js'], // or '**/integration/**/*.js' if your directory is named 'integration'
  setupFilesAfterEnv: ['./jest.setup.js'], // if you have a setup file
};
