import { exec } from 'child_process';
import { defineConfig } from 'cypress';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { Client, ClientOptions } from 'minio';

const execPromise = util.promisify(exec);
export default defineConfig({
  env: {
    idrBucketName: process.env.OBJECT_STORAGE_BUCKET_NAME || 'idr-bucket-1',
    idrMinioConfig: {
      endPoint: process.env.APP_ENDPOINT || 'localhost',
      port: parseInt(process.env.OBJECT_STORAGE_PORT || '9000', 10),
      useSSL: process.env.OBJECT_STORAGE_USE_SSL === 'true',
      accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.OBJECT_STORAGE_SECRET_KEY || 'minioadmin',
    },
  },
  e2e: {
    baseUrl: 'http://localhost:4001', // Replace with your application's base URL
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}', // Specifies the test file pattern
    video: false, // Disable video recording (optional)
    chromeWebSecurity: false, // Helps bypass security restrictions (if needed)
    retries: {
      runMode: 2, // Retries in headless mode
      openMode: 0, // No retries in interactive mode
    },
    defaultCommandTimeout: 10000,
    defaultBrowser: 'chromium',
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
        async clearObjectStore({ bucketName, prefix, minioConfig }: { bucketName: string; prefix?: string; minioConfig: ClientOptions }) {
          try {
            if (!bucketName) {
              return {
                success: false,
                message: 'Bucket name is required.',
              }
            }

            const minioClient = new Client(minioConfig);
            const bucketExists = await minioClient.bucketExists(bucketName);
            if (!bucketExists) {
              return {
                success: false,
                message: `Bucket ${bucketName} does not exist.`,
              };
            }
    
            const objects: string[] = [];
            const bucketStream = minioClient.listObjectsV2(bucketName, prefix, true); // true for recursive
    
            // Collect all object names
            await new Promise<void>((resolve, reject) => {
              bucketStream.on('data', (obj) => obj.name && objects.push(obj.name));
              bucketStream.on('error', (err) => reject(err));
              bucketStream.on('end', () => resolve());
            });
    
            if (objects.length > 0) {
              await minioClient.removeObjects(bucketName, objects);
            }

            return { success: true };
          } catch (error) {
            console.log(error);
            throw error;
          }
        },
        async runUntpTest({ type, version, testData }) {
          const { testCredentialHandler } = await import('untp-test-suite/src/interfaces/lib/testSuiteHandler');
          const result = await testCredentialHandler({ type, version }, testData);

          return result;
        },
        deleteFile(filePath) {
          return new Promise((resolve, reject) => {
            fs.unlink(filePath, (err) => {
              if (err) {
                return reject(err);
              }
              resolve(null);
            });
          });
        },
      });
    },
  },
});
