/**
 * @jest-environment node
 */
/*
 * The worker issues batch items through the same code as the web's single
 * credential route, so a setting the web receives and the worker does not
 * makes a batch item fail or come out different (#1093). This test holds the
 * two stock Compose files to one rule: every key on the web service is on the
 * worker with the same value expression, unless the file's exemption list
 * says the worker process does not need it. An exemption records that the
 * worker process does not read the key, so if worker code starts reading an
 * exempted key, add it to the worker service and remove the exemption.
 *
 * Only the base files are parsed. The override files (`-closed`, `-offline`,
 * `-legacy-fetch`) are not merged here, and no automated check renders them.
 * After changing an override, run `docker compose -f docker-compose.e2e.yml
 * -f <override> config` and compare the two services by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

/** `null` is a pass-through (`- KEY` or `KEY:`); a string is an explicit value, `''` included. */
type ComposeEnvironment = Map<string, string | null>;

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

/** Present on both services, deliberately with different values. */
const DIFFERS_BY_DESIGN = new Set(['OTEL_SERVICE_NAME']);

const SIGN_IN = 'sign-in and API authentication run in the web process only';
const TENANT = 'the web resolves the tenant from the signed-in identity; a job carries its tenant id';
const SEED = 'read by the seed, which only the web container runs';
const UNREAD_LINK = 'no code reads it; the default human verification link is built from RI_APP_URL';
const UNREAD_SERVICE = 'no running code reads it; service instances come from the database';
const CALLER_FETCH_SIZE = 'caps the body of a caller-supplied fetch, which only web routes make';
const CALLER_FETCH_TIMEOUT = 'bounds a caller-supplied fetch or the key-bearing recovery read, both made on web routes';
const STATUS_OPERATION = 'status reads, changes and reconciliation run on web routes; issuance does not read it';
const REQUEST_BODY = 'limits a web request body';
const DATABASE_URL_SET =
  'both services set RI_DATABASE_URL, which Prisma reads and the queue prefers over the parts (app-job-queue.ts)';

const SYSTEM_SEED_NAMES = [
  'SYSTEM_VC_API_KEY',
  'SYSTEM_VC_ADAPTER_TYPE',
  'SYSTEM_VC_API_VERSION',
  'SYSTEM_STORAGE_BASE_URL',
  'SYSTEM_STORAGE_API_KEY',
  'SYSTEM_STORAGE_ADAPTER_TYPE',
  'SYSTEM_STORAGE_API_VERSION',
  'SYSTEM_STORAGE_PUBLIC_BUCKET',
  'SYSTEM_STORAGE_PRIVATE_BUCKET',
  'SYSTEM_IDR_BASE_URL',
  'SYSTEM_IDR_API_KEY',
  'SYSTEM_IDR_ADAPTER_TYPE',
  'SYSTEM_IDR_API_VERSION',
  'SYSTEM_IDR_DEFAULT_LINK_TYPE',
  'SYSTEM_IDR_DEFAULT_MIME_TYPE',
  'SYSTEM_IDR_DEFAULT_LANGUAGE',
  'SYSTEM_IDR_DEFAULT_CONTEXT',
  'SYSTEM_IDR_DEFAULT_FWQS',
  'SYSTEM_DID',
  'SYSTEM_DID_NAME',
  'SYSTEM_DID_DESCRIPTION',
];

const WEB_ONLY_SHARED: Record<string, string> = {
  AUTH_OIDC_PROVIDER: SIGN_IN,
  AUTH_OIDC_CLIENT_ID: SIGN_IN,
  AUTH_OIDC_CLIENT_SECRET: SIGN_IN,
  AUTH_OIDC_ISSUER: SIGN_IN,
  AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE: SIGN_IN,
  AUTH_SECRET: SIGN_IN,
  AUTH_TRUST_HOST: SIGN_IN,
  TENANT_MODE: TENANT,
  TENANT_CLAIM_NAME: TENANT,
  TENANT_CLAIM_FORMAT: TENANT,
  DEFAULT_HUMAN_VERIFICATION_URL: UNREAD_LINK,
  DEFAULT_MACHINE_VERIFICATION_URL: UNREAD_LINK,
  FETCH_MAX_RESPONSE_SIZE: CALLER_FETCH_SIZE,
  VERIFY_MAX_CREDENTIAL_SIZE: CALLER_FETCH_SIZE,
  FETCH_TIMEOUT_MS: CALLER_FETCH_TIMEOUT,
  VERIFY_FETCH_TIMEOUT_MS: CALLER_FETCH_TIMEOUT,
  CREDENTIAL_STATUS_OPERATION_BUDGET_MS: STATUS_OPERATION,
  CREDENTIAL_STATUS_RECONCILE_GRACE_MS: STATUS_OPERATION,
  CREDENTIAL_STATUS_MUTATION_ENABLED: STATUS_OPERATION,
  MAX_BATCH_REQUEST_BODY_BYTES: REQUEST_BODY,
  ...Object.fromEntries(SYSTEM_SEED_NAMES.map((name) => [name, SEED])),
  SYSTEM_VC_BASE_URL: 'read by the seed and by the web DID route, which guards the root did:web domain with it',
};

const COMPOSE_FILES = [
  {
    file: 'docker-compose.yml',
    web: 'ri',
    worker: 'ri-worker',
    workerNeedsNot: {
      ...WEB_ONLY_SHARED,
      AUTH_OIDC_AUTHORIZATION_URL: SIGN_IN,
      OUTGOING_DATA_ENCRYPTION_KEY: 'read only by the operator key-rotation command, not by either process',
      ...Object.fromEntries(
        [
          'SYSTEM_VC_SERVICE_NAME',
          'SYSTEM_VC_SERVICE_DESCRIPTION',
          'SYSTEM_STORAGE_SERVICE_NAME',
          'SYSTEM_STORAGE_SERVICE_DESCRIPTION',
          'SYSTEM_IDR_SERVICE_NAME',
          'SYSTEM_IDR_SERVICE_DESCRIPTION',
        ].map((name) => [name, SEED]),
      ),
      API_MAX_BATCH_LIMIT: 'limits the ids accepted by the web library batch-get route',
      MAX_REQUEST_BODY_BYTES: REQUEST_BODY,
      IDEMPOTENCY_STALE_CLAIM_MINUTES: 'Idempotency-Key claims are taken on web routes',
    },
  },
  {
    file: 'docker-compose.e2e.yml',
    web: 'app',
    worker: 'app-worker',
    workerNeedsNot: {
      ...WEB_ONLY_SHARED,
      AUTH_URL: SIGN_IN,
      RI_POSTGRES_USER: DATABASE_URL_SET,
      RI_POSTGRES_PASSWORD: DATABASE_URL_SET,
      RI_POSTGRES_DB: DATABASE_URL_SET,
      RI_POSTGRES_HOST: DATABASE_URL_SET,
      RI_POSTGRES_PORT: DATABASE_URL_SET,
      VCKIT_API_URL: UNREAD_SERVICE,
      VCKIT_API_KEY: UNREAD_SERVICE,
      UNCEFACT_STORAGE_URL: UNREAD_SERVICE,
      UNCEFACT_STORAGE_API_KEY: UNREAD_SERVICE,
      UNCEFACT_STORAGE_PUBLIC_BUCKET: UNREAD_SERVICE,
      UNCEFACT_STORAGE_PRIVATE_BUCKET: UNREAD_SERVICE,
      PYX_IDR_API_URL: UNREAD_SERVICE,
      PYX_IDR_API_KEY: UNREAD_SERVICE,
    },
  },
] as const;

/**
 * Compose accepts a list (`- KEY`, `- KEY=value`) or a map (`KEY:`,
 * `KEY: value`). A bare key passes the host's value through and leaves the
 * variable unset when the host has none; `KEY=` and `KEY: ''` set it empty.
 * Those differ at run time, so they stay distinct here. Map scalars such as
 * `5432` are compared as the string Compose passes on.
 */
function normaliseEnvironment(environment: unknown): ComposeEnvironment {
  const result: ComposeEnvironment = new Map();
  if (Array.isArray(environment)) {
    for (const entry of environment) {
      const text = String(entry);
      const separator = text.indexOf('=');
      if (separator === -1) result.set(text, null);
      else result.set(text.slice(0, separator), text.slice(separator + 1));
    }
    return result;
  }
  if (environment !== null && typeof environment === 'object') {
    for (const [key, value] of Object.entries(environment)) {
      result.set(key, value === null ? null : String(value));
    }
    return result;
  }
  throw new Error(`Unexpected environment block: ${JSON.stringify(environment)}`);
}

function readServiceEnvironments(file: string, web: string, worker: string) {
  const document = parse(fs.readFileSync(path.resolve(REPOSITORY_ROOT, file), 'utf8')) as {
    services: Record<string, { environment?: unknown }>;
  };
  return {
    web: normaliseEnvironment(document.services[web].environment),
    worker: normaliseEnvironment(document.services[worker].environment),
  };
}

function describeValue(value: string | null | undefined): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'pass-through';
  return JSON.stringify(value);
}

describe.each(COMPOSE_FILES)('$file', ({ file, web, worker, workerNeedsNot }) => {
  const environments = readServiceEnvironments(file, web, worker);
  const exemptions: Record<string, string> = workerNeedsNot;

  it(`gives ${worker} every ${web} setting with the same value, unless the worker does not need it`, () => {
    const mismatches = [...environments.web]
      .filter(([key]) => !(key in exemptions))
      .filter(([key, value]) =>
        DIFFERS_BY_DESIGN.has(key) ? !environments.worker.has(key) : environments.worker.get(key) !== value,
      )
      .map(
        ([key, value]) =>
          `${key}: ${web} ${describeValue(value)}, ${worker} ${describeValue(environments.worker.get(key))}`,
      );

    expect(mismatches).toEqual([]);
  });

  it(`exempts only settings ${web} has and ${worker} does not`, () => {
    const stale = Object.keys(exemptions).filter((key) => !environments.web.has(key) || environments.worker.has(key));

    expect(stale).toEqual([]);
  });
});
