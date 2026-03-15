import { exec } from 'child_process';
import { defineConfig } from 'cypress';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { Client, ClientOptions } from 'minio';
import pg from 'pg';
const { Client: PgClient } = pg;

// Load .env.e2e from the repo root (one level up from e2e/)
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env.e2e') });

const execPromise = util.promisify(exec);

function getDbClient() {
  const isRemoteDb = process.env.E2E_DB_HOST && process.env.E2E_DB_HOST !== 'localhost';
  const rejectUnauthorized = (process.env.E2E_DB_SSL_REJECT_UNAUTHORIZED ?? 'true') === 'true';
  return new PgClient({
    host: process.env.E2E_DB_HOST || 'localhost',
    port: parseInt(process.env.E2E_DB_PORT || '5433', 10),
    user: process.env.E2E_DB_USER || 'ri-postgres',
    password: process.env.E2E_DB_PASSWORD || 'ri-postgres',
    database: process.env.E2E_DB_NAME || 'ri',
    ssl: isRemoteDb ? { rejectUnauthorized } : undefined,
  });
}

// Cannot rely on Tenant cascade deletes — manual ordered deletes needed because:
// - Credential has no FK to Tenant (legacy schema, tenantId is a plain column)
// - Product self-reference is Restrict to prevent accidental orphaning of child products
// - Identifier → IdentifierScheme is Restrict to prevent deleting schemes still in use
async function deleteTenantData(client: any, tenantId: string, options?: { preserveTenant?: boolean }) {
  // Delete in dependency order (children first)

  // CVC tables (join table → profiles → schemes → catalogues → orphan criteria)
  await client.query(
    `DELETE FROM "ProfileCriterion" WHERE "profileId" IN (SELECT id FROM "ConformityProfile" WHERE "tenantId" = $1)`,
    [tenantId],
  );
  await client.query(
    `DELETE FROM "ConformityProfile" WHERE "tenantId" = $1`,
    [tenantId],
  );
  await client.query(
    `DELETE FROM "ConformityScheme" WHERE "tenantId" = $1`,
    [tenantId],
  );
  await client.query(
    `DELETE FROM "CvcCatalogue" WHERE "tenantId" = $1`,
    [tenantId],
  );
  await client.query(
    `DELETE FROM "Criterion" WHERE "tenantId" = $1`,
    [tenantId],
  );

  // Master data secondary identifier join tables
  await client.query(
    `DELETE FROM "ProductSecondaryIdentifier" WHERE "productId" IN (SELECT id FROM "Product" WHERE "tenantId" = $1)`,
    [tenantId],
  );
  await client.query(
    `DELETE FROM "FacilitySecondaryIdentifier" WHERE "facilityId" IN (SELECT id FROM "Facility" WHERE "tenantId" = $1)`,
    [tenantId],
  );
  await client.query(
    `DELETE FROM "OrganisationSecondaryIdentifier" WHERE "organisationId" IN (SELECT id FROM "OrganisationEntity" WHERE "tenantId" = $1)`,
    [tenantId],
  );

  // Master data entities (products have hierarchy — children first)
  await client.query(
    `DELETE FROM "Product" WHERE "tenantId" = $1 AND "parentId" IS NOT NULL`,
    [tenantId],
  );
  await client.query(
    `DELETE FROM "Product" WHERE "tenantId" = $1`,
    [tenantId],
  );
  await client.query(
    `DELETE FROM "Facility" WHERE "tenantId" = $1`,
    [tenantId],
  );
  await client.query(
    `DELETE FROM "OrganisationEntity" WHERE "tenantId" = $1`,
    [tenantId],
  );

  // Render templates (FK to DataModel)
  await client.query(
    `DELETE FROM "RenderTemplate" WHERE "tenantId" = $1`,
    [tenantId],
  );
  // Data model extensions (self-referencing — children first)
  await client.query(
    `DELETE FROM "DataModel" WHERE "tenantId" = $1 AND "parentConfigId" IS NOT NULL`,
    [tenantId],
  );
  await client.query(
    `DELETE FROM "DataModel" WHERE "tenantId" = $1`,
    [tenantId],
  );

  await client.query(
    `DELETE FROM "Credential" WHERE "tenantId" = $1`,
    [tenantId],
  );
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

  if (!options?.preserveTenant) {
    // Unlink users from tenant (don't delete users - NextAuth owns them)
    await client.query(
      `UPDATE "User" SET "tenantId" = NULL WHERE "tenantId" = $1`,
      [tenantId],
    );

    // Delete tenant
    await client.query(
      `DELETE FROM "Tenant" WHERE id = $1`,
      [tenantId],
    );
  }
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
    VERIFY_ALLOW_PRIVATE_URLS: (process.env.VERIFY_ALLOW_PRIVATE_URLS ?? process.env.CYPRESS_VERIFY_ALLOW_PRIVATE_URLS ?? 'true') === 'true',

    // Identity provider
    IDP_PROVIDER: process.env.E2E_IDP_PROVIDER || 'keycloak',
    IDP_BASE_URL: process.env.E2E_IDP_BASE_URL || 'http://localhost:8081',
    IDP_REALM: process.env.E2E_IDP_REALM || 'ri-e2e',
    IDP_CLIENT_ID: process.env.E2E_IDP_CLIENT_ID || 'ri-app-e2e',
    IDP_CLIENT_SECRET: process.env.E2E_IDP_CLIENT_SECRET || 'e2e-test-secret',
    IDP_AUDIENCE: process.env.E2E_IDP_AUDIENCE || '',

    // Test users
    USER_EMAIL: process.env.E2E_USER_EMAIL || 'e2e-admin@test.local',
    USER_PASSWORD: process.env.E2E_USER_PASSWORD || 'E2eTest123!',
    USER2_EMAIL: process.env.E2E_USER2_EMAIL || 'e2e-user@test.local',

    // Service accounts
    SA1_CLIENT_ID: process.env.E2E_SA1_CLIENT_ID || 'ri-service-account-e2e',
    SA1_CLIENT_SECRET: process.env.E2E_SA1_CLIENT_SECRET || 'e2e-service-account-secret',
    SA2_CLIENT_ID: process.env.E2E_SA2_CLIENT_ID || 'ri-service-account-e2e-2',
    SA2_CLIENT_SECRET: process.env.E2E_SA2_CLIENT_SECRET || 'e2e-service-account-secret-2',

    // RI-internal services
    VCKIT_BASE_URL: process.env.E2E_VCKIT_BASE_URL || 'http://vckit-api:3332',
    VCKIT_API_KEY: process.env.E2E_VCKIT_API_KEY || 'test123',
    STORAGE_BASE_URL: process.env.E2E_STORAGE_BASE_URL || 'http://storage-service:3334',
    STORAGE_API_KEY: process.env.E2E_STORAGE_API_KEY || 'test123',
    STORAGE_API_VERSION: process.env.E2E_STORAGE_API_VERSION || '3.1.0',
    STORAGE_PUBLIC_BUCKET: process.env.E2E_STORAGE_PUBLIC_BUCKET || 'public-data',
    STORAGE_PRIVATE_BUCKET: process.env.E2E_STORAGE_PRIVATE_BUCKET || 'private-data',

    // Test organisation
    TEST_ORG_ID: process.env.E2E_TEST_ORG_ID || 'e2e-test-org',

    // Tenant mode
    TENANT_MODE: process.env.E2E_TENANT_MODE || 'open',

    // Closed-mode groups
    GROUP_ALPHA: process.env.E2E_GROUP_ALPHA || '/e2e-org-alpha',
    GROUP_BETA: process.env.E2E_GROUP_BETA || '/e2e-org-beta',

    // Playground (optional)
    PLAYGROUND_BASE_URL: process.env.E2E_PLAYGROUND_BASE_URL || '',
  },
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:3003',
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    excludeSpecPattern: (process.env.E2E_TENANT_MODE || 'open') === 'closed'
      ? ['cypress/e2e/open_mode/**']
      : ['cypress/e2e/closed_mode/**'],
    video: false, // Disable video recording (optional)
    chromeWebSecurity: false, // Helps bypass security restrictions (if needed)
    retries: {
      runMode: 2, // Retries in headless mode
      openMode: 0, // No retries in interactive mode
    },
    defaultCommandTimeout: 10000,
    defaultBrowser: 'chrome',
    setupNodeEvents(on) {
      // Clean up all test artefacts after all specs complete
      on('after:run', async () => {
        const client = getDbClient();
        try {
          await client.connect();

          // Clean up human test users and their OAuth accounts
          const userEmail = process.env.E2E_USER_EMAIL || 'e2e-admin@test.local';
          const user2Email = process.env.E2E_USER2_EMAIL || 'e2e-user@test.local';
          for (const email of [userEmail, user2Email]) {
            await client.query(
              `DELETE FROM "Account" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`,
              [email],
            );
            await client.query(`DELETE FROM "User" WHERE email = $1`, [email]);
          }

          // Clean up orphaned Account records (Account exists but User was already deleted)
          await client.query(
            `DELETE FROM "Account" WHERE "userId" NOT IN (SELECT id FROM "User")`,
          );
        } catch {
          // Silently ignore — DB may not be reachable (e.g. local Docker already down)
        } finally {
          await client.end().catch(() => {});
        }
      });

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
          const tenantMode = process.env.E2E_TENANT_MODE || 'open';
          const client = getDbClient();
          try {
            await client.connect();

            if (tenantMode === 'closed') {
              // In closed mode, the tenant is auto-provisioned from the IDP group.
              // Find the user's existing tenant.
              const result = await client.query(
                `SELECT id, "tenantId" FROM "User" WHERE email = $1`,
                [userEmail],
              );

              if (result.rowCount === 0) {
                throw new Error(`User with email ${userEmail} not found. Has the user logged in?`);
              }

              const tenantId = result.rows[0].tenantId;
              if (!tenantId) {
                throw new Error(`User ${userEmail} has no tenant. In closed mode, the user must log in first to auto-provision a tenant.`);
              }

              // Clean existing test data so tests start fresh
              await deleteTenantData(client, tenantId, { preserveTenant: true });

              return { tenantId, userId: result.rows[0].id };
            }

            // Open mode: create or update test tenant
            const testOrgId = process.env.E2E_TEST_ORG_ID || 'e2e-test-org';
            await client.query(`
              INSERT INTO "Tenant" (id, name, "createdAt", "updatedAt")
              VALUES ($1, 'E2E Test Organisation', NOW(), NOW())
              ON CONFLICT (id) DO UPDATE SET "updatedAt" = NOW()
            `, [testOrgId]);

            const result = await client.query(
              `UPDATE "User" SET "tenantId" = $1, "updatedAt" = NOW()
               WHERE email = $2
               RETURNING id`,
              [testOrgId, userEmail],
            );

            if (result.rowCount === 0) {
              throw new Error(`User with email ${userEmail} not found. Has the user logged in?`);
            }

            return { tenantId: testOrgId, userId: result.rows[0].id };
          } finally {
            await client.end();
          }
        },
        async cleanupTestData({ tenantId, preserveTenant }: { tenantId: string; preserveTenant?: boolean }) {
          const client = getDbClient();
          try {
            await client.connect();
            await deleteTenantData(client, tenantId, { preserveTenant });
            return null;
          } finally {
            await client.end();
          }
        },
        async cleanupClosedModeData({ externalIdpGroupId }: { externalIdpGroupId: string }) {
          const client = getDbClient();
          try {
            await client.connect();

            // Find tenant by externalIdpGroupId
            const tenantResult = await client.query(
              `SELECT id FROM "Tenant" WHERE "externalIdpGroupId" = $1`,
              [externalIdpGroupId],
            );

            if (tenantResult.rowCount === 0) {
              return null;
            }

            const tenantId = tenantResult.rows[0].id;
            await deleteTenantData(client, tenantId);

            return { tenantId };
          } finally {
            await client.end();
          }
        },
        async verifyClosedModeTenant({ externalIdpGroupId }: { externalIdpGroupId: string }) {
          const client = getDbClient();
          try {
            await client.connect();

            const result = await client.query(
              `SELECT id, name, "externalIdpGroupId" FROM "Tenant" WHERE "externalIdpGroupId" = $1`,
              [externalIdpGroupId],
            );

            if (result.rowCount === 0) {
              return null;
            }

            return result.rows[0];
          } finally {
            await client.end();
          }
        },
        async verifyUsersShareTenant({ emails }: { emails: string[] }) {
          const client = getDbClient();
          try {
            await client.connect();

            const result = await client.query(
              `SELECT email, "tenantId" FROM "User" WHERE email = ANY($1)`,
              [emails],
            );

            if (result.rowCount === 0) {
              return { sameTenant: false, tenantId: null, externalIdpGroupId: null };
            }

            const tenantIds = new Set(result.rows.map((r: any) => r.tenantId).filter(Boolean));
            const sameTenant = tenantIds.size === 1;
            const tenantId = sameTenant ? result.rows[0].tenantId : null;

            let externalIdpGroupId = null;
            if (tenantId) {
              const tenantResult = await client.query(
                `SELECT "externalIdpGroupId" FROM "Tenant" WHERE id = $1`,
                [tenantId],
              );
              externalIdpGroupId = tenantResult.rows[0]?.externalIdpGroupId ?? null;
            }

            return { sameTenant, tenantId, externalIdpGroupId };
          } finally {
            await client.end();
          }
        },
        async getServiceAccountToken(options?: { clientId?: string; clientSecret?: string }) {
          const provider = process.env.E2E_IDP_PROVIDER || 'keycloak';
          const idpBaseUrl = process.env.E2E_IDP_BASE_URL || 'http://localhost:8081';
          const clientId = options?.clientId ?? (process.env.E2E_SA1_CLIENT_ID || 'ri-service-account-e2e');
          const clientSecret = options?.clientSecret ?? (process.env.E2E_SA1_CLIENT_SECRET || 'e2e-service-account-secret');

          let tokenUrl: string;
          let scope: string;

          if (provider === 'zitadel') {
            tokenUrl = `${idpBaseUrl}/oauth/v2/token`;
            const audience = process.env.E2E_IDP_AUDIENCE || '';
            scope = `openid urn:zitadel:iam:org:project:id:${audience}:aud urn:zitadel:iam:org:projects:roles`;
          } else {
            const realm = process.env.E2E_IDP_REALM || 'ri-e2e';
            tokenUrl = `${idpBaseUrl}/realms/${realm}/protocol/openid-connect/token`;
            scope = 'openid';
          }

          const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope,
          });

          const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to get service account token: ${response.status} ${text}`);
          }

          const data = await response.json();
          return { accessToken: data.access_token };
        },
        async cleanupServiceAccountData({ sub }: { sub: string }) {
          const client = getDbClient();
          try {
            await client.connect();

            // Find user by authProviderId (Keycloak sub claim)
            const userResult = await client.query(
              `SELECT id, "tenantId" FROM "User" WHERE "authProviderId" = $1`,
              [sub],
            );

            if (userResult.rowCount === 0) {
              return null;
            }

            const { id: userId, tenantId } = userResult.rows[0];

            if (tenantId) {
              await deleteTenantData(client, tenantId);
            }

            // Delete OAuth account links for this user
            await client.query(`DELETE FROM "Account" WHERE "userId" = $1`, [userId]);

            // Delete the auto-provisioned user itself
            await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);

            return { userId, tenantId };
          } finally {
            await client.end();
          }
        },
        async cleanupTestUsers({ emails }: { emails: string[] }) {
          const client = getDbClient();
          try {
            await client.connect();
            for (const email of emails) {
              // Delete OAuth account links
              await client.query(
                `DELETE FROM "Account" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`,
                [email],
              );
              // Delete user
              await client.query(
                `DELETE FROM "User" WHERE email = $1`,
                [email],
              );
            }
            return null;
          } finally {
            await client.end();
          }
        },
        async seedCvcCatalogue({ tenantId }: { tenantId: string }) {
          const client = getDbClient();
          await client.connect();
          try {
            await client.query('BEGIN');

            const now = new Date().toISOString();

            // Create catalogue
            const catResult = await client.query(
              `INSERT INTO "CvcCatalogue" (id, "canonicalId", name, "sourceUrl", "specVersion", "tenantId", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), 'https://example.com/e2e-cvc', 'E2E Test Catalogue', 'https://example.com/e2e-cvc', '0.7.0', $1, $2, $2)
               RETURNING id`,
              [tenantId, now],
            );
            const catalogueId = catResult.rows[0].id;

            // Create scheme
            const schemeResult = await client.query(
              `INSERT INTO "ConformityScheme" (id, "canonicalId", name, slug, description, "tenantId", "catalogueId", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), 'https://example.com/e2e-cvc/scheme-1', 'E2E Test Scheme', 'e2e-test-scheme', 'A test scheme for E2E', $1, $2, $3, $3)
               RETURNING id`,
              [tenantId, catalogueId, now],
            );
            const schemeId = schemeResult.rows[0].id;

            // Create profile
            const profileResult = await client.query(
              `INSERT INTO "ConformityProfile" (id, "canonicalId", name, slug, version, status, description, "tenantId", "schemeId", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), 'https://example.com/e2e-cvc/scheme-1/profile-1', 'E2E Test Profile', 'e2e-test-profile', '1.0.0', 'active', 'A test profile for E2E', $1, $2, $3, $3)
               RETURNING id`,
              [tenantId, schemeId, now],
            );
            const profileId = profileResult.rows[0].id;

            // Create two criteria
            const criterion1Result = await client.query(
              `INSERT INTO "Criterion" (id, "canonicalId", name, version, status, description, "conformityTopic", "tenantId", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), 'https://example.com/e2e-cvc/criterion-1', 'E2E Criterion Alpha', '1.0.0', 'active', 'First test criterion', 'environment.emissions', $1, $2, $2)
               RETURNING id`,
              [tenantId, now],
            );
            const criterion2Result = await client.query(
              `INSERT INTO "Criterion" (id, "canonicalId", name, version, status, description, "conformityTopic", "tenantId", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), 'https://example.com/e2e-cvc/criterion-2', 'E2E Criterion Beta', '1.0.0', 'active', 'Second test criterion', 'environment.water', $1, $2, $2)
               RETURNING id`,
              [tenantId, now],
            );
            const criterionId1 = criterion1Result.rows[0].id;
            const criterionId2 = criterion2Result.rows[0].id;

            // Link criteria to profile via join table
            await client.query(
              `INSERT INTO "ProfileCriterion" (id, "profileId", "criterionId")
               VALUES (gen_random_uuid(), $1, $2), (gen_random_uuid(), $1, $3)`,
              [profileId, criterionId1, criterionId2],
            );

            await client.query('COMMIT');
            return { catalogueId, schemeId, profileId, criterionIds: [criterionId1, criterionId2] };
          } catch (e) {
            await client.query('ROLLBACK');
            throw e;
          } finally {
            await client.end();
          }
        },
      });
    },
  },
});
