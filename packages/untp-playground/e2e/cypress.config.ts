import { defineConfig } from 'cypress';

const baseUrl = process.env.E2E_PLAYGROUND_BASE_URL || 'http://localhost:4000';

export default defineConfig({
  env: {
    PLAYGROUND_BASE_URL: baseUrl,
  },
  e2e: {
    baseUrl,
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    video: false,
    chromeWebSecurity: false,
    retries: {
      runMode: 2,
      openMode: 0,
    },
    defaultCommandTimeout: 10000,
    defaultBrowser: 'chrome',
  },
});
