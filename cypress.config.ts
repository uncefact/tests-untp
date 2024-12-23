import { defineConfig } from 'cypress';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
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
    defaultBrowser: "chrome",
    setupNodeEvents(on) {
      on('task', {
        writeToFile({ fileName, data }: { fileName: string; data: any }) {
          const filePath = path.resolve('cypress/fixtures/credentials-e2e', fileName);
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
          return null;
        },
        async runShellScript({ scriptPath }: { scriptPath: string }) {
          const absolutePath = path.resolve(process.cwd(), scriptPath);
          try {
            const { stdout } = await execPromise(`bash ${absolutePath}`);
            return stdout;
          } catch (error: any) {
            throw error;
          }
        }        
      });
    },
  },
});
