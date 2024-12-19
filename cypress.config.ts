import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3003', // Replace with your application's base URL
    supportFile: false, // Disable the default support file if not needed
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}', // Specifies the test file pattern
    video: false, // Disable video recording (optional)
    chromeWebSecurity: false, // Helps bypass security restrictions (if needed)
    retries: {
      runMode: 2, // Retries in headless mode
      openMode: 0, // No retries in interactive mode
    },
    defaultCommandTimeout: 4000,
    defaultBrowser: "chrome"
  },
});
