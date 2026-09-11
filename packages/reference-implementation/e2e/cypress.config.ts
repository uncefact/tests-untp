import { exec } from 'child_process';
import { defineConfig } from 'cypress';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { Client, ClientOptions } from 'minio';
import pg from 'pg';
import { readFetchAllowPrivateUrlsIfSet } from '../src/lib/config/credential-fetch.config';
import {
  cleanupRunData,
  findTaggedRows,
  type CleanupActor,
  type CleanupFailure,
  type CleanupOptions,
} from './cypress/support/cleanup';
const { Client: PgClient } = pg;

// Load .env.e2e from this e2e workspace's root.
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env.e2e') });

// The repository-root `.env` is the file Compose interpolates when it starts
// the app container, so the harness reads it too rather than deriving its
// capability key from a narrower view of the settings than the app under test.
// It is parsed, never applied to `process.env`, so nothing else in this
// process picks up a deployment value by accident.
function parseRepositoryRootEnv(): Record<string, string | undefined> {
  const rootEnvPath = path.resolve(__dirname, '../../../.env');
  if (!fs.existsSync(rootEnvPath)) return {};
  return dotenv.parse(fs.readFileSync(rootEnvPath));
}

// Ascending precedence: the repository-root `.env`, then `.env.e2e` and the
// host environment, which `dotenv.config` above has already merged into
// `process.env` with the host winning.
const harnessEnv: Record<string, string | undefined> = {
  ...parseRepositoryRootEnv(),
  ...process.env,
};

const APPLICATION_PRIVATE_URL_NAMES = ['FETCH_ALLOW_PRIVATE_URLS', 'VERIFY_ALLOW_PRIVATE_URLS'] as const;

// The environment files are read with `dotenv.parse`, which returns each value
// exactly as written. Compose, which interpolates the same root `.env` when it
// starts the app container, does expand `${VAR:-default}` and `$VAR`. An
// expression left in one of the two private-address names would therefore give
// the harness a different answer from the application it is testing, so the
// harness refuses it rather than guessing. A single-quoted expression is a
// literal to Compose, but `dotenv.parse` strips the quotation marks, so a
// parsed value cannot tell the two apart; the message says the form is
// unsupported here and does not claim Compose would expand it. Only these two
// names are inspected, and the check runs on the effective value, so a host
// literal shadowing a root expression passes.
function refuseExpressionsInPrivateUrlNames(env: Record<string, string | undefined>): void {
  for (const name of APPLICATION_PRIVATE_URL_NAMES) {
    const value = env[name];
    if (value === undefined || !value.includes('$')) continue;
    throw new Error(
      `${name} contains a '$' character. The e2e harness reads the environment files literally and does not support shell or Compose expressions (\${VAR:-default}, $VAR) in FETCH_ALLOW_PRIVATE_URLS or VERIFY_ALLOW_PRIVATE_URLS. Write a literal value in the file, or export the literal ${name} in the shell that runs Cypress, which takes precedence over the files.`,
    );
  }
}

refuseExpressionsInPrivateUrlNames(harnessEnv);

// `readFetchAllowPrivateUrlsIfSet` gives the application's own answer when
// either application name is supplied, applying its presence, conflict and
// parsing rules, and `undefined` when neither is. The fallback below and its
// `true` default are the harness's own: they exist because
// `docker-compose.e2e.yml` runs the stack on private container addresses, and
// they never influence the application.
// A both-names conflict throws while this file evaluates, which fails every
// spec's load deliberately, because the application refuses the same
// environment.
// This derivation only seeds the initial `env.VERIFY_ALLOW_PRIVATE_URLS`.
// Cypress then merges its own inputs over that key (`cypress.env.json`,
// `CYPRESS_`- and `cypress_`-prefixed process variables, `--env`) before it
// calls `setupNodeEvents`, so the callback below is the only place that sees
// the value the specs will read, and that is where the agreement check lives.
const harnessAllowsPrivateUrls =
  readFetchAllowPrivateUrlsIfSet(harnessEnv) ?? (harnessEnv.CYPRESS_VERIFY_ALLOW_PRIVATE_URLS ?? 'true') === 'true';

/**
 * Refuses a run whose resolved capability key disagrees with the application
 * setting the operator supplied. Agreement means the same boolean, identical
 * in type, because the specs read the key with a plain truthiness test and a
 * string such as `'false'` would silently pass it. When neither application
 * name is set there is nothing to disagree with, and the operator may declare a
 * remote instance's capability through any Cypress input, so no comparison is
 * made. The message names the sources rather than the values, because the
 * disagreement is about which input should be believed.
 */
function requireResolvedKeyToMatchApplicationSetting(resolvedValue: unknown): void {
  const applicationSetting = readFetchAllowPrivateUrlsIfSet(harnessEnv);
  if (applicationSetting === undefined) return;
  if (resolvedValue === applicationSetting) return;
  throw new Error(
    'The harness capability key VERIFY_ALLOW_PRIVATE_URLS was overridden after the Cypress config file computed it from the application setting (FETCH_ALLOW_PRIVATE_URLS or VERIFY_ALLOW_PRIVATE_URLS). Cypress merges cypress.env.json, CYPRESS_ or cypress_ prefixed process variables and --env over the config file, and one of those supplied a different value. Remove the override, or make it the same boolean as the application setting.',
  );
}

const execPromise = util.promisify(exec);

const E2E_DB_ACCESS = (process.env.E2E_DB_ACCESS ?? 'false') === 'true';
// The compose stack imports the e2e realm fixture; a deployed instance's own
// identity provider has no such clients or groups, so realm-bound cases skip.
const E2E_IDP_E2E_REALM = (process.env.E2E_IDP_E2E_REALM ?? 'true') === 'true';
const RUN_ID = process.env.E2E_RUN_ID ?? `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
if (!/^\d{10,}$/.test(RUN_ID)) {
  throw new Error('E2E_RUN_ID must be numeric and contain at least 10 digits.');
}
const RUN_TAG = `e2e-${RUN_ID}`;
const RESIDUE_POLICY = process.env.E2E_RESIDUE_POLICY ?? 'fail';
if (RESIDUE_POLICY !== 'fail' && RESIDUE_POLICY !== 'clean') {
  throw new Error(`E2E_RESIDUE_POLICY must be either fail or clean, received ${RESIDUE_POLICY}.`);
}

const registeredActors = new Map<string, CleanupActor>();
const serviceAccountSubjects = new Map<string, string>();
const testTenantIds = new Set<string>();
let residueChecked = false;

function recordActor(actor: CleanupActor): void {
  registeredActors.set(actor.name, actor);
}

function actorNameForClient(clientId: string): string {
  const sa2ClientId = process.env.E2E_SA2_CLIENT_ID || 'ri-service-account-e2e-2';
  return clientId === sa2ClientId ? 'service-account-2' : 'service-account-1';
}

function tokenSubject(accessToken: string): string {
  const encodedPayload = accessToken.split('.')[1];
  if (!encodedPayload) throw new Error('Service account token had no JWT payload for cleanup.');
  const payload = JSON.parse(
    Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
  ) as {
    sub?: unknown;
  };
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Service account token had no subject claim for cleanup.');
  }
  return payload.sub;
}

async function requestServiceAccountToken(options?: { clientId?: string; clientSecret?: string }) {
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

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error(`Service account token response for ${clientId} had no access_token.`);
  const actor = actorNameForClient(clientId);
  recordActor({ name: actor, headers: { Authorization: `Bearer ${data.access_token}` } });
  serviceAccountSubjects.set(actor, tokenSubject(data.access_token));
  return { accessToken: data.access_token };
}

async function ensureServiceAccountActors(): Promise<void> {
  const clients = [
    {
      clientId: process.env.E2E_SA1_CLIENT_ID || 'ri-service-account-e2e',
      clientSecret: process.env.E2E_SA1_CLIENT_SECRET || 'e2e-service-account-secret',
    },
    {
      clientId: process.env.E2E_SA2_CLIENT_ID || 'ri-service-account-e2e-2',
      clientSecret: process.env.E2E_SA2_CLIENT_SECRET || 'e2e-service-account-secret-2',
    },
  ];
  for (const client of clients) {
    if (!registeredActors.has(actorNameForClient(client.clientId))) await requestServiceAccountToken(client);
  }
}

function formatCleanupFailures(failures: CleanupFailure[]): string[] {
  return failures.map(({ actor, collection, message }) => `${actor}/${collection}: ${message}`);
}

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

// Cannot rely on Tenant cascade deletes. Manual ordered deletes are needed because:
// - Credential has no FK to Tenant (legacy schema, tenantId is a plain column)
// - Product self-reference is Restrict to prevent accidental orphaning of child products
// - Identifier → IdentifierScheme is Restrict to prevent deleting schemes still in use
async function deleteTenantData(client: any, tenantId: string, options?: { preserveTenant?: boolean }) {
  // Delete in dependency order (children first)

  // CVC tables (join table → profiles → schemes → orphan criteria)
  await client.query(
    `DELETE FROM "ConformityProfileCriterion" WHERE "profileId" IN (SELECT id FROM "ConformityProfile" WHERE "tenantId" = $1)`,
    [tenantId],
  );
  await client.query(`DELETE FROM "ConformityProfile" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "ConformityScheme" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "ConformityCriterion" WHERE "tenantId" = $1`, [tenantId]);

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

  // Master data entities. Products have a hierarchy, so delete children first.
  await client.query(`DELETE FROM "Product" WHERE "tenantId" = $1 AND "parentId" IS NOT NULL`, [tenantId]);
  await client.query(`DELETE FROM "Product" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "Facility" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "OrganisationEntity" WHERE "tenantId" = $1`, [tenantId]);

  // Render templates (FK to DataModel)
  await client.query(`DELETE FROM "RenderTemplate" WHERE "tenantId" = $1`, [tenantId]);
  // Data model extensions. These are self-referencing, so delete children first.
  await client.query(`DELETE FROM "DataModel" WHERE "tenantId" = $1 AND "parentConfigId" IS NOT NULL`, [tenantId]);
  await client.query(`DELETE FROM "DataModel" WHERE "tenantId" = $1`, [tenantId]);

  // A credential is a child of its library record and the database refuses a
  // direct child delete; deleting the parent cascades to the child, its
  // check runs and its idempotency claim.
  await client.query(`DELETE FROM "LibraryRecord" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "LinkRegistration" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "Identifier" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(
    `DELETE FROM "SchemeQualifier" WHERE "schemeId" IN (SELECT id FROM "IdentifierScheme" WHERE "tenantId" = $1)`,
    [tenantId],
  );
  await client.query(`DELETE FROM "IdentifierScheme" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "Registrar" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "Did" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "ServiceInstance" WHERE "tenantId" = $1`, [tenantId]);

  if (!options?.preserveTenant) {
    // Unlink users from tenant (don't delete users - NextAuth owns them)
    await client.query(`UPDATE "User" SET "tenantId" = NULL WHERE "tenantId" = $1`, [tenantId]);

    // Delete tenant
    await client.query(`DELETE FROM "Tenant" WHERE id = $1`, [tenantId]);
  }
}

async function deleteTaggedTenantData(client: any, tenantId: string, tag: string): Promise<void> {
  const tagPattern = `%${tag}%`;

  await client.query(`DELETE FROM "ConformityProfileCriterion" WHERE id LIKE $1`, [tagPattern]);
  await client.query(
    `DELETE FROM "ConformityProfile" WHERE "tenantId" = $1 AND (id LIKE $2 OR "canonicalId" LIKE $2 OR name LIKE $2)`,
    [tenantId, tagPattern],
  );
  await client.query(
    `DELETE FROM "ConformityScheme" WHERE "tenantId" = $1 AND (id LIKE $2 OR "canonicalId" LIKE $2 OR name LIKE $2)`,
    [tenantId, tagPattern],
  );
  await client.query(
    `DELETE FROM "ConformityCriterion" WHERE "tenantId" = $1 AND (id LIKE $2 OR "canonicalId" LIKE $2 OR name LIKE $2)`,
    [tenantId, tagPattern],
  );

  await client.query(
    `DELETE FROM "LibraryRecord"
     WHERE "tenantId" = $1
       AND (id LIKE $2 OR name LIKE $2 OR "issuerName" LIKE $2 OR "issuerDid" LIKE $2 OR "subjectName" LIKE $2 OR "subjectId" LIKE $2)`,
    [tenantId, tagPattern],
  );
  await client.query(`DELETE FROM "RenderTemplate" WHERE "tenantId" = $1 AND (id LIKE $2 OR name LIKE $2)`, [
    tenantId,
    tagPattern,
  ]);
  await client.query(
    `DELETE FROM "DataModel"
     WHERE "tenantId" = $1
       AND (id LIKE $2 OR name LIKE $2 OR "schemaUrl" LIKE $2 OR "contextUrl" LIKE $2 OR "websiteUrl" LIKE $2)`,
    [tenantId, tagPattern],
  );

  await client.query(
    `DELETE FROM "Product"
     WHERE "tenantId" = $1
       AND (id LIKE $2 OR name LIKE $2 OR description LIKE $2)
       AND "parentId" IN (SELECT id FROM "Product" WHERE "tenantId" = $1 AND (id LIKE $2 OR name LIKE $2 OR description LIKE $2))`,
    [tenantId, tagPattern],
  );
  await client.query(
    `DELETE FROM "Product" WHERE "tenantId" = $1 AND (id LIKE $2 OR name LIKE $2 OR description LIKE $2)`,
    [tenantId, tagPattern],
  );
  await client.query(
    `DELETE FROM "Facility" WHERE "tenantId" = $1 AND (id LIKE $2 OR name LIKE $2 OR description LIKE $2)`,
    [tenantId, tagPattern],
  );
  await client.query(
    `DELETE FROM "OrganisationEntity" WHERE "tenantId" = $1 AND (id LIKE $2 OR name LIKE $2 OR description LIKE $2)`,
    [tenantId, tagPattern],
  );
  await client.query(`DELETE FROM "Identifier" WHERE "tenantId" = $1 AND (id LIKE $2 OR value LIKE $2)`, [
    tenantId,
    tagPattern,
  ]);
  await client.query(
    `DELETE FROM "SchemeQualifier" WHERE "schemeId" IN (SELECT id FROM "IdentifierScheme" WHERE "tenantId" = $1 AND (id LIKE $2 OR name LIKE $2 OR "primaryKey" LIKE $2))`,
    [tenantId, tagPattern],
  );
  await client.query(
    `DELETE FROM "IdentifierScheme" WHERE "tenantId" = $1 AND (id LIKE $2 OR name LIKE $2 OR "primaryKey" LIKE $2)`,
    [tenantId, tagPattern],
  );
  await client.query(
    `DELETE FROM "Registrar" WHERE "tenantId" = $1 AND (id LIKE $2 OR name LIKE $2 OR namespace LIKE $2 OR url LIKE $2)`,
    [tenantId, tagPattern],
  );
  await client.query(
    `DELETE FROM "Did"
     WHERE "tenantId" = $1 AND (id LIKE $2 OR did LIKE $2 OR name LIKE $2 OR description LIKE $2)`,
    [tenantId, tagPattern],
  );
  await client.query(
    `DELETE FROM "ServiceInstance" WHERE "tenantId" = $1 AND (id LIKE $2 OR name LIKE $2 OR description LIKE $2)`,
    [tenantId, tagPattern],
  );

  const taggedTenant = await client.query(`SELECT id FROM "Tenant" WHERE id = $1 AND (id LIKE $2 OR name LIKE $2)`, [
    tenantId,
    tagPattern,
  ]);
  if (taggedTenant.rowCount > 0) {
    await client.query(`UPDATE "User" SET "tenantId" = NULL WHERE "tenantId" = $1`, [tenantId]);
    await client.query(`DELETE FROM "Tenant" WHERE id = $1`, [tenantId]);
  }
}

async function cleanupTaggedDatabaseData(tag: string): Promise<string[]> {
  const client = getDbClient();
  const failures: string[] = [];
  try {
    await client.connect();
    const tagPattern = `%${tag}%`;
    const taggedTenants = await client.query<{ tenantId: string }>(
      `SELECT DISTINCT "tenantId" AS "tenantId"
       FROM (
         SELECT "tenantId" FROM "LibraryRecord"
          WHERE id LIKE $1 OR name LIKE $1 OR "issuerName" LIKE $1 OR "issuerDid" LIKE $1 OR "subjectName" LIKE $1 OR "subjectId" LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "RenderTemplate" WHERE id LIKE $1 OR name LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "DataModel"
          WHERE id LIKE $1 OR name LIKE $1 OR "schemaUrl" LIKE $1 OR "contextUrl" LIKE $1 OR "websiteUrl" LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "Product" WHERE id LIKE $1 OR name LIKE $1 OR description LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "Facility" WHERE id LIKE $1 OR name LIKE $1 OR description LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "OrganisationEntity" WHERE id LIKE $1 OR name LIKE $1 OR description LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "Identifier" WHERE id LIKE $1 OR value LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "IdentifierScheme" WHERE id LIKE $1 OR name LIKE $1 OR "primaryKey" LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "Registrar" WHERE id LIKE $1 OR name LIKE $1 OR namespace LIKE $1 OR url LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "Did" WHERE id LIKE $1 OR did LIKE $1 OR name LIKE $1 OR description LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "ServiceInstance" WHERE id LIKE $1 OR name LIKE $1 OR description LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "ConformityScheme" WHERE id LIKE $1 OR "canonicalId" LIKE $1 OR name LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "ConformityProfile" WHERE id LIKE $1 OR "canonicalId" LIKE $1 OR name LIKE $1
         UNION ALL
         SELECT "tenantId" FROM "ConformityCriterion" WHERE id LIKE $1 OR "canonicalId" LIKE $1 OR name LIKE $1
         UNION ALL
         SELECT id AS "tenantId" FROM "Tenant" WHERE id LIKE $1 OR name LIKE $1
       ) AS tagged
       WHERE "tenantId" IS NOT NULL`,
      [tagPattern],
    );
    for (const row of taggedTenants.rows) testTenantIds.add(row.tenantId);

    for (const tenantId of testTenantIds) {
      try {
        await deleteTaggedTenantData(client, tenantId, tag);
      } catch (error) {
        failures.push(
          `database fallback for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    await client.end();
  }
  return failures;
}

async function cleanupDatabaseUsers(errors: string[]): Promise<void> {
  const client = getDbClient();
  try {
    await client.connect();
    const emails = [
      process.env.E2E_USER_EMAIL || 'e2e-admin@test.local',
      process.env.E2E_USER2_EMAIL || 'e2e-user@test.local',
    ];
    for (const email of emails) {
      try {
        await client.query(`DELETE FROM "Account" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]);
      } catch (error) {
        errors.push(`OAuth accounts for ${email}: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        await client.query(`DELETE FROM "User" WHERE email = $1`, [email]);
      } catch (error) {
        errors.push(`user ${email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(`database user cleanup connection: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try {
      await client.end();
    } catch (error) {
      errors.push(`database user cleanup close: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function cleanupDatabaseServiceAccounts(errors: string[]): Promise<void> {
  if (serviceAccountSubjects.size === 0) return;

  const client = getDbClient();
  try {
    await client.connect();
    const preserveTenant = (process.env.E2E_TENANT_MODE || 'open') === 'closed';
    for (const [actor, sub] of serviceAccountSubjects) {
      try {
        const userResult = await client.query(`SELECT id, "tenantId" FROM "User" WHERE "authProviderId" = $1`, [sub]);
        if (userResult.rowCount === 0) continue;

        const { id: userId, tenantId } = userResult.rows[0];
        if (tenantId) {
          testTenantIds.add(tenantId);
          await deleteTenantData(client, tenantId, { preserveTenant });
        }
        await client.query(`DELETE FROM "Account" WHERE "userId" = $1`, [userId]);
        await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
      } catch (error) {
        errors.push(`service account ${actor}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(`service-account cleanup connection: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try {
      await client.end();
    } catch (error) {
      errors.push(`service-account cleanup close: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function cleanupIdentityResolverNamespace(namespace: string): Promise<string | undefined> {
  try {
    const baseUrl = process.env.E2E_IDR_PUBLIC_BASE_URL || 'http://localhost:3000';
    const url = new URL('/api/v4/identifiers', baseUrl);
    url.searchParams.set('namespace', namespace);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${process.env.E2E_IDR_API_KEY || 'test123'}` },
    });
    if (response.ok || response.status === 404) return undefined;
    const body = await response.text();
    // Pyx IDR v4 answers 400 rather than 404 for a namespace it does not
    // hold; a namespace the run never registered is a clean state.
    if (response.status === 400 && /not found/i.test(body)) return undefined;
    return `DELETE ${url.pathname}?namespace=${namespace} returned ${response.status}${
      body ? ` ${body.slice(0, 500)}` : ''
    }`;
  } catch (error) {
    return `DELETE Identity Resolver namespace ${namespace} failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

async function clearTaggedObjectStore({
  bucketName,
  prefix,
  tag,
  minioConfig,
}: {
  bucketName: string;
  prefix?: string;
  tag: string;
  minioConfig: ClientOptions;
}): Promise<{ success: boolean; message?: string }> {
  try {
    if (!bucketName) {
      return {
        success: false,
        message: 'Bucket name is required.',
      };
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
    const bucketStream = minioClient.listObjectsV2(bucketName, prefix, true);

    await new Promise<void>((resolve, reject) => {
      bucketStream.on('data', (obj) => {
        if (obj.name && obj.name.includes(tag)) objects.push(obj.name);
      });
      bucketStream.on('error', (err) => reject(err));
      bucketStream.on('end', () => resolve());
    });

    if (objects.length > 0) {
      await minioClient.removeObjects(bucketName, objects);
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, message: error?.message ?? 'Unknown error' };
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
    VERIFY_ALLOW_PRIVATE_URLS: harnessAllowsPrivateUrls,

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
    USER2_PASSWORD: process.env.E2E_USER2_PASSWORD || '',

    // Service accounts
    SA1_CLIENT_ID: process.env.E2E_SA1_CLIENT_ID || 'ri-service-account-e2e',
    SA1_CLIENT_SECRET: process.env.E2E_SA1_CLIENT_SECRET || 'e2e-service-account-secret',
    SA2_CLIENT_ID: process.env.E2E_SA2_CLIENT_ID || 'ri-service-account-e2e-2',
    SA2_CLIENT_SECRET: process.env.E2E_SA2_CLIENT_SECRET || 'e2e-service-account-secret-2',

    // RI-internal services
    VCKIT_BASE_URL: process.env.E2E_VCKIT_BASE_URL || 'https://vckit.e2e.internal',
    VCKIT_API_KEY: process.env.E2E_VCKIT_API_KEY || 'test123',
    VCKIT_DID_WEB_RESOLVABLE: (process.env.E2E_VCKIT_DID_WEB_RESOLVABLE ?? 'true') === 'true',
    STORAGE_BASE_URL: process.env.E2E_STORAGE_BASE_URL || 'http://storage-service:3334',
    STORAGE_API_KEY: process.env.E2E_STORAGE_API_KEY || 'test123',
    STORAGE_API_VERSION: process.env.E2E_STORAGE_API_VERSION || '4.0',
    STORAGE_PUBLIC_BUCKET: process.env.E2E_STORAGE_PUBLIC_BUCKET || 'public-data',
    STORAGE_PRIVATE_BUCKET: process.env.E2E_STORAGE_PRIVATE_BUCKET || 'private-data',
    IDR_PUBLIC_BASE_URL: process.env.E2E_IDR_PUBLIC_BASE_URL || 'http://localhost:3000',
    IDR_API_KEY: process.env.E2E_IDR_API_KEY || 'test123',

    // Test organisation
    TEST_ORG_ID: process.env.E2E_TEST_ORG_ID || 'e2e-test-org',

    // Instance contract
    RUN_ID,
    E2E_DB_ACCESS,
    E2E_IDP_E2E_REALM,
    RESIDUE_POLICY,

    // Tenant mode
    TENANT_MODE: process.env.E2E_TENANT_MODE || 'open',

    // Closed-mode groups
    GROUP_ALPHA: process.env.E2E_GROUP_ALPHA || '/e2e-org-alpha',
    GROUP_BETA: process.env.E2E_GROUP_BETA || '/e2e-org-beta',
  },
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:3003',
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    excludeSpecPattern:
      (process.env.E2E_TENANT_MODE || 'open') === 'closed'
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
    setupNodeEvents(on, config) {
      requireResolvedKeyToMatchApplicationSetting(config.env.VERIFY_ALLOW_PRIVATE_URLS);
      const cleanupBaseUrl = config.baseUrl ?? 'http://localhost:3003';

      on('after:run', async () => {
        const cleanupErrors: string[] = [];
        try {
          if (E2E_DB_ACCESS) await ensureServiceAccountActors();
        } catch (error) {
          cleanupErrors.push(`service-account setup: ${error instanceof Error ? error.message : String(error)}`);
        }

        const actors = [...registeredActors.values()];
        if (actors.length === 0 && E2E_DB_ACCESS) {
          cleanupErrors.push('No authenticated actors were available for API cleanup.');
        }

        const cleanupOptions: CleanupOptions = {
          baseUrl: cleanupBaseUrl,
          tag: RUN_TAG,
          actors,
        };
        const apiCleanup = await cleanupRunData(cleanupOptions);
        for (const failure of apiCleanup.failures) {
          console.error(`E2E API cleanup failure: ${failure.actor}/${failure.collection}: ${failure.message}`);
        }

        if (E2E_DB_ACCESS) {
          const resolverCleanupError = await cleanupIdentityResolverNamespace(`e2e-pub-${RUN_TAG}`);
          if (resolverCleanupError) cleanupErrors.push(`Identity Resolver cleanup: ${resolverCleanupError}`);

          try {
            cleanupErrors.push(...(await cleanupTaggedDatabaseData(RUN_TAG)));
          } catch (error) {
            cleanupErrors.push(`database fallback: ${error instanceof Error ? error.message : String(error)}`);
          }

          const objectStoreCleanup = await clearTaggedObjectStore({
            bucketName: config.env.idrBucketName as string,
            prefix: 'gs1',
            tag: RUN_TAG,
            minioConfig: config.env.idrMinioConfig as ClientOptions,
          });
          if (!objectStoreCleanup.success) {
            cleanupErrors.push(`object store cleanup: ${objectStoreCleanup.message ?? 'unknown failure'}`);
          }

          await cleanupDatabaseServiceAccounts(cleanupErrors);
          await cleanupDatabaseUsers(cleanupErrors);
        }

        const proof = await findTaggedRows(cleanupOptions, (tags) => tags.includes(RUN_TAG));
        for (const failure of proof.failures) {
          console.error(`E2E cleanup proof failure: ${failure.actor}/${failure.collection}: ${failure.message}`);
        }
        for (const row of proof.rows) {
          console.error(
            `E2E cleanup proof found ${row.collection} row ${row.id} for ${row.actor} carrying ${row.tags.join(', ')}.`,
          );
        }

        cleanupErrors.push(...formatCleanupFailures(proof.failures));
        cleanupErrors.push(
          ...proof.rows.map(
            (row) => `${row.actor}/${row.collection}: leftover row ${row.id} carrying ${row.tags.join(', ')}`,
          ),
        );
        if (!E2E_DB_ACCESS) cleanupErrors.push(...formatCleanupFailures(apiCleanup.failures));

        if (cleanupErrors.length > 0) {
          // Cypress prints only the aggregate's message, so each entry is
          // written out here where it can be read.
          for (const entry of cleanupErrors) console.error(`E2E cleanup: ${entry}`);
          throw new AggregateError(cleanupErrors, 'E2E cleanup or proof failed');
        }
      });

      on('task', {
        async prepareE2ERun() {
          if (!E2E_DB_ACCESS) return null;
          await ensureServiceAccountActors();
          return null;
        },
        async cleanupE2ERunData() {
          if (E2E_DB_ACCESS) await ensureServiceAccountActors();
          if (registeredActors.size === 0) return { failures: [], matchedRows: 0 };
          const result = await cleanupRunData({
            baseUrl: cleanupBaseUrl,
            tag: RUN_TAG,
            actors: [...registeredActors.values()],
          });
          for (const failure of result.failures) {
            console.error(
              `E2E per-spec API cleanup failure: ${failure.actor}/${failure.collection}: ${failure.message}`,
            );
          }
          if (!E2E_DB_ACCESS && result.failures.length > 0) {
            throw new AggregateError(formatCleanupFailures(result.failures), 'E2E per-spec API cleanup failed');
          }
          return result;
        },
        captureSessionCookies({ cookies }: { cookies: Array<{ name: string; value: string }> }) {
          if (!Array.isArray(cookies) || cookies.length === 0) {
            throw new Error('The session user did not provide any cookies for API cleanup.');
          }
          const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
          recordActor({ name: 'session-user', headers: { Cookie: cookieHeader } });
          return null;
        },
        async checkE2EResidue() {
          if (!E2E_DB_ACCESS) return null;
          if (residueChecked) return null;
          residueChecked = true;
          await ensureServiceAccountActors();

          const options: CleanupOptions = {
            baseUrl: cleanupBaseUrl,
            tag: RUN_TAG,
            actors: [...registeredActors.values()],
          };
          const residue = await findTaggedRows(options, (tags) => tags.some((tag) => tag !== RUN_TAG));
          const failures = formatCleanupFailures(residue.failures);
          if (failures.length > 0) {
            throw new Error(`E2E residue check could not list every collection:\n${failures.join('\n')}`);
          }
          if (residue.rows.length === 0) return null;

          const rowSummary = residue.rows.map(
            (row) => `${row.actor}/${row.collection}/${row.id}: ${row.tags.join(', ')}`,
          );
          if (RESIDUE_POLICY === 'fail') {
            throw new Error(`E2E residue from an earlier run was found:\n${rowSummary.join('\n')}`);
          }

          const residueTags = [...new Set(residue.rows.flatMap((row) => row.tags))];
          const cleanupFailures: CleanupFailure[] = [];
          for (const tag of residueTags) {
            const result = await cleanupRunData({ ...options, tag });
            for (const failure of result.failures) {
              console.error(
                `E2E residue API cleanup failure: ${failure.actor}/${failure.collection}: ${failure.message}`,
              );
            }
            if (!E2E_DB_ACCESS) cleanupFailures.push(...result.failures);
            if (E2E_DB_ACCESS) {
              try {
                cleanupFailures.push(
                  ...(await cleanupTaggedDatabaseData(tag)).map((message) => ({
                    actor: 'database fallback',
                    collection: 'tagged rows',
                    message,
                  })),
                );
              } catch (error) {
                cleanupFailures.push({
                  actor: 'database fallback',
                  collection: 'tagged rows',
                  message: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }

          if (cleanupFailures.length > 0) {
            throw new Error(`E2E residue cleanup failed:\n${formatCleanupFailures(cleanupFailures).join('\n')}`);
          }
          const remaining = await findTaggedRows(options, (tags) => tags.some((tag) => residueTags.includes(tag)));
          if (remaining.failures.length > 0 || remaining.rows.length > 0) {
            throw new Error(
              `E2E residue cleanup did not converge:\n${formatCleanupFailures(remaining.failures)
                .concat(remaining.rows.map((row) => `${row.actor}/${row.collection}/${row.id}: ${row.tags.join(', ')}`))
                .join('\n')}`,
            );
          }
          return null;
        },
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
        async clearObjectStore({
          bucketName,
          prefix,
          tag,
          minioConfig,
        }: {
          bucketName: string;
          prefix?: string;
          tag: string;
          minioConfig: ClientOptions;
        }) {
          return clearTaggedObjectStore({ bucketName, prefix, tag, minioConfig });
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
        async seedConformitySchemes({ tenantId, tag }: { tenantId: string; tag?: string }) {
          const client = getDbClient();
          const seedTag = tag ?? RUN_TAG;
          const scheme = `https://e2e.example/${seedTag}/scheme`;
          const profile = `${scheme}/profile/1.0.0`;
          const criterion = `${scheme}/criterion/1.0.0`;
          const topic = `https://vocabulary.example.com/conformity-topic/${seedTag}`;
          try {
            await client.connect();
            await client.query(
              `INSERT INTO "ConformityScheme" (id, "canonicalId", name, "specVersion", source, "sourceUrl", "lastFetchStatus", "tenantId", "createdAt", "updatedAt")
               VALUES ($1, $2, 'E2E Scheme', '0.7.0', 'TENANT_IMPORTED', $3, 'SUCCESS', $4, NOW(), NOW())
               ON CONFLICT (id) DO NOTHING`,
              [`${seedTag}-cvc-scheme-${tenantId}`, scheme, `${scheme}.json`, tenantId],
            );
            await client.query(
              `INSERT INTO "ConformityProfile" (id, "canonicalId", name, version, status, "tenantId", "schemeId", "createdAt", "updatedAt")
               VALUES ($1, $2, 'E2E Profile', '1.0.0', 'active', $3, $4, NOW(), NOW())
               ON CONFLICT (id) DO NOTHING`,
              [`${seedTag}-cvc-profile-${tenantId}`, profile, tenantId, `${seedTag}-cvc-scheme-${tenantId}`],
            );
            await client.query(
              `INSERT INTO "ConformityCriterion" (id, "canonicalId", name, version, status, topics, tags, "tenantId", "createdAt", "updatedAt")
               VALUES ($1, $2, 'E2E Criterion', '1.0.0', 'active', $3::jsonb, ARRAY['e2e']::text[], $4, NOW(), NOW())
               ON CONFLICT (id) DO NOTHING`,
              [`${seedTag}-cvc-criterion-${tenantId}`, criterion, JSON.stringify([{ canonicalId: topic }]), tenantId],
            );
            await client.query(
              `INSERT INTO "ConformityProfileCriterion" (id, "profileId", "criterionId")
               VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
              [
                `${seedTag}-cvc-join-${tenantId}`,
                `${seedTag}-cvc-profile-${tenantId}`,
                `${seedTag}-cvc-criterion-${tenantId}`,
              ],
            );
            return { scheme, profile, criterion, topic };
          } finally {
            await client.end();
          }
        },
        async seedTestOrg({ userEmail }: { userEmail: string }) {
          const tenantMode = process.env.E2E_TENANT_MODE || 'open';
          const client = getDbClient();
          try {
            await client.connect();

            if (tenantMode === 'closed') {
              // In closed mode, the tenant is auto-provisioned from the IDP group.
              // Find the user's existing tenant.
              const result = await client.query(`SELECT id, "tenantId" FROM "User" WHERE email = $1`, [userEmail]);

              if (result.rowCount === 0) {
                throw new Error(`User with email ${userEmail} not found. Has the user logged in?`);
              }

              const tenantId = result.rows[0].tenantId;
              if (!tenantId) {
                throw new Error(
                  `User ${userEmail} has no tenant. In closed mode, the user must log in first to auto-provision a tenant.`,
                );
              }

              // Clean existing test data so tests start fresh
              await deleteTenantData(client, tenantId, { preserveTenant: true });

              testTenantIds.add(tenantId);
              return { tenantId, userId: result.rows[0].id };
            }

            // Open mode: create or update test tenant
            const testOrgId = process.env.E2E_TEST_ORG_ID || 'e2e-test-org';
            await client.query(
              `
              INSERT INTO "Tenant" (id, name, "createdAt", "updatedAt")
              VALUES ($1, $2, NOW(), NOW())
               ON CONFLICT (id) DO UPDATE SET "updatedAt" = NOW()
            `,
              [testOrgId, `E2E Test Organisation ${RUN_TAG}`],
            );

            const result = await client.query(
              `UPDATE "User" SET "tenantId" = $1, "updatedAt" = NOW()
               WHERE email = $2
               RETURNING id`,
              [testOrgId, userEmail],
            );

            if (result.rowCount === 0) {
              throw new Error(`User with email ${userEmail} not found. Has the user logged in?`);
            }

            testTenantIds.add(testOrgId);
            return { tenantId: testOrgId, userId: result.rows[0].id };
          } finally {
            await client.end();
          }
        },
        async cleanupTestData({ tenantId, preserveTenant }: { tenantId: string; preserveTenant?: boolean }) {
          const client = getDbClient();
          try {
            await client.connect();
            testTenantIds.add(tenantId);
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
            const tenantResult = await client.query(`SELECT id FROM "Tenant" WHERE "externalIdpGroupId" = $1`, [
              externalIdpGroupId,
            ]);

            if (tenantResult.rowCount === 0) {
              return null;
            }

            const tenantId = tenantResult.rows[0].id;
            testTenantIds.add(tenantId);
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

            const result = await client.query(`SELECT email, "tenantId" FROM "User" WHERE email = ANY($1)`, [emails]);

            if (result.rowCount === 0) {
              return { sameTenant: false, tenantId: null, externalIdpGroupId: null };
            }

            const tenantIds = new Set(result.rows.map((r: any) => r.tenantId).filter(Boolean));
            const sameTenant = tenantIds.size === 1;
            const tenantId = sameTenant ? result.rows[0].tenantId : null;

            let externalIdpGroupId = null;
            if (tenantId) {
              const tenantResult = await client.query(`SELECT "externalIdpGroupId" FROM "Tenant" WHERE id = $1`, [
                tenantId,
              ]);
              externalIdpGroupId = tenantResult.rows[0]?.externalIdpGroupId ?? null;
            }

            return { sameTenant, tenantId, externalIdpGroupId };
          } finally {
            await client.end();
          }
        },
        async getServiceAccountToken(options?: { clientId?: string; clientSecret?: string }) {
          return requestServiceAccountToken(options);
        },
        async cleanupServiceAccountData({ sub, preserveTenant }: { sub: string; preserveTenant?: boolean }) {
          const client = getDbClient();
          try {
            await client.connect();

            // Find user by authProviderId (Keycloak sub claim)
            const userResult = await client.query(`SELECT id, "tenantId" FROM "User" WHERE "authProviderId" = $1`, [
              sub,
            ]);

            if (userResult.rowCount === 0) {
              return null;
            }

            const { id: userId, tenantId } = userResult.rows[0];

            if (tenantId) {
              testTenantIds.add(tenantId);
              await deleteTenantData(client, tenantId, { preserveTenant });
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
              await client.query(`DELETE FROM "Account" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [
                email,
              ]);
              // Delete user
              await client.query(`DELETE FROM "User" WHERE email = $1`, [email]);
            }
            return null;
          } finally {
            await client.end();
          }
        },
        async seedForeignTenantDid() {
          const client = getDbClient();
          try {
            await client.connect();
            const foreignTenantId = `${RUN_TAG}-foreign-tenant`;
            const foreignDidId = `${RUN_TAG}-foreign-did`;
            const foreignDid = `did:web:foreign-tenant.example.com:${RUN_TAG}`;
            testTenantIds.add(foreignTenantId);

            // Create a foreign tenant (update timestamp if it already exists from a previous run)
            await client.query(
              `INSERT INTO "Tenant" (id, name, "createdAt", "updatedAt")
               VALUES ($1, $2, NOW(), NOW())
               ON CONFLICT (id) DO UPDATE SET "updatedAt" = NOW()`,
              [foreignTenantId, `E2E Foreign Tenant ${RUN_TAG}`],
            );

            // Create a DID belonging to that foreign tenant
            await client.query(
              `INSERT INTO "Did" (id, "tenantId", did, type, method, "keyId", name, status, "isDefault", "createdAt", "updatedAt")
              VALUES ($1, $2, $3, 'MANAGED', 'DID_WEB', 'foreign-key-1', $4, 'ACTIVE', false, NOW(), NOW())
               ON CONFLICT (id) DO UPDATE SET did = $3, "updatedAt" = NOW()`,
              [foreignDidId, foreignTenantId, foreignDid, `Foreign DID ${RUN_TAG}`],
            );

            return { tenantId: foreignTenantId, didId: foreignDidId, did: foreignDid };
          } finally {
            await client.end();
          }
        },
        async cleanupForeignTenantDid() {
          const client = getDbClient();
          try {
            await client.connect();
            const foreignTenantId = `${RUN_TAG}-foreign-tenant`;
            testTenantIds.add(foreignTenantId);
            await deleteTenantData(client, foreignTenantId);
            return null;
          } finally {
            await client.end();
          }
        },
      });

      return config;
    },
  },
});
