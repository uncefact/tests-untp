import { exec } from 'child_process';
import { defineConfig } from 'cypress';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { Client, ClientOptions } from 'minio';
import pg from 'pg';
const { Client: PgClient } = pg;

const execPromise = util.promisify(exec);

function getDbClient() {
  return new PgClient({
    host: process.env.E2E_DB_HOST || 'localhost',
    port: parseInt(process.env.E2E_DB_PORT || '5433', 10),
    user: process.env.E2E_DB_USER || 'ri-postgres',
    password: process.env.E2E_DB_PASSWORD || 'ri-postgres',
    database: process.env.E2E_DB_NAME || 'ri',
  });
}

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
    baseUrl: 'http://localhost:3003', // Replace with your application's base URL
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}', // Specifies the test file pattern
    video: false, // Disable video recording (optional)
    chromeWebSecurity: false, // Helps bypass security restrictions (if needed)
    retries: {
      runMode: 2, // Retries in headless mode
      openMode: 0, // No retries in interactive mode
    },
    defaultCommandTimeout: 10000,
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
          } catch (error: any) {
            console.log('clearObjectStore skipped:', error?.message ?? error);
            return { success: false, message: error?.message ?? 'Unknown error' };
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
        async seedTestOrg({ userEmail }: { userEmail: string }) {
          const client = getDbClient();
          try {
            await client.connect();

            // Create or update test organisation
            await client.query(`
              INSERT INTO "Organization" (id, name, "createdAt", "updatedAt")
              VALUES ('e2e-test-org', 'E2E Test Organisation', NOW(), NOW())
              ON CONFLICT (id) DO UPDATE SET "updatedAt" = NOW()
            `);

            // Link the user (created by NextAuth on first login) to the test org
            const result = await client.query(
              `UPDATE "User" SET "organizationId" = 'e2e-test-org', "updatedAt" = NOW()
               WHERE email = $1
               RETURNING id`,
              [userEmail],
            );

            if (result.rowCount === 0) {
              throw new Error(`User with email ${userEmail} not found. Has the user logged in?`);
            }

            return { organizationId: 'e2e-test-org', userId: result.rows[0].id };
          } finally {
            await client.end();
          }
        },
        async cleanupTestData({ organizationId }: { organizationId: string }) {
          const client = getDbClient();
          try {
            await client.connect();

            // Delete test DIDs (cascade from org)
            await client.query(
              `DELETE FROM "Did" WHERE "organizationId" = $1`,
              [organizationId],
            );

            // Delete test service instances
            await client.query(
              `DELETE FROM "ServiceInstance" WHERE "organizationId" = $1`,
              [organizationId],
            );

            // Unlink users from test org (don't delete users - NextAuth owns them)
            await client.query(
              `UPDATE "User" SET "organizationId" = NULL WHERE "organizationId" = $1`,
              [organizationId],
            );

            // Delete test organisation
            await client.query(
              `DELETE FROM "Organization" WHERE id = $1`,
              [organizationId],
            );

            return null;
          } finally {
            await client.end();
          }
        },
      });
    },
  },
});
