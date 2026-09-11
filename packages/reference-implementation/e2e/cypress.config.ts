import { exec } from 'child_process';
import { defineConfig } from 'cypress';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { readFetchAllowPrivateUrlsIfSet } from '../src/lib/config/credential-fetch.config';
import {
  cleanupRunData,
  findTaggedRows,
  type CleanupActor,
  type CleanupFailure,
  type CleanupOptions,
} from './cypress/support/cleanup';

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
let residueChecked = false;

function recordActor(actor: CleanupActor): void {
  registeredActors.set(actor.name, actor);
}

function actorNameForClient(clientId: string): string {
  const sa2ClientId = process.env.E2E_SA2_CLIENT_ID || 'ri-service-account-e2e-2';
  return clientId === sa2ClientId ? 'service-account-2' : 'service-account-1';
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
  // Always a fresh token: a deployment's token lifetime can be shorter than
  // the run, and cleanup and proof must not fail on an expired credential.
  for (const client of clients) await requestServiceAccountToken(client);
}

function formatCleanupFailures(failures: CleanupFailure[]): string[] {
  return failures.map(({ actor, collection, message }) => `${actor}/${collection}: ${message}`);
}

/**
 * Namespaces this harness has registered with the Identity Resolver and not
 * yet retired, kept on disk so a run that dies before its final cleanup
 * leaves a record the next run acts on. The resolver has no listing the
 * suite could sweep, so this file is the only memory of them.
 */
const NAMESPACE_LEDGER = path.resolve(__dirname, '.e2e-run-state', 'resolver-namespaces.json');

function readNamespaceLedger(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(NAMESPACE_LEDGER, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function writeNamespaceLedger(namespaces: string[]): void {
  fs.mkdirSync(path.dirname(NAMESPACE_LEDGER), { recursive: true });
  fs.writeFileSync(NAMESPACE_LEDGER, JSON.stringify([...new Set(namespaces)], null, 2));
}

async function retireRecordedNamespaces(current: string): Promise<string[]> {
  const errors: string[] = [];
  const remaining: string[] = [];
  for (const namespace of [...new Set([...readNamespaceLedger(), current])]) {
    const error = await cleanupIdentityResolverNamespace(namespace);
    if (error) {
      errors.push(`Identity Resolver cleanup (${namespace}): ${error}`);
      remaining.push(namespace);
    }
  }
  writeNamespaceLedger(remaining);
  return errors;
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

export default defineConfig({
  env: {
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
    // The same storage service as the test runner reaches it. The RI returns
    // copy URIs under STORAGE_BASE_URL; specs that fetch a copy directly
    // rewrite that prefix to this one.
    STORAGE_PUBLIC_BASE_URL: process.env.E2E_STORAGE_PUBLIC_BASE_URL || 'http://localhost:3334',
    STORAGE_API_KEY: process.env.E2E_STORAGE_API_KEY || 'test123',
    STORAGE_API_VERSION: process.env.E2E_STORAGE_API_VERSION || '4.0',
    STORAGE_PUBLIC_BUCKET: process.env.E2E_STORAGE_PUBLIC_BUCKET || 'public-data',
    STORAGE_PRIVATE_BUCKET: process.env.E2E_STORAGE_PRIVATE_BUCKET || 'private-data',
    IDR_PUBLIC_BASE_URL: process.env.E2E_IDR_PUBLIC_BASE_URL || 'http://localhost:3000',
    IDR_API_KEY: process.env.E2E_IDR_API_KEY || 'test123',

    // Instance contract
    RUN_ID,
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
    // The final cleanup and proof live in after:run; interactive runs get it too.
    experimentalInteractiveRunEvents: true,
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
          await ensureServiceAccountActors();
        } catch (error) {
          cleanupErrors.push(`service-account setup: ${error instanceof Error ? error.message : String(error)}`);
        }

        const actors = [...registeredActors.values()];
        if (actors.length === 0) {
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
        cleanupErrors.push(...formatCleanupFailures(apiCleanup.failures));

        // The publishing spec registers one namespace with the Identity
        // Resolver directly, as an operator would; it is retired the same
        // way, together with any namespace an earlier run failed to retire.
        cleanupErrors.push(...(await retireRecordedNamespaces(`e2e-pub-${RUN_TAG}`)));

        // Fresh service-account tokens for the proof as well: cleanup may
        // have outlived the ones it started with.
        try {
          await ensureServiceAccountActors();
        } catch (error) {
          cleanupErrors.push(`service-account refresh: ${error instanceof Error ? error.message : String(error)}`);
        }
        const proof = await findTaggedRows({ ...cleanupOptions, actors: [...registeredActors.values()] }, (tags) =>
          tags.includes(RUN_TAG),
        );
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

        if (cleanupErrors.length > 0) {
          // Cypress prints only the aggregate's message, so each entry is
          // written out here where it can be read.
          for (const entry of cleanupErrors) console.error(`E2E cleanup: ${entry}`);
          throw new AggregateError(cleanupErrors, 'E2E cleanup or proof failed');
        }
      });

      on('task', {
        async prepareE2ERun() {
          // Recorded before anything is registered, so a run killed mid-way
          // still leaves the namespace for the next run to retire; earlier
          // runs' leftovers are retired now.
          const earlier = readNamespaceLedger();
          writeNamespaceLedger([...earlier, `e2e-pub-${RUN_TAG}`]);
          const errors = await retireRecordedNamespaces(`e2e-pub-${RUN_TAG}`);
          writeNamespaceLedger([...readNamespaceLedger(), `e2e-pub-${RUN_TAG}`]);
          if (errors.length > 0) {
            throw new Error(`Earlier runs' Identity Resolver namespaces could not be retired:\n${errors.join('\n')}`);
          }
          await ensureServiceAccountActors();
          return null;
        },
        async cleanupE2ERunData() {
          await ensureServiceAccountActors();
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
          if (result.failures.length > 0) {
            throw new AggregateError(formatCleanupFailures(result.failures), 'E2E per-spec API cleanup failed');
          }
          return result;
        },
        captureSessionCookies({ cookies, user }: { cookies: Array<{ name: string; value: string }>; user: string }) {
          if (!Array.isArray(cookies) || cookies.length === 0) {
            throw new Error('The session user did not provide any cookies for API cleanup.');
          }
          if (typeof user !== 'string' || !user) {
            throw new Error('The session login did not name the user whose cookies were captured.');
          }
          const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
          // One actor per signed-in user: in open mode each user has their own
          // tenant, so a later login must add an actor rather than replace one.
          recordActor({ name: `session:${user}`, headers: { Cookie: cookieHeader } });
          return null;
        },
        async checkE2EResidue() {
          // Remembered only once it has passed: a failed check is repeated,
          // and refused again, by every later spec.
          if (residueChecked) return null;
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
          if (residue.rows.length === 0) {
            residueChecked = true;
            return null;
          }

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
            cleanupFailures.push(...result.failures);
          }

          if (cleanupFailures.length > 0) {
            throw new Error(`E2E residue cleanup failed:\n${formatCleanupFailures(cleanupFailures).join('\n')}`);
          }
          await ensureServiceAccountActors();
          const remaining = await findTaggedRows({ ...options, actors: [...registeredActors.values()] }, (tags) =>
            tags.some((tag) => residueTags.includes(tag)),
          );
          if (remaining.failures.length === 0 && remaining.rows.length === 0) residueChecked = true;
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
        async getServiceAccountToken(options?: { clientId?: string; clientSecret?: string }) {
          return requestServiceAccountToken(options);
        },
      });

      return config;
    },
  },
});
