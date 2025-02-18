import { exec } from 'child_process';
import { defineConfig } from 'cypress';
import fs from 'fs';
import path from 'path';
import util from 'util';

const execPromise = util.promisify(exec);
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3003', // Replace with your application's base URL
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}', // Specifies the test file pattern
    video: false, // Disable video recording (optional)
    chromeWebSecurity: false, // Helps bypass security restrictions (if needed)
    retries: {
      runMode: 2, // Retries in headless mode
      openMode: 0, // No retries in interactive mode
    },
    defaultCommandTimeout: 4000,
    defaultBrowser: 'chrome',
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
        },
        resetData(file?: string) {

          const targetDir = path.resolve(
            process.cwd(),
            `../minio_data/identity-resolver-service-object-store/data-test/idr-bucket-1/gs1${file ? `/${file}` : ''}`
          );

          if (fs.existsSync(targetDir)) {
            console.log(`Found folder: ${targetDir}`);
            console.log('Deleting folder...');

            fs.rmdirSync(targetDir, { recursive: true });

            if (!fs.existsSync(targetDir)) {
              console.log('Folder deleted successfully.');
              return { success: true };
            } else {
              console.log('Failed to delete the folder.');
              return { success: false };
            }
          } else {
            console.log(`Folder not found: ${targetDir}`);
            return { success: true };
          }
        },
        async runUntpTest({ type, version, testData }) {
          const { testCredentialHandler } = await import('untp-test-suite/src/interfaces/lib/testSuiteHandler');
          const result = await testCredentialHandler({ type, version }, testData);

          return result;
        },
      });
    },
  },
});
