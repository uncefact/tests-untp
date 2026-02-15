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

            // Create or update test tenant
            await client.query(`
              INSERT INTO "Tenant" (id, name, "createdAt", "updatedAt")
              VALUES ('e2e-test-org', 'E2E Test Organisation', NOW(), NOW())
              ON CONFLICT (id) DO UPDATE SET "updatedAt" = NOW()
            `);

            // Link the user (created by NextAuth on first login) to the test tenant
            const result = await client.query(
              `UPDATE "User" SET "tenantId" = 'e2e-test-org', "updatedAt" = NOW()
               WHERE email = $1
               RETURNING id`,
              [userEmail],
            );

            if (result.rowCount === 0) {
              throw new Error(`User with email ${userEmail} not found. Has the user logged in?`);
            }

            return { tenantId: 'e2e-test-org', userId: result.rows[0].id };
          } finally {
            await client.end();
          }
        },
        async cleanupTestData({ tenantId }: { tenantId: string }) {
          const client = getDbClient();
          try {
            await client.connect();

            // Delete in dependency order (children first)
            await client.query(
              `DELETE FROM "LinkRegistration" WHERE "tenantId" = $1`,
              [tenantId],
            );
            await client.query(
              `DELETE FROM "Identifier" WHERE "tenantId" = $1`,
              [tenantId],
            );
            await client.query(
              `DELETE FROM "SchemeQualifier" WHERE "schemeId" IN (SELECT id FROM "IdentifierScheme" WHERE "tenantId" = $1)`,
              [tenantId],
            );
            await client.query(
              `DELETE FROM "IdentifierScheme" WHERE "tenantId" = $1`,
              [tenantId],
            );
            await client.query(
              `DELETE FROM "Registrar" WHERE "tenantId" = $1`,
              [tenantId],
            );
            await client.query(
              `DELETE FROM "Did" WHERE "tenantId" = $1`,
              [tenantId],
            );
            await client.query(
              `DELETE FROM "ServiceInstance" WHERE "tenantId" = $1`,
              [tenantId],
            );

            // Unlink users from test tenant (don't delete users - NextAuth owns them)
            await client.query(
              `UPDATE "User" SET "tenantId" = NULL WHERE "tenantId" = $1`,
              [tenantId],
            );

            // Delete test tenant
            await client.query(
              `DELETE FROM "Tenant" WHERE id = $1`,
              [tenantId],
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
