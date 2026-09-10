const capturedLogLines: string[] = [];

jest.mock('undici', () => {
  const actual = jest.requireActual('undici') as Record<string, unknown>;
  return {
    ...actual,
    fetch: (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ): ReturnType<typeof globalThis.fetch> => {
      const requestInit = { ...(init ?? {}) } as Record<string, unknown>;
      delete requestInit.dispatcher;
      return globalThis.fetch(input, requestInit as Parameters<typeof globalThis.fetch>[1]);
    },
  };
});

jest.mock('@uncefact/untp-ri-services/logging', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services/logging');
  return {
    ...actual,
    createLogger: (config: Record<string, unknown> = {}) =>
      actual.createLogger({
        ...config,
        level: 'debug',
        destination: { write: (line: string) => capturedLogLines.push(line) },
      }),
  };
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IStorageService, IVerifiableCredentialService, StorageRecord } from '@uncefact/untp-ri-services';
import { createInMemoryTtlCache } from '@uncefact/untp-utils/cache';
import { createSchemaLoader, type LoadedRemoteDocument } from '@uncefact/untp-utils/loaders';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsError,
  CredentialDetailsStatus,
  ExternalContentKind,
} from '../../src/lib/prisma/generated';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import { insertNativeCredential, seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import { PgBossJobQueue } from '../../src/lib/jobs/pg-boss-job-queue';
import type { JobContext } from '../../src/lib/jobs/types';
import { LIBRARY_RECONCILE_PENDING_RUNS_JOB } from '../../src/lib/jobs/queue-names';
import { DEFAULT_RECONCILE_PENDING_RUNS_CRON } from '../../src/lib/config/reconcile-pending-runs.config';
import {
  defaultReconcilePendingRunsDependencies,
  registerPendingRunReconciliation,
} from '../../src/lib/library/reconcile-pending-runs-job';
import {
  createExternalCredential,
  findExternalByContentDigest,
  type VerifyJobReference,
} from '../../src/lib/prisma/repositories/external-credential.repository';
import {
  protectDecryptionKey,
  revealDecryptionKey,
  type ProtectedDecryptionKey,
} from '../../src/lib/credentials/decryption-key-protection';
import { getLibraryRecordById } from '../../src/lib/prisma/repositories/library-record.repository';
import {
  toCredentialRecord,
  toCredentialRecordDetail,
  toNativeCredentialRecord,
} from '../../src/lib/library/credential-record-projection';
import {
  createReverificationGeneration,
  finaliseRecoveryGeneration,
  recoveryFinaliseTestHooks,
  reserveRecoveryGeneration,
} from '../../src/lib/prisma/repositories/check-run.repository';
import { reverifyLibraryRecord } from '../../src/lib/library/reverify-library-record';
import { fetchStoredCopyBytes } from '../../src/lib/library/verify-generation-job';
import {
  defaultRegisterDependencies,
  settleInRequest,
  EncryptionUnavailableError,
  type AcquiredCredentialInput,
  type RecoverFromSourceOptions,
  type RecoverFromStoredCopyOptions,
  type RegisterExternalCredentialDependencies,
  type RegisterExternalCredentialInput,
} from '../../src/lib/library/register-external-credential';
import {
  fetchCredentialDocument,
  getMaxCredentialSize,
  type FetchedDocument,
} from '../../src/lib/credentials/fetch-credential-document';
import {
  defaultVerifyGenerationDependencies,
  LIBRARY_VERIFY_JOB,
  VERIFY_JOB_ENQUEUE_OPTIONS,
  verifyGenerationHandler,
} from '../../src/lib/library/verify-generation-job';
import { bundledArtefactsFallback } from '../../src/lib/credentials/schema-loader';
import {
  checkSchemaConformance,
  type SchemaConformanceCheckDependencies,
} from '../../src/lib/library/schema-conformance-check';
import { apiLogger } from '../../src/lib/api/logger';
import {
  DecryptionRequiredError,
  defaultReverifyLibraryRecordDependencies,
} from '../../src/lib/library/reverify-library-record';
import { resolveStorageService } from '../../src/lib/services/resolve-storage-service';

jest.unmock('jose');

// Substituted only at the real storage microservice's HTTP boundary (ADR-029:
// mock external services at the boundary, keep internal I/O real), the same
// way every other suite in this file stubs storage. This lets the default-dependencies test
// below drive `reverifyLibraryRecord` through its own default dependencies
// (its real `recoverInRequest` fallback, `defaultRegisterDependencies` and
// `settleInRequest` in `mode: 'recover'`) with only `fetchSource` overridden,
// rather than reconstructing that wiring in the test as `recoveryRunner` does
// for the rest of this file's cases.
jest.mock('../../src/lib/services/resolve-storage-service', () => ({ resolveStorageService: jest.fn() }));

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.SERVICE_ENCRYPTION_KEY;

const RECEIVER_KEY = 'c'.repeat(64);
const DPP = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  id: 'https://supplier.example/credentials/reverify-1',
  issuer: { id: 'did:web:supplier.example', name: 'Supplier Ltd' },
  validFrom: '2026-07-22T10:00:00Z',
  credentialSubject: { id: 'https://supplier.example/products/1', name: 'Battery pack' },
};
const DPP_TEXT = JSON.stringify(DPP);
const DPP_070 = {
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://vocabulary.uncefact.org/untp/0.7.0/context/'],
  type: ['DigitalProductPassport', 'VerifiableCredential'],
  id: 'https://example.org/credentials/dpp/0001',
  issuer: {
    type: ['CredentialIssuer'],
    id: 'did:web:example.org',
    name: 'Example Issuer',
  },
  validFrom: '2026-01-01T00:00:00Z',
  name: 'Example Digital Product Passport',
  credentialSubject: {
    type: ['Product'],
    id: 'https://example.org/product/0001',
    name: 'Example Product',
    idScheme: {
      type: ['IdentifierScheme'],
      id: 'https://example.org/identifiers/',
      name: 'Example Identifier Scheme',
    },
    idGranularity: 'batch',
    producedAtFacility: {
      type: ['Facility'],
      id: 'https://example.org/facility/0001',
      name: 'Example Facility',
    },
    countryOfProduction: { countryCode: 'AU', countryName: 'Australia' },
    productCategory: [
      {
        code: '0000',
        name: 'Example Category',
        schemeId: 'https://example.org/scheme/category',
        schemeName: 'Example Category Scheme',
      },
    ],
  },
};
const LEGACY_CONTEXT_070 = 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/context/';
const THIRD_VALID_CONTEXT = 'https://supplier.example/contexts/third-valid.json';
const THIRD_MALFORMED_CONTEXT = 'https://supplier.example/contexts/third-malformed.json';
const THIRD_SCOPED_CONTEXT = 'https://supplier.example/contexts/third-scoped.json';
const THIRD_MISSING_SCOPED_CONTEXT = 'https://supplier.example/contexts/missing-scoped.json';
const PRIVATE_REF_CONTEXT_URL = 'https://supplier.example/contexts/private-ref.json';
const RECOVERY_DPP = {
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/'],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  name: 'Recovered battery passport',
  issuer: { id: 'did:web:supplier.example', name: 'Supplier Ltd' },
  validFrom: '2026-07-22T10:00:00Z',
  credentialSubject: {
    product: { id: 'https://supplier.example/products/recovered', name: 'Recovered battery' },
  },
};

function compactJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function envelopedCredential(payload: object): Record<string, unknown> {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: `data:application/vc+jwt,${compactJwt(payload)}`,
  };
}

const RECOVERY_TEXT = JSON.stringify(envelopedCredential(RECOVERY_DPP));
const RECOVERY_JWT = (envelopedCredential(RECOVERY_DPP).id as string).split(',')[1];
const DETAILS = {
  name: 'Re-verification credential',
  issuerName: 'Supplier Ltd',
  issuerDid: 'did:web:supplier.example',
  subjectName: 'Battery pack',
  subjectId: 'https://supplier.example/products/1',
  validFrom: new Date('2026-07-22T10:00:00.000Z'),
  validUntil: null,
};
const COMPLETE_CHECKS = {
  retrieval: CheckResult.PASS,
  decryption: CheckResult.NOT_RUN,
  digest: CheckResult.PASS,
  proof: CheckResult.PASS,
  status: CheckResult.PASS,
  temporal: CheckResult.PASS,
  schemaConformance: CheckResult.NOT_RUN,
};

const VCDM_CONTEXT_URL = 'https://www.w3.org/ns/credentials/v2';
const UNTP_070_CONTEXT_URL = 'https://vocabulary.uncefact.org/untp/0.7.0/context/';
const DPP_070_SCHEMA_URL = 'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json';

const prisma = createRigClient();
let fixtures: FixtureServer;
let bundledFallbackFailuresRemaining = 0;
const externalFixtureMap = new Map<string, string>();
const fixtureServerRequests: Array<{ requestedUrl: string; fixtureUrl: string }> = [];
const realFetch = globalThis.fetch.bind(globalThis);
let recoveryStorageSequence = 0;
const senderErrors: Error[] = [];
const sweepErrors: Error[] = [];
const senderQueue = new PgBossJobQueue({
  connectionString: process.env.RI_DATABASE_URL as string,
  onError: (error) => senderErrors.push(error),
});
const sweepQueue = new PgBossJobQueue({
  connectionString: process.env.RI_DATABASE_URL as string,
  onError: (error) => sweepErrors.push(error),
});

function context(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: randomUUID(),
    attempt: 1,
    isFinalAttempt: false,
    signal: new AbortController().signal,
    ...overrides,
    expireSeconds: overrides.expireSeconds ?? 300,
  };
}

function artefactFixture(relativePath: string): string {
  return readFileSync(path.resolve(__dirname, '../../../untp-utils/artefacts', relativePath), 'utf8');
}

function registerSchemaAndContextFixtures(): void {
  externalFixtureMap.clear();
  fixtures.set('/remote/schema/untp/0.7.0/dpp.json', {
    body: artefactFixture('schema/untp/0.7.0/dpp.json'),
  });
  fixtures.set('/remote/schema/untp/0.6.0/dpp.json', {
    body: artefactFixture('schema/untp/0.6.0/dpp.json'),
  });
  fixtures.set('/remote/context/vcdm/2/credentials.json', {
    body: artefactFixture('context/vcdm/2/credentials.json'),
  });
  fixtures.set('/remote/context/untp/0.7.0/untp.json', {
    body: artefactFixture('context/untp/0.7.0/untp.json'),
  });
  fixtures.set('/remote/context/untp/0.6.0/dpp.json', {
    body: artefactFixture('context/untp/0.6.0/dpp.json'),
  });
  fixtures.set('/remote/context/third-valid.json', {
    body: JSON.stringify({ '@context': { thirdTerm: 'https://example.org/terms/thirdTerm' } }),
  });
  fixtures.set('/remote/context/private-ref.json', {
    body: JSON.stringify({ '@context': { privateRef: { '@id': 'https://example.org/terms/privateRef' } } }),
  });
  fixtures.set('/remote/context/third-malformed.json', {
    body: JSON.stringify({ '@context': { thirdTerm: { '@id': 'https://example.org/terms/thirdTerm', '@type': 42 } } }),
  });
  fixtures.set('/remote/context/third-scoped.json', {
    body: JSON.stringify({
      '@context': {
        scopedTerm: {
          '@id': 'https://example.org/terms/scopedTerm',
          '@context': THIRD_MISSING_SCOPED_CONTEXT,
        },
      },
    }),
  });
  fixtures.set('/remote/context/missing-scoped.json', { body: 'missing', status: 404 });
  fixtures.set('/remote/core-host-failure.json', { body: 'temporarily unavailable', status: 503 });

  externalFixtureMap.set(DPP_070_SCHEMA_URL, '/remote/schema/untp/0.7.0/dpp.json');
  externalFixtureMap.set(VCDM_CONTEXT_URL, '/remote/context/vcdm/2/credentials.json');
  externalFixtureMap.set(UNTP_070_CONTEXT_URL, '/remote/context/untp/0.7.0/untp.json');
  externalFixtureMap.set(
    'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.0.json',
    '/remote/schema/untp/0.6.0/dpp.json',
  );
  externalFixtureMap.set('https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/', '/remote/context/untp/0.6.0/dpp.json');
  externalFixtureMap.set(
    'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/context/',
    '/remote/context/untp/0.6.0/dpp.json',
  );
  externalFixtureMap.set(THIRD_VALID_CONTEXT, '/remote/context/third-valid.json');
  externalFixtureMap.set(THIRD_MALFORMED_CONTEXT, '/remote/context/third-malformed.json');
  externalFixtureMap.set(THIRD_SCOPED_CONTEXT, '/remote/context/third-scoped.json');
  externalFixtureMap.set(THIRD_MISSING_SCOPED_CONTEXT, '/remote/context/missing-scoped.json');
  externalFixtureMap.set(PRIVATE_REF_CONTEXT_URL, '/remote/context/private-ref.json');
}

function fixtureUrlForExternalRequest(requestUrl: string): string {
  const parsed = new URL(requestUrl);
  if (parsed.origin === fixtures.baseUrl) return requestUrl;
  const fixturePath = externalFixtureMap.get(parsed.href);
  if (fixturePath !== undefined) return `${fixtures.baseUrl}${fixturePath}`;
  throw new Error(`integration fixture attempted an unmapped network request: ${requestUrl}`);
}

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function installFixtureFetch(): void {
  globalThis.fetch = (async (input, init) => {
    const requestUrl = requestUrlOf(input);
    const isCoreArtefact =
      requestUrl === VCDM_CONTEXT_URL || requestUrl === UNTP_070_CONTEXT_URL || requestUrl === DPP_070_SCHEMA_URL;
    let fixtureUrl: string;
    if (isCoreArtefact && bundledFallbackFailuresRemaining > 0) {
      bundledFallbackFailuresRemaining -= 1;
      fixtureUrl = `${fixtures.baseUrl}/remote/core-host-failure.json`;
    } else {
      fixtureUrl = fixtureUrlForExternalRequest(requestUrl);
    }
    fixtureServerRequests.push({ requestedUrl: requestUrl, fixtureUrl });
    return realFetch(fixtureUrl, init);
  }) as typeof globalThis.fetch;
}

function verificationHandler(verifier: IVerifiableCredentialService) {
  const schemaConformanceDependencies: SchemaConformanceCheckDependencies = {
    schemaLoader: createSchemaLoader(createInMemoryTtlCache<object>({ ttlMs: 60_000 }), bundledArtefactsFallback),
    contextCache: createInMemoryTtlCache<LoadedRemoteDocument>({ ttlMs: 60_000 }),
    bundledArtefactsFallback,
    logger: apiLogger.child({ module: 'schema-conformance-integration' }),
  };
  return verifyGenerationHandler({
    ...defaultVerifyGenerationDependencies(),
    checkSchemaConformance: (input) => checkSchemaConformance(input, schemaConformanceDependencies),
    resolveVerifier: async () => verifier,
  });
}

function enqueue(sql: Parameters<typeof senderQueue.enqueueWithin>[0], job: VerifyJobReference): Promise<void> {
  return senderQueue.enqueueWithin(sql, LIBRARY_VERIFY_JOB, job, VERIFY_JOB_ENQUEUE_OPTIONS);
}

/** The module readies its enqueue only once it has decided to create a generation. */
const prepareEnqueue = async () => enqueue;

async function digest(bytes: Uint8Array): Promise<string> {
  return (
    await MultibaseDigest.fromData(bytes, {
      algorithm: 'sha2-256',
      base: 'base58btc',
    })
  ).toString();
}

function recoveryStorage(options: { failStore?: boolean } = {}): IStorageService {
  const store = async (credential: Record<string, unknown>): Promise<StorageRecord> => {
    if (options.failStore) throw new Error('storage unavailable');
    const bytes = new TextEncoder().encode(JSON.stringify(credential));
    const path = `/storage/recovered-${++recoveryStorageSequence}.json`;
    fixtures.set(path, { body: encryptedBody(bytes, RECEIVER_KEY) });
    return {
      uri: `${fixtures.baseUrl}${path}`,
      digestMultibase: await digest(bytes),
      decryptionKey: RECEIVER_KEY,
      externalId: path,
      bucket: 'private',
      mimeType: 'application/json',
    };
  };
  const storeBinary = async (
    content: string | Uint8Array,
    _filename: string,
    contentType: string,
    encrypt = false,
  ): Promise<StorageRecord> => {
    if (options.failStore) throw new Error('storage unavailable');
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const path = `/storage/recovered-${++recoveryStorageSequence}.bin`;
    fixtures.set(path, {
      body: encrypt ? encryptedBody(Buffer.from(bytes).toString('base64'), RECEIVER_KEY) : Buffer.from(bytes),
      contentType,
    });
    return {
      uri: `${fixtures.baseUrl}${path}`,
      digestMultibase: await digest(bytes),
      ...(encrypt ? { decryptionKey: RECEIVER_KEY } : {}),
      externalId: path,
      bucket: encrypt ? 'private' : 'public',
      mimeType: contentType,
    };
  };
  return { store, storeBinary, delete: async () => undefined };
}

function sourceFetcher(): (href: string) => Promise<FetchedDocument> {
  return (href) => fetchCredentialDocument(href, { maxBytes: getMaxCredentialSize(), timeoutMs: 10_000 });
}

/**
 * The custody tuple a reservation would observe for this record right now,
 * read from the row rather than restated, so a raw-choreography test states
 * the fence the production caller would have taken from its own reservation.
 */
async function custodyOf(recordId: string) {
  const record = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
  if (record?.origin !== 'EXTERNAL') throw new Error(`expected an external record for ${recordId}`);
  return {
    storageUri: record.external.storageUri,
    storageDigestMultibase: record.external.storageDigestMultibase,
    storageExternalId: record.external.storageExternalId,
    decryptionKeyPresent: record.external.decryptionKey !== null,
    encrypted: record.external.encrypted,
  };
}

function recoveryRunner(
  storage: IStorageService,
  fetchSource = sourceFetcher(),
  registerOverrides: Partial<RegisterExternalCredentialDependencies> = {},
) {
  const registerDependencies = defaultRegisterDependencies(async () => undefined);
  return {
    fetchSource,
    recoverInRequest: (
      input: AcquiredCredentialInput | RegisterExternalCredentialInput,
      options: RecoverFromSourceOptions | RecoverFromStoredCopyOptions,
    ) => {
      const deps = {
        ...registerDependencies,
        fetchDocument: fetchSource,
        resolveStorage: async () => ({ service: storage, instanceId: 'recovery-storage' }),
        findExistingExternal: findExternalByContentDigest,
        ...registerOverrides,
      };
      return options.acquisition.from === 'stored-copy'
        ? settleInRequest(input, deps, options as RecoverFromStoredCopyOptions)
        : settleInRequest(input as RegisterExternalCredentialInput, deps, options as RecoverFromSourceOptions);
    },
  };
}

async function insertNoCopyExternal(options: {
  sourcePath: string;
  sourceDigest?: string;
  contentDigest?: string;
  duplicateOfRecordId?: string;
  failureCode?: CheckRunFailureCode;
  /** An encrypted no-copy record, from an AES envelope whose store failed. */
  encrypted?: boolean;
  /** A record whose details were already extracted before the copy went missing. */
  details?: Parameters<typeof createExternalCredential>[0]['details'];
}): Promise<string> {
  const failureCode = options.failureCode ?? CheckRunFailureCode.RETRIEVAL_FAILED;
  const created = await createExternalCredential({
    tenantId: SYSTEM_TENANT_ID,
    sourceUrl: `${fixtures.baseUrl}${options.sourcePath}`,
    ...(options.sourceDigest === undefined ? {} : { sourceDigest: options.sourceDigest }),
    ...(options.contentDigest === undefined ? {} : { contentDigest: options.contentDigest }),
    ...(options.duplicateOfRecordId === undefined ? {} : { duplicateOfRecordId: options.duplicateOfRecordId }),
    ...(options.encrypted !== undefined
      ? { encrypted: options.encrypted, contentKind: ExternalContentKind.CREDENTIAL }
      : options.sourceDigest === undefined
        ? { encrypted: null }
        : { encrypted: false, contentKind: ExternalContentKind.CREDENTIAL }),
    annotations: { displayName: 'Recovery fixture', declaredCredentialType: CoreCredentialType.DPP },
    details: options.details ?? { status: CredentialDetailsStatus.EXTRACTION_PENDING },
    checkRun: {
      state: CheckRunState.FAILED,
      checks: { retrieval: failureCode === CheckRunFailureCode.RETRIEVAL_FAILED ? CheckResult.FAIL : CheckResult.PASS },
      failure: { code: failureCode, message: 'initial durable copy was unavailable', retryable: true },
    },
  });
  return created.record.id;
}

async function insertUnopenedExternal(options: {
  sourcePath: string;
  storagePath: string;
  ciphertext: Uint8Array;
  pending?: boolean;
}): Promise<{ recordId: string; storageDigest: string; sourceDigest: string }> {
  const storageDigest = await digest(options.ciphertext);
  const created = await createExternalCredential({
    tenantId: SYSTEM_TENANT_ID,
    sourceUrl: `${fixtures.baseUrl}${options.sourcePath}`,
    sourceDigest: storageDigest,
    encrypted: true,
    contentKind: ExternalContentKind.CREDENTIAL,
    storage: {
      uri: `${fixtures.baseUrl}${options.storagePath}`,
      digestMultibase: storageDigest,
      serviceInstanceId: 'storage-unopened-test',
      externalId: options.storagePath,
      bucket: 'private',
    },
    annotations: { displayName: 'Unopened recovery fixture', declaredCredentialType: CoreCredentialType.DPP },
    details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
    checkRun: options.pending
      ? { state: CheckRunState.PENDING, checks: {}, enqueue: async () => undefined }
      : {
          state: CheckRunState.FAILED,
          checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS, decryption: CheckResult.FAIL },
          failure: {
            code: CheckRunFailureCode.DECRYPTION_REQUIRED,
            message: 'fixture holds unopened ciphertext',
            retryable: true,
          },
        },
  });
  return { recordId: created.record.id, storageDigest, sourceDigest: storageDigest };
}

async function reverifyNoCopy(
  recordId: string,
  storage: IStorageService,
  fetchSource = sourceFetcher(),
  registerOverrides: Partial<RegisterExternalCredentialDependencies> = {},
  decryptionKey?: string,
) {
  const recovery = recoveryRunner(storage, fetchSource, registerOverrides);
  const deps = {
    getRecord: getLibraryRecordById,
    createGeneration: createReverificationGeneration,
    reserveGeneration: reserveRecoveryGeneration,
    finaliseGeneration: finaliseRecoveryGeneration,
    fetchStoredCopy: fetchStoredCopyBytes,
    ...recovery,
  };
  return decryptionKey === undefined
    ? reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue, deps)
    : reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue, decryptionKey, deps);
}

async function jobsFor(recordId: string): Promise<VerifyJobReference[]> {
  const rows = await prisma.$queryRawUnsafe<{ data: VerifyJobReference }[]>(
    `SELECT data FROM pgboss.job WHERE name = $1 AND data->>'recordId' = $2`,
    LIBRARY_VERIFY_JOB,
    recordId,
  );
  return rows.map((row) => row.data);
}

async function insertProtectedExternal(options: {
  sourcePath: string;
  storagePath: string;
  sourceDigest: string;
  storageDigest: string;
  encrypted?: boolean;
  decryptionKey?: string;
  contentKind?: ExternalContentKind;
  coreDataModelVersion?: string;
}): Promise<string> {
  const created = await createExternalCredential({
    tenantId: SYSTEM_TENANT_ID,
    sourceUrl: `${fixtures.baseUrl}${options.sourcePath}`,
    sourceDigest: options.sourceDigest,
    encrypted: options.encrypted ?? false,
    contentKind: options.contentKind ?? ExternalContentKind.CREDENTIAL,
    storage: {
      uri: `${fixtures.baseUrl}${options.storagePath}`,
      digestMultibase: options.storageDigest,
      serviceInstanceId: 'storage-reverify-test',
      externalId: options.storagePath,
      bucket: 'private',
      decryptionKey: (options.decryptionKey ?? protectDecryptionKey(RECEIVER_KEY)) as ProtectedDecryptionKey,
    },
    annotations: {
      displayName: 'Re-verification fixture',
      declaredCredentialType: CoreCredentialType.DPP,
    },
    details: {
      status: CredentialDetailsStatus.EXTRACTED,
      fields: DETAILS,
      credentialType: 'DigitalProductPassport',
      coreCredentialType: CoreCredentialType.DPP,
      coreDataModelVersion: options.coreDataModelVersion ?? '0.6.0',
    },
    checkRun: {
      state: CheckRunState.PENDING,
      checks: COMPLETE_CHECKS,
      enqueue: async () => undefined,
    },
  });
  await prisma.checkRun.update({
    where: { id: created.checkRun.id },
    data: {
      state: CheckRunState.COMPLETE,
      ...COMPLETE_CHECKS,
      completedAt: new Date('2026-09-06T00:00:01.000Z'),
      failureCode: null,
      failureMessage: null,
      failureRetryable: null,
    },
  });
  return created.record.id;
}

/**
 * A real AES-256-GCM envelope in the shape the encryption adapter produces,
 * built here from bytes because the adapter's `encrypt` takes a string and a
 * body that is not valid UTF-8 could not survive that. What is under test is
 * the read path: the worker must return the plaintext bytes it decrypted,
 * not a UTF-8 re-encoding of them.
 */
function encryptedBody(plaintext: string | Uint8Array, key: string): string {
  const bytes = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext;
  const iv = new Uint8Array(randomBytes(12));
  const cipher = createCipheriv('aes-256-gcm', new Uint8Array(Buffer.from(key, 'hex')), iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()] as unknown as Uint8Array[]);
  return JSON.stringify({
    cipherText: encrypted.toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    type: 'aes-256-gcm',
  });
}

/**
 * A stored key envelope whose structure is intact and whose contents will not
 * unwrap, which is what an operator sees after a key is rotated away or an
 * envelope is damaged. The service cannot tell those two apart.
 */
function unopenableKeyEnvelope(): string {
  const envelope = JSON.parse(protectDecryptionKey(RECEIVER_KEY)) as { cipherText: string };
  const first = envelope.cipherText[0];
  return JSON.stringify({ ...envelope, cipherText: `${first === '0' ? '1' : '0'}${envelope.cipherText.slice(1)}` });
}

async function waitFor<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  let value = await read();
  while (!matches(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  if (!matches(value)) throw new Error('Timed out waiting for the integration state to settle');
  return value;
}

/**
 * Polls `pg_stat_activity` for a real backend that Postgres itself reports
 * as currently waiting on a lock while running a statement matching
 * `queryFragment`, rather than sleeping a guessed duration and hoping a
 * concurrent caller has reached that point by then. Used to confirm a second
 * connection is genuinely blocked before releasing the first.
 */
async function waitUntilBackendBlocked(
  client: { $queryRawUnsafe: <T>(sql: string, ...args: unknown[]) => Promise<T> },
  queryFragment: string,
): Promise<void> {
  try {
    await waitFor(
      () =>
        client.$queryRawUnsafe<Array<{ pid: number }>>(
          `SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE $1`,
          `%${queryFragment}%`,
        ),
      (rows) => rows.length > 0,
    );
  } catch {
    throw new Error(`Timed out waiting for a backend blocked on a lock matching: ${queryFragment}`);
  }
}

describe('re-verify a library record through Postgres and pg-boss', () => {
  beforeAll(async () => {
    fixtures = await startFixtureServer();
    registerSchemaAndContextFixtures();
    installFixtureFetch();
    await senderQueue.start();
    await senderQueue.declareQueue(LIBRARY_VERIFY_JOB);
    registerPendingRunReconciliation(sweepQueue, defaultReconcilePendingRunsDependencies());
    await sweepQueue.start();
    await sweepQueue.schedule(LIBRARY_RECONCILE_PENDING_RUNS_JOB, DEFAULT_RECONCILE_PENDING_RUNS_CRON);
  });

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await seedSystemTenant(prisma);
    registerSchemaAndContextFixtures();
    await prisma.$executeRawUnsafe(
      `DELETE FROM pgboss.job WHERE name IN ('${LIBRARY_VERIFY_JOB}', '${LIBRARY_RECONCILE_PENDING_RUNS_JOB}')`,
    );
    fixtures.set('/storage/native.json', { body: DPP_TEXT });
    fixtures.set('/supplier/credential.json', { body: DPP_TEXT });
    fixtures.set('/storage/protected.json', { body: DPP_TEXT });
    senderErrors.splice(0);
    sweepErrors.splice(0);
    capturedLogLines.length = 0;
    fixtureServerRequests.length = 0;
    bundledFallbackFailuresRemaining = 0;
  });

  afterEach(() => {
    // Reset first, before either assertion below can throw: only the default-dependencies case
    // configures this mock, and if either assertion fails without this
    // running first, its configuration survives to leak into the next test,
    // which is exactly the failure this reset exists to close.
    (resolveStorageService as jest.Mock).mockReset();
    expect(senderErrors.splice(0)).toEqual([]);
    expect(sweepErrors.splice(0)).toEqual([]);
  });

  afterAll(async () => {
    await sweepQueue.unschedule(LIBRARY_RECONCILE_PENDING_RUNS_JOB);
    await senderQueue.stop();
    await sweepQueue.stop();
    globalThis.fetch = realFetch;
    await fixtures.close();
    await prisma.$disconnect();
    expect(senderErrors.splice(0)).toEqual([]);
    expect(sweepErrors.splice(0)).toEqual([]);
  });

  it('creates one native generation 2 and the worker settles it from the stored copy', async () => {
    // Fails if native re-verification reuses the issuance assertion, exposes
    // a pending generation with the wrong wire checks, or skips the worker.
    const storageDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const native = await insertNativeCredential(prisma, {
      tenantId: SYSTEM_TENANT_ID,
      storageUri: `${fixtures.baseUrl}/storage/native.json`,
      digestMultibase: storageDigest,
    });

    const created = await reverifyLibraryRecord(native.id, SYSTEM_TENANT_ID, prepareEnqueue);
    expect(created).toMatchObject({ outcome: 'created', generation: 2 });
    const pending = await getLibraryRecordById(native.id, SYSTEM_TENANT_ID);
    expect(pending).not.toBeNull();
    expect(toNativeCredentialRecord(pending as never).verification).toMatchObject({
      generation: 2,
      state: 'pending',
      checks: { retrieval: 'not_run', decryption: 'not_run', digest: 'not_run' },
    });

    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    const handler = verificationHandler(verifier);
    const [job] = await jobsFor(native.id);
    await handler(job, context());

    const settled = await getLibraryRecordById(native.id, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({ state: CheckRunState.COMPLETE, generation: 2 });
    expect(toNativeCredentialRecord(settled as never).verification).toMatchObject({
      state: 'complete',
      summary: 'verified',
      checks: { retrieval: 'not_run', decryption: 'not_run', digest: 'not_run', proof: 'pass' },
    });
  });

  it('falls back to the bundled schema and contexts after three core host failures', async () => {
    // Fails if the real resolver path is bypassed, if a host-delivery failure
    // is not replaced by the matching bundled artefact, or if fallback is
    // attempted for fewer than the schema and two core context requests.
    const fallbackUrls = [DPP_070_SCHEMA_URL, VCDM_CONTEXT_URL, UNTP_070_CONTEXT_URL];
    fallbackUrls.forEach((url) => externalFixtureMap.delete(url));
    bundledFallbackFailuresRemaining = 3;
    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    const handler = verificationHandler(verifier);
    const envelope = envelopedCredential(DPP_070);
    const body = JSON.stringify(envelope);
    const storagePath = '/storage/schema-conformance-bundled.json';
    const sourcePath = '/supplier/schema-conformance-bundled.json';
    fixtures.set(storagePath, { body });
    fixtures.set(sourcePath, { body });
    const copyDigest = await digest(new TextEncoder().encode(body));
    const recordId = await insertProtectedExternal({
      sourcePath,
      storagePath,
      sourceDigest: copyDigest,
      storageDigest: copyDigest,
      coreDataModelVersion: '0.7.0',
    });

    await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
    await handler((await jobsFor(recordId))[0], context({ isFinalAttempt: true }));

    const settled = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({ state: CheckRunState.COMPLETE, schemaConformance: CheckResult.PASS });
    const fallbackRequests = fixtureServerRequests.filter(({ requestedUrl }) => fallbackUrls.includes(requestedUrl));
    expect(fallbackRequests).toHaveLength(3);
    expect(fallbackRequests).toEqual(
      expect.arrayContaining(
        fallbackUrls.map((requestedUrl) => ({
          requestedUrl,
          fixtureUrl: `${fixtures.baseUrl}/remote/core-host-failure.json`,
        })),
      ),
    );
    const fallbackLogs = capturedLogLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) =>
        String(line.msg).startsWith('Served the bundled copy of a UNTP artefact because its fetch failed'),
      );
    expect(fallbackLogs).toHaveLength(3);
    expect(fallbackLogs.map((line) => line.url)).toEqual(
      expect.arrayContaining([DPP_070_SCHEMA_URL, VCDM_CONTEXT_URL, UNTP_070_CONTEXT_URL]),
    );
  });

  it('fails a 0.7.0 credential that declares the legacy context at the context pointer', async () => {
    // Fails if schema conformance ignores the credential's declared context
    // contract or reports the legacy-context mismatch as an unavailable host.
    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    const handler = verificationHandler(verifier);
    const credential = { ...DPP_070, '@context': [DPP_070['@context'][0], LEGACY_CONTEXT_070] };
    const envelope = envelopedCredential(credential);
    const body = JSON.stringify(envelope);
    const storagePath = '/storage/schema-conformance-legacy-context.json';
    const sourcePath = '/supplier/schema-conformance-legacy-context.json';
    fixtures.set(storagePath, { body });
    fixtures.set(sourcePath, { body });
    const copyDigest = await digest(new TextEncoder().encode(body));
    const recordId = await insertProtectedExternal({
      sourcePath,
      storagePath,
      sourceDigest: copyDigest,
      storageDigest: copyDigest,
      coreDataModelVersion: '0.7.0',
    });

    await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
    await handler((await jobsFor(recordId))[0], context({ isFinalAttempt: true }));

    const settled = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({
      state: CheckRunState.COMPLETE,
      schemaConformance: CheckResult.FAIL,
      schemaConformanceMessage: expect.stringContaining('/@context/1'),
    });
  });

  it('passes a valid remote third context and fails a malformed one as the documented classifier residual', async () => {
    // Fails if extra remote contexts are not expanded, or if the accepted
    // malformed-remote-context classifier residual changes its advisory arm.
    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    const cases = [
      {
        name: 'third-valid',
        contextUrl: THIRD_VALID_CONTEXT,
        expected: CheckResult.PASS,
        subject: { thirdTerm: 'present' },
      },
      {
        name: 'third-malformed',
        contextUrl: THIRD_MALFORMED_CONTEXT,
        expected: CheckResult.FAIL,
        subject: {},
      },
    ];

    for (const testCase of cases) {
      const handler = verificationHandler(verifier);
      const credential = {
        ...DPP_070,
        '@context': [...DPP_070['@context'], testCase.contextUrl],
        credentialSubject: { ...DPP_070.credentialSubject, ...testCase.subject },
      };
      const envelope = envelopedCredential(credential);
      const body = JSON.stringify(envelope);
      const storagePath = `/storage/schema-conformance-${testCase.name}.json`;
      const sourcePath = `/supplier/schema-conformance-${testCase.name}.json`;
      fixtures.set(storagePath, { body });
      fixtures.set(sourcePath, { body });
      const copyDigest = await digest(new TextEncoder().encode(body));
      const recordId = await insertProtectedExternal({
        sourcePath,
        storagePath,
        sourceDigest: copyDigest,
        storageDigest: copyDigest,
        coreDataModelVersion: '0.7.0',
      });

      await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
      await handler((await jobsFor(recordId))[0], context({ isFinalAttempt: true }));

      const settled = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
      expect(settled?.checkRun).toMatchObject({ state: CheckRunState.COMPLETE, schemaConformance: testCase.expected });
    }
  });

  it('fails a valid 0.7.0 DPP with a relative private reference without persisting or logging its value', async () => {
    // Fails if the classifier's formatted relative-id detail reaches the
    // persisted advisory or a rendered log line.
    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    const handler = verificationHandler(verifier);
    const credential = {
      ...DPP_070,
      '@context': [...DPP_070['@context'], PRIVATE_REF_CONTEXT_URL],
      credentialSubject: {
        ...DPP_070.credentialSubject,
        privateRef: { '@id': 'customer-private/order-secret', name: 'Example' },
      },
    };
    const envelope = envelopedCredential(credential);
    const body = JSON.stringify(envelope);
    const storagePath = '/storage/schema-conformance-private-ref.json';
    const sourcePath = '/supplier/schema-conformance-private-ref.json';
    fixtures.set(storagePath, { body });
    fixtures.set(sourcePath, { body });
    const copyDigest = await digest(new TextEncoder().encode(body));
    const recordId = await insertProtectedExternal({
      sourcePath,
      storagePath,
      sourceDigest: copyDigest,
      storageDigest: copyDigest,
      coreDataModelVersion: '0.7.0',
    });

    await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
    await handler((await jobsFor(recordId))[0], context({ isFinalAttempt: true }));

    const settled = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({
      state: CheckRunState.COMPLETE,
      schemaConformance: CheckResult.FAIL,
      schemaConformanceMessage: 'Relative @id reference found. (relative @id reference)',
    });
    expect(settled?.checkRun?.schemaConformanceMessage).not.toContain('order-secret');
    const advisory = toCredentialRecord(settled as never).warnings.find(
      (warning) => warning.code === 'SCHEMA_CONFORMANCE_ADVISORY',
    );
    expect(advisory).toEqual({
      code: 'SCHEMA_CONFORMANCE_ADVISORY',
      message: 'Relative @id reference found. (relative @id reference)',
    });
    expect(capturedLogLines.every((line) => !line.includes('order-secret'))).toBe(true);
  });

  it('keeps a scoped-context fetch failure not_run and logs no URL path', async () => {
    // Fails if a scoped context loader failure is treated as a document fail,
    // or if its diagnostic logs the caller-controlled URL path.
    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    const handler = verificationHandler(verifier);
    const credential = {
      ...DPP_070,
      '@context': [...DPP_070['@context'], THIRD_SCOPED_CONTEXT],
      credentialSubject: { ...DPP_070.credentialSubject, scopedTerm: 'present' },
    };
    const envelope = envelopedCredential(credential);
    const body = JSON.stringify(envelope);
    const storagePath = '/storage/schema-conformance-scoped-context.json';
    const sourcePath = '/supplier/schema-conformance-scoped-context.json';
    fixtures.set(storagePath, { body });
    fixtures.set(sourcePath, { body });
    const copyDigest = await digest(new TextEncoder().encode(body));
    const recordId = await insertProtectedExternal({
      sourcePath,
      storagePath,
      sourceDigest: copyDigest,
      storageDigest: copyDigest,
      coreDataModelVersion: '0.7.0',
    });

    await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
    await handler((await jobsFor(recordId))[0], context({ isFinalAttempt: true }));

    const settled = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({ state: CheckRunState.COMPLETE, schemaConformance: CheckResult.NOT_RUN });
    const contextFailure = capturedLogLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'JSON-LD context could not be obtained or used for schema conformance');
    expect(contextFailure).toMatchObject({ stage: 'JSON-LD' });
    expect(contextFailure).not.toHaveProperty('url');
    expect(JSON.stringify(contextFailure)).not.toContain('/contexts/missing-scoped.json');
  });

  it('runs verifier checks for a native UNREADABLE_ENVELOPE record while schema conformance is not_run', async () => {
    // Fails if native extraction failure prevents the verifier checks from
    // being recorded, or if schema conformance decodes a credential whose
    // stored details explicitly say its envelope was unreadable.
    const malformedEnvelope = { type: ['NotAVerifiableCredential'], id: 'https://example.org/malformed' };
    const body = JSON.stringify(malformedEnvelope);
    const storagePath = '/storage/native-unreadable-envelope.json';
    fixtures.set(storagePath, { body });
    const native = await insertNativeCredential(prisma, {
      storageUri: `${fixtures.baseUrl}${storagePath}`,
      digestMultibase: await digest(new TextEncoder().encode(body)),
      coreCredentialType: CoreCredentialType.DPP,
      coreDataModelVersion: '0.7.0',
      detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED,
      detailsError: CredentialDetailsError.UNREADABLE_ENVELOPE,
    });
    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: false, error: { type: 'integrity' } }),
    };
    const handler = verificationHandler(verifier);

    await reverifyLibraryRecord(native.id, SYSTEM_TENANT_ID, prepareEnqueue);
    await handler((await jobsFor(native.id))[0], context({ isFinalAttempt: true }));

    const settled = await getLibraryRecordById(native.id, SYSTEM_TENANT_ID);
    expect(settled?.record).toMatchObject({
      detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED,
      detailsError: CredentialDetailsError.UNREADABLE_ENVELOPE,
    });
    expect(toNativeCredentialRecord(settled as never).verification).toMatchObject({
      state: 'complete',
      checks: {
        retrieval: 'not_run',
        digest: 'not_run',
        proof: 'fail',
        status: 'not_run',
        temporal: 'not_run',
        schemaConformance: 'not_run',
      },
    });
    expect(verifier.verify).toHaveBeenCalledTimes(1);
  });

  it('settles a conforming 0.7.0 DPP as pass and a missing-name DPP as an advisory fail', async () => {
    // Fails if the worker skips the core schema, checks a tenant data-model
    // row instead of the system schema, or lets the advisory result change
    // the verified summary. The second copy proves the first schema pointer
    // is persisted and projected as the warning's message.
    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    const cases = [
      { name: 'conforming', credential: DPP_070, expected: CheckResult.PASS, message: null },
      {
        name: 'missing-name',
        credential: { ...DPP_070, name: undefined },
        expected: CheckResult.FAIL,
        message: "/ (must have required property 'name')",
      },
      {
        name: 'nested-wrong-type',
        credential: {
          ...DPP_070,
          credentialSubject: { ...DPP_070.credentialSubject, name: 42 },
        },
        expected: CheckResult.FAIL,
        message: '/credentialSubject/name (must be string)',
      },
    ];

    for (const testCase of cases) {
      const handler = verificationHandler(verifier);
      const envelope = envelopedCredential(testCase.credential);
      const body = JSON.stringify(envelope);
      const storagePath = `/storage/schema-conformance-${testCase.name}.json`;
      const sourcePath = `/supplier/schema-conformance-${testCase.name}.json`;
      fixtures.set(storagePath, { body });
      fixtures.set(sourcePath, { body });
      const copyDigest = await digest(new TextEncoder().encode(body));
      const recordId = await insertProtectedExternal({
        sourcePath,
        storagePath,
        sourceDigest: copyDigest,
        storageDigest: copyDigest,
        coreDataModelVersion: '0.7.0',
      });
      await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
      await handler((await jobsFor(recordId))[0], context({ isFinalAttempt: true }));

      const settled = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
      expect(settled?.checkRun).toMatchObject({
        state: CheckRunState.COMPLETE,
        schemaConformance: testCase.expected,
      });
      const projected = toCredentialRecord(settled as never);
      expect(projected.verification.summary).toBe('verified');
      if (testCase.expected === CheckResult.FAIL) {
        expect(projected.warnings).toContainEqual({
          code: 'SCHEMA_CONFORMANCE_ADVISORY',
          message: testCase.message,
        });
      } else {
        expect(projected.warnings).not.toContainEqual(expect.objectContaining({ code: 'SCHEMA_CONFORMANCE_ADVISORY' }));
      }
    }
  });

  it('serialises two concurrent module calls into one pending generation and one job', async () => {
    // The unique indexes carry this outcome: whichever transaction inserts
    // second violates the pending index or the record-and-generation key, and
    // the repository maps that to a join. The parent lock serialises the
    // recheck, and its own effect is exercised by the preparation-race tests
    // below. Fails if two callers can append competing generations.
    const storageDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const native = await insertNativeCredential(prisma, {
      storageUri: `${fixtures.baseUrl}/storage/native.json`,
      digestMultibase: storageDigest,
    });

    const results = await Promise.all([
      reverifyLibraryRecord(native.id, SYSTEM_TENANT_ID, prepareEnqueue),
      reverifyLibraryRecord(native.id, SYSTEM_TENANT_ID, prepareEnqueue),
    ]);
    expect(results.filter((result) => result.outcome === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.outcome === 'joined')).toHaveLength(1);
    expect(await prisma.checkRun.count({ where: { recordId: native.id } })).toBe(1);
    expect(await jobsFor(native.id)).toHaveLength(1);
  });

  it('two concurrent no-copy recoveries join one reservation, so only one fetch and one store happen', async () => {
    // Criterion 5 for the no-copy branch specifically: the reservation is
    // the claim, so a concurrent caller must join it rather than starting a
    // second fetch. Fails if both callers reach `settleInRequest` and store
    // a copy each.
    fixtures.set('/supplier/recovery-concurrent.json', { body: RECOVERY_TEXT });
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-concurrent.json' });
    let fetches = 0;
    const countingFetch = (href: string) => {
      fetches += 1;
      return sourceFetcher()(href);
    };
    const storage = recoveryStorage();

    const results = await Promise.all([
      reverifyNoCopy(recordId, storage, countingFetch),
      reverifyNoCopy(recordId, storage, countingFetch),
    ]);

    expect(results.filter((result) => result.outcome === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.outcome === 'joined')).toHaveLength(1);
    expect(fetches).toBe(1);
    expect(await prisma.checkRun.count({ where: { recordId } })).toBe(2);
    expect(await jobsFor(recordId)).toHaveLength(1);
  });

  it('re-fetches a no-copy record, replaces custody and verifies the new copy', async () => {
    // Fails if the ticket criterion remains on the old stub, if custody and
    // the generation are committed separately, or if the worker cannot read
    // the copy produced by the request-side recovery.
    fixtures.set('/supplier/recovery-success.json', { body: RECOVERY_TEXT });
    const sourceDigest = await digest(new TextEncoder().encode(RECOVERY_TEXT));
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-success.json' });
    const storage = recoveryStorage();

    const created = await reverifyNoCopy(recordId, storage);

    expect(created).toMatchObject({ outcome: 'created', generation: 2 });
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(recovered?.origin).toBe('EXTERNAL');
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({
      sourceDigest,
      storageUri: expect.stringContaining('/storage/recovered-'),
      storageDigestMultibase: expect.any(String),
      storageServiceInstanceId: 'recovery-storage',
      storageExternalId: expect.stringContaining('/storage/recovered-'),
      storageBucket: 'private',
      decryptionKey: expect.any(String),
      contentKind: ExternalContentKind.CREDENTIAL,
      contentDigest: await digest(new TextEncoder().encode(RECOVERY_JWT)),
      duplicateOfRecordId: null,
    });
    expect(recovered.record).toMatchObject({
      detailsStatus: CredentialDetailsStatus.EXTRACTED,
      name: 'Recovered battery passport',
      issuerName: 'Supplier Ltd',
      issuerDid: 'did:web:supplier.example',
      subjectName: 'Recovered battery',
      subjectId: 'https://supplier.example/products/recovered',
      credentialType: 'DigitalProductPassport',
      coreCredentialType: CoreCredentialType.DPP,
      coreDataModelVersion: '0.6.0',
      detailsError: null,
    });
    expect(recovered.checkRun).toMatchObject({ state: CheckRunState.PENDING, sourceChanged: null });
    expect(await jobsFor(recordId)).toHaveLength(1);

    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    await verifyGenerationHandler({
      ...defaultVerifyGenerationDependencies(),
      resolveVerifier: async () => verifier,
    })((await jobsFor(recordId))[0], context());

    const settled = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({
      state: CheckRunState.COMPLETE,
      retrieval: CheckResult.PASS,
      digest: CheckResult.PASS,
      proof: CheckResult.PASS,
    });
    expect(verifier.verify).toHaveBeenCalledTimes(1);
  });

  it('re-fetches a duplicate credential and writes a warning pointer to its current holder', async () => {
    // Fails if recovery treats a duplicate as a registration conflict, writes
    // both a pointer and a digest, or omits the consumer-visible warning.
    fixtures.set('/supplier/recovery-duplicate.json', { body: RECOVERY_TEXT });
    const sourceDigest = await digest(new TextEncoder().encode(RECOVERY_TEXT));
    const contentDigest = await digest(new TextEncoder().encode(RECOVERY_JWT));
    const winnerId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-duplicate.json',
      sourceDigest,
      contentDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
    });
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-duplicate.json' });

    await reverifyNoCopy(recordId, recoveryStorage());

    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({ contentDigest: null, duplicateOfRecordId: winnerId });
    expect(toCredentialRecord(recovered as never).warnings).toContainEqual({
      code: 'DUPLICATE_CONTENT',
      message: `The credential content matches record ${winnerId}.`,
      relatedRecordId: winnerId,
    });
    expect(recovered.checkRun.state).toBe(CheckRunState.PENDING);
  });

  it('settles a failed no-copy re-fetch without queueing or changing custody', async () => {
    // Fails if a second source outage becomes a pending generation, clears
    // the old source baseline, or claims a durable copy exists.
    const oldSource = await digest(new TextEncoder().encode('old source bytes'));
    fixtures.set('/supplier/recovery-unavailable.json', { body: 'unavailable', status: 503 });
    const recordId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-unavailable.json',
      sourceDigest: oldSource,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
    });

    const result = await reverifyNoCopy(recordId, recoveryStorage());

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    expect(await jobsFor(recordId)).toHaveLength(0);
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({
      storageUri: null,
      storageDigestMultibase: null,
      sourceDigest: oldSource,
    });
    expect(recovered.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
      failureRetryable: true,
      sourceChanged: null,
      lastSourceCheckAt: expect.any(Date),
    });
  });

  it('records a storage failure after a successful no-copy fetch without queueing', async () => {
    // Fails if storage failure is mistaken for a retrieval failure, if its
    // observed source identity is lost, or if a job is enqueued without a copy.
    fixtures.set('/supplier/recovery-storage-failure.json', { body: RECOVERY_TEXT });
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-storage-failure.json' });

    const result = await reverifyNoCopy(recordId, recoveryStorage({ failStore: true }));

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    expect(await jobsFor(recordId)).toHaveLength(0);
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({
      storageUri: null,
      storageDigestMultibase: null,
      sourceDigest: await digest(new TextEncoder().encode(RECOVERY_TEXT)),
      contentDigest: await digest(new TextEncoder().encode(RECOVERY_JWT)),
    });
    expect(recovered.record.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
    expect(recovered.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
      failureRetryable: true,
    });
  });

  it('rejects with EncryptionUnavailableError when a no-copy fetch opens a credential this service cannot protect, and settles the reservation FAILED with no job', async () => {
    // The encryption preflight throws synchronously, well after the
    // reservation exists, so the failure must not strand that reservation
    // PENDING: it settles FAILED, custody stays untouched (no store was ever
    // attempted), and the next verify reserves a fresh generation rather than
    // joining a stuck one.
    fixtures.set('/supplier/recovery-encryption-unavailable.json', { body: RECOVERY_TEXT });
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-encryption-unavailable.json' });
    const preflightCause = new Error('encryption key unavailable');
    const assertEncryptionReady = () => {
      throw preflightCause;
    };

    await expect(
      reverifyNoCopy(recordId, recoveryStorage(), sourceFetcher(), { assertEncryptionReady }),
    ).rejects.toThrow(EncryptionUnavailableError);

    expect(await jobsFor(recordId)).toHaveLength(0);
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({
      storageUri: null,
      storageDigestMultibase: null,
      storageExternalId: null,
      contentDigest: null,
    });
    expect(recovered.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      generation: 2,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
      failureRetryable: true,
    });

    const next = await reverifyNoCopy(recordId, recoveryStorage());
    expect(next).toMatchObject({ outcome: 'created', generation: 3 });
  });

  it('case (c): a never-opened ciphertext with no identity is stored as fetched', async () => {
    // The synchronous 400 refusal for a no-copy encrypted record is
    // withdrawn: this fetch runs and stores the ciphertext exactly as
    // registration would, because the row holds no identity for a fetched
    // ciphertext to jeopardise. A later bodyless call then meets the
    // stored-ciphertext 400 (criterion 6), which is not this test's concern.
    fixtures.set('/supplier/recovery-no-identity-ciphertext.json', {
      body: encryptedBody(RECOVERY_TEXT, RECEIVER_KEY),
    });
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-no-identity-ciphertext.json' });

    const result = await reverifyNoCopy(recordId, recoveryStorage());

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    expect(await jobsFor(recordId)).toHaveLength(0);
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({ storageUri: expect.any(String), decryptionKey: null, encrypted: true });
    expect(recovered.record.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_PENDING);
    expect(recovered.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.DECRYPTION_REQUIRED,
    });
  });

  it('case (b), envelope: a fetch that cannot open on an identity-holding row is refused, not replaced, and nothing is stored', async () => {
    // The row already holds a content identity from an earlier successful
    // recovery. Fetching unopened ciphertext this time must not release that
    // identity or its details: it settles FAILED and preserves everything.
    // The reservation snapshot already holds an identity, so the pipeline
    // skips storing this response entirely: no copy is written and nothing
    // is left for an operator to clean up, closing the sequential leak a
    // permanently-wrong source used to create on every re-verify.
    const heldDigest = await digest(new TextEncoder().encode('held source bytes'));
    const heldContentDigest = await digest(new TextEncoder().encode('held-content'));
    fixtures.set('/supplier/recovery-reject-envelope.json', { body: encryptedBody(RECOVERY_TEXT, RECEIVER_KEY) });
    const recordId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-reject-envelope.json',
      sourceDigest: heldDigest,
      contentDigest: heldContentDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
      details: {
        status: CredentialDetailsStatus.EXTRACTED,
        fields: DETAILS,
        credentialType: 'DigitalProductPassport',
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.6.0',
      },
    });

    const result = await reverifyNoCopy(recordId, recoveryStorage());

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    expect(await jobsFor(recordId)).toHaveLength(0);
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({
      storageUri: null,
      contentDigest: heldContentDigest,
      sourceDigest: heldDigest,
    });
    expect(recovered.record).toMatchObject({ detailsStatus: CredentialDetailsStatus.EXTRACTED, ...DETAILS });
    expect(recovered.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.DECRYPTION_REQUIRED,
    });
    const orphan = capturedLogLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'Prepared recovery copy is orphaned and needs operator cleanup');
    expect(orphan).toBeUndefined();
  });

  it('case (b), non-credential: a fetch that returns an unrelated JSON body on an identity-holding row is refused as SOURCE_NOT_CREDENTIAL', async () => {
    const heldDigest = await digest(new TextEncoder().encode('held source bytes 2'));
    const heldContentDigest = await digest(new TextEncoder().encode('held-content-2'));
    fixtures.set('/supplier/recovery-reject-html.json', { body: '<html>not a credential</html>' });
    const recordId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-reject-html.json',
      sourceDigest: heldDigest,
      contentDigest: heldContentDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
      details: {
        status: CredentialDetailsStatus.EXTRACTED,
        fields: DETAILS,
        credentialType: 'DigitalProductPassport',
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.6.0',
      },
    });

    const result = await reverifyNoCopy(recordId, recoveryStorage());

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    expect(await jobsFor(recordId)).toHaveLength(0);
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({ storageUri: null, contentDigest: heldContentDigest });
    expect(recovered.record).toMatchObject({ detailsStatus: CredentialDetailsStatus.EXTRACTED, ...DETAILS });
    expect(recovered.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL,
    });
  });

  it('case (a): re-opening the credential the row already holds keeps its identity and replaces custody and details', async () => {
    // The row already holds the exact content identity a fresh fetch of the
    // same credential produces. No holder lookup or promotion is needed;
    // custody and details still replace from the new fetch.
    fixtures.set('/supplier/recovery-same-credential.json', { body: RECOVERY_TEXT });
    const sourceDigest = await digest(new TextEncoder().encode(RECOVERY_TEXT));
    const contentDigest = await digest(new TextEncoder().encode(RECOVERY_JWT));
    const recordId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-same-credential.json',
      sourceDigest: await digest(new TextEncoder().encode('a different earlier source')),
      contentDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
    });

    const result = await reverifyNoCopy(recordId, recoveryStorage());

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({
      sourceDigest,
      contentDigest,
      duplicateOfRecordId: null,
      storageUri: expect.stringContaining('/storage/recovered-'),
    });
    expect(recovered.record.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
    expect(recovered.checkRun.state).toBe(CheckRunState.PENDING);
  });

  it('the 400 refusal is kept for a row that already holds unopened ciphertext (an existing durable copy)', async () => {
    // Unlike the no-copy cases above, this row already has a durable copy:
    // that is the case the synchronous refusal still covers.
    const sourceDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const recordId = await insertProtectedExternal({
      sourcePath: '/supplier/credential.json',
      storagePath: '/storage/protected.json',
      sourceDigest,
      storageDigest: sourceDigest,
      encrypted: true,
    });
    await prisma.externalCredential.update({
      where: { id_tenantId_origin: { id: recordId, tenantId: SYSTEM_TENANT_ID, origin: 'EXTERNAL' } },
      data: { decryptionKey: null },
    });

    await expect(reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue)).rejects.toBeInstanceOf(
      DecryptionRequiredError,
    );
    expect(await prisma.checkRun.count({ where: { recordId } })).toBe(1);
  });

  it('opens an unopened stored copy with the supplied key, retaining it on a wrong key and replacing custody on success', async () => {
    // Fails if a key-bearing recovery fetches the supplier instead of the
    // reserved copy, uploads before decrypting, loses the raw copy after a
    // wrong key, or replaces custody outside the finalisation transaction.
    const storagePath = '/storage/unopened-late-key.json';
    const sourcePath = '/supplier/unopened-late-key.json';
    const ciphertext = new TextEncoder().encode(encryptedBody(RECOVERY_TEXT, RECEIVER_KEY));
    fixtures.set(storagePath, { body: Buffer.from(ciphertext) });
    const { recordId, storageDigest, sourceDigest } = await insertUnopenedExternal({
      sourcePath,
      storagePath,
      ciphertext,
    });
    const storage = recoveryStorage();
    const store = jest.spyOn(storage, 'store');
    let sourceFetches = 0;
    const fetchSource = (href: string) => {
      sourceFetches += 1;
      return sourceFetcher()(href);
    };

    const wrong = await reverifyNoCopy(recordId, storage, fetchSource, {}, 'd'.repeat(64));
    expect(wrong).toMatchObject({ outcome: 'created', generation: 2 });
    const wrongState = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (wrongState?.origin !== 'EXTERNAL') throw new Error('expected an external record after wrong-key recovery');
    expect(wrongState.external).toMatchObject({
      storageUri: `${fixtures.baseUrl}${storagePath}`,
      storageDigestMultibase: storageDigest,
      storageExternalId: storagePath,
      decryptionKey: null,
      sourceDigest,
    });
    expect(wrongState.checkRun).toMatchObject({
      generation: 2,
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.DECRYPTION_FAILED,
      failureRetryable: true,
      retrieval: CheckResult.PASS,
      digest: CheckResult.PASS,
      decryption: CheckResult.FAIL,
    });
    expect(store).not.toHaveBeenCalled();
    expect(sourceFetches).toBe(0);

    const right = await reverifyNoCopy(recordId, storage, fetchSource, {}, RECEIVER_KEY);
    expect(right).toMatchObject({ outcome: 'created', generation: 3 });
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external record after successful recovery');
    expect(recovered.external).toMatchObject({
      storageUri: expect.stringContaining('/storage/recovered-'),
      storageDigestMultibase: expect.any(String),
      decryptionKey: expect.any(String),
      contentDigest: await digest(new TextEncoder().encode(RECOVERY_JWT)),
      sourceDigest,
    });
    expect(recovered.checkRun).toMatchObject({
      generation: 3,
      state: CheckRunState.PENDING,
      retrieval: CheckResult.PASS,
      digest: CheckResult.PASS,
      decryption: CheckResult.PASS,
    });
    expect(store).toHaveBeenCalledTimes(1);
    expect(sourceFetches).toBe(0);
    expect(await jobsFor(recordId)).toHaveLength(1);
  });

  it('removes the retired ciphertext object, and only once the recovery has committed', async () => {
    // The removal has to run outside the finalisation transaction. An object
    // deleted before the write that displaced it commits is deleted while the
    // record still points at it, and a rollback then leaves the record naming
    // an object that is gone. The delete reads the record back on the global
    // client, outside every transaction this recovery opened: under READ
    // COMMITTED that read can only show the replacement once the finalisation
    // has committed, so the captured custody is what proves the ordering.
    //
    // Fails if the removal moves inside the transaction, aims at the
    // replacement, or does not happen at all.
    const storagePath = '/storage/retired-late-key.json';
    const sourcePath = '/supplier/retired-late-key.json';
    const ciphertext = new TextEncoder().encode(encryptedBody(RECOVERY_TEXT, RECEIVER_KEY));
    fixtures.set(storagePath, { body: Buffer.from(ciphertext) });
    const { recordId } = await insertUnopenedExternal({ sourcePath, storagePath, ciphertext });

    const storage = recoveryStorage();
    const removals: Array<{ externalId: string; bucket?: string; custodyAtRemoval: string | null }> = [];
    jest.spyOn(storage, 'delete').mockImplementation(async (externalId: string, bucket?: string) => {
      const row = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
      removals.push({
        externalId,
        bucket,
        custodyAtRemoval: row?.origin === 'EXTERNAL' ? row.external.storageUri : null,
      });
    });
    (resolveStorageService as jest.Mock).mockResolvedValue({ service: storage, instanceId: 'storage-unopened-test' });

    const result = await reverifyNoCopy(recordId, storage, sourceFetcher(), {}, RECEIVER_KEY);

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    // The instance the retired row named, never the tenant's current primary.
    expect(resolveStorageService).toHaveBeenCalledWith(SYSTEM_TENANT_ID, 'storage-unopened-test');
    expect(removals).toHaveLength(1);
    expect(removals[0]).toMatchObject({ externalId: storagePath, bucket: 'private' });
    expect(removals[0].custodyAtRemoval).toEqual(expect.stringContaining('/storage/recovered-'));

    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external record after recovery');
    expect(recovered.external.storageExternalId).not.toBe(storagePath);
    expect(recovered.external.decryptionKey).toEqual(expect.any(String));
  });

  it('settles the acquisition checks and rolls back the inserted job and custody when the finalisation transaction fails', async () => {
    // The finalisation transaction writes the new custody and inserts the
    // job together. The enqueue below performs the real transaction-bound
    // insert and only then throws, so a job row genuinely exists when the
    // transaction unwinds: the empty-jobs assertion is then evidence that an
    // INSERTED job was rolled back, rather than that none was ever written.
    // The throw escapes to the orchestration, which settles the reservation
    // FAILED. That settlement carries no check carrier on the error, so it is
    // the orchestration's own held state or nothing: before it existed this
    // run published `retrieval: not_run` for a copy that had demonstrably
    // been read, proven intact against its recorded digest and opened with
    // the supplied key.
    const storagePath = '/storage/enqueue-rollback.json';
    const sourcePath = '/supplier/enqueue-rollback.json';
    const ciphertext = new TextEncoder().encode(encryptedBody(RECOVERY_TEXT, RECEIVER_KEY));
    fixtures.set(storagePath, { body: Buffer.from(ciphertext) });
    const { recordId, storageDigest } = await insertUnopenedExternal({ sourcePath, storagePath, ciphertext });
    const storage = recoveryStorage();
    const enqueueFailure = new Error('queue insert rejected inside the finalisation transaction');
    let jobsInsideTransaction = -1;

    await expect(
      reverifyLibraryRecord(
        recordId,
        SYSTEM_TENANT_ID,
        async () => async (sql, job) => {
          await enqueue(sql, job);
          // Counted back through the same transaction handle, so the empty
          // count after the rollback is measured against a row this test
          // watched exist rather than against an enqueue it merely called.
          const { rows } = await sql.executeSql(
            `SELECT id FROM pgboss.job WHERE name = $1 AND data->>'recordId' = $2`,
            [LIBRARY_VERIFY_JOB, recordId],
          );
          jobsInsideTransaction = rows.length;
          throw enqueueFailure;
        },
        RECEIVER_KEY,
        {
          ...recoveryRunner(storage),
          getRecord: getLibraryRecordById,
          createGeneration: createReverificationGeneration,
          reserveGeneration: reserveRecoveryGeneration,
          finaliseGeneration: finaliseRecoveryGeneration,
          fetchStoredCopy: fetchStoredCopyBytes,
        },
      ),
    ).rejects.toBe(enqueueFailure);

    const record = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (record?.origin !== 'EXTERNAL') throw new Error('expected an external record');
    // Custody is the copy the record started with: the replacement was in the
    // rolled-back transaction, so the newly stored object is an orphan and
    // the record still points at its own unopened copy.
    expect(record.external).toMatchObject({
      storageUri: `${fixtures.baseUrl}${storagePath}`,
      storageDigestMultibase: storageDigest,
      storageExternalId: storagePath,
      decryptionKey: null,
    });
    // The job the enqueue above inserted is gone, which is the transaction
    // boundary under test: an insert committed independently of the
    // finalisation transaction would still be here.
    expect(jobsInsideTransaction).toBe(1);
    expect(await jobsFor(recordId)).toHaveLength(0);

    // The settled generation, with what the acquisition actually earned on
    // the way to the throw.
    expect(record.checkRun).toMatchObject({
      generation: 2,
      state: CheckRunState.FAILED,
      failureRetryable: true,
      retrieval: CheckResult.PASS,
      digest: CheckResult.PASS,
      decryption: CheckResult.PASS,
    });
  });

  it('answers 202 with the current envelope, which a later generation can already have replaced', async () => {
    // The qualified acceptance criterion is covered here. The 202 the route answers
    // is the record's CURRENT envelope, not a snapshot of this request's own
    // settlement, and the detail route exposes only the newest generation.
    //
    // What this test proves, exactly: it calls the orchestration directly
    // rather than through the route, so A's own return value is still its own
    // generation (asserted as 2 below), and it is the detail read afterwards
    // that shows the later generation 3. That read is the same projection the
    // route runs after the orchestration returns, so the projection half of
    // the behaviour is pinned here; the route's use of it is not reachable
    // from this seam, and the residual in the round's report says so. Fails
    // if the projection starts returning anything but the newest generation.
    const storagePath = '/storage/paused-projection.json';
    const sourcePath = '/supplier/paused-projection.json';
    const ciphertext = new TextEncoder().encode(encryptedBody(RECOVERY_TEXT, RECEIVER_KEY));
    fixtures.set(storagePath, { body: Buffer.from(ciphertext) });
    const { recordId } = await insertUnopenedExternal({ sourcePath, storagePath, ciphertext });

    let released: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      released = resolve;
    });
    let paused = false;
    // Held after A's own claim has committed its settlement inside the
    // transaction is not reachable from this hook, so the pause is taken on
    // A's parent lock and the later generation is written after A returns but
    // before the detail read below. Deterministic either way: nothing here
    // waits on a timer.
    recoveryFinaliseTestHooks.afterParentLock = async () => {
      if (paused) return;
      paused = true;
      released?.();
      await Promise.resolve();
    };

    try {
      const a = await reverifyNoCopy(recordId, recoveryStorage(), sourceFetcher(), {}, 'd'.repeat(64));
      await settled;
      expect(a).toMatchObject({ outcome: 'created', generation: 2 });

      // A later generation replaces A's settlement before anyone reads.
      const later = await prisma.checkRun.create({
        data: {
          recordId,
          tenantId: SYSTEM_TENANT_ID,
          generation: 3,
          state: CheckRunState.COMPLETE,
          retrieval: CheckResult.PASS,
          decryption: CheckResult.PASS,
          digest: CheckResult.PASS,
          proof: CheckResult.PASS,
          status: CheckResult.PASS,
          temporal: CheckResult.PASS,
          schemaConformance: CheckResult.NOT_RUN,
          requestedAt: new Date(),
          completedAt: new Date(),
        },
        select: { id: true, generation: true },
      });

      // The detail read the caller polls with shows the later generation, not
      // A's settled DECRYPTION_FAILED one, and A's own generation is still
      // recorded underneath.
      const current = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
      if (current?.origin !== 'EXTERNAL') throw new Error('expected an external record');
      expect(current.checkRun).toMatchObject({ generation: later.generation, state: CheckRunState.COMPLETE });
      const aRun = await prisma.checkRun.findFirst({ where: { recordId, generation: 2 } });
      expect(aRun).toMatchObject({
        state: CheckRunState.FAILED,
        failureCode: CheckRunFailureCode.DECRYPTION_FAILED,
      });
      // The raw copy is still the record's custody: a wrong key changed
      // nothing, whichever generation the poll happens to show.
      expect(current.external.storageUri).toBe(`${fixtures.baseUrl}${storagePath}`);
      expect(current.external.decryptionKey).toBeNull();
    } finally {
      recoveryFinaliseTestHooks.afterParentLock = undefined;
    }
  });

  it('rejects a key-bearing request that meets a pending recovery reservation instead of joining it', async () => {
    // Fails if the early bodyless join is allowed to consume a key-bearing
    // request, or if the reservation checks pending state only after fetching.
    const storagePath = '/storage/unopened-pending-key.json';
    const sourcePath = '/supplier/unopened-pending-key.json';
    const ciphertext = new TextEncoder().encode(encryptedBody(RECOVERY_TEXT, RECEIVER_KEY));
    fixtures.set(storagePath, { body: Buffer.from(ciphertext) });
    const { recordId } = await insertUnopenedExternal({ sourcePath, storagePath, ciphertext, pending: true });

    await expect(reverifyNoCopy(recordId, recoveryStorage(), sourceFetcher(), {}, RECEIVER_KEY)).rejects.toMatchObject({
      code: 'VERIFICATION_IN_PROGRESS',
    });
    expect(await prisma.checkRun.count({ where: { recordId } })).toBe(1);
  });

  it('a failed re-fetch leaves previously-extracted details untouched but stamps the check time', async () => {
    // The record already carries EXTRACTED details from an earlier
    // successful fetch whose copy was then lost (a storage failure).
    // Fails if a second, failed re-fetch wipes name/issuer/subject/validity
    // back to null, or if lastSourceCheckAt is left unset despite the
    // attempt having actually run.
    fixtures.set('/supplier/recovery-details-kept.json', { body: 'unavailable', status: 503 });
    const oldSourceDigest = await digest(new TextEncoder().encode('previously observed source bytes'));
    const recordId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-details-kept.json',
      sourceDigest: oldSourceDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
      details: {
        status: CredentialDetailsStatus.EXTRACTED,
        fields: DETAILS,
        credentialType: 'DigitalProductPassport',
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.6.0',
      },
    });

    const result = await reverifyNoCopy(recordId, recoveryStorage());

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    expect(await jobsFor(recordId)).toHaveLength(0);
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.record).toMatchObject({
      detailsStatus: CredentialDetailsStatus.EXTRACTED,
      name: DETAILS.name,
      issuerName: DETAILS.issuerName,
      issuerDid: DETAILS.issuerDid,
      subjectName: DETAILS.subjectName,
      subjectId: DETAILS.subjectId,
      credentialType: 'DigitalProductPassport',
      coreCredentialType: CoreCredentialType.DPP,
      coreDataModelVersion: '0.6.0',
    });
    expect(recovered.external.sourceDigest).toBe(oldSourceDigest);
    expect(recovered.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
      lastSourceCheckAt: expect.any(Date),
    });
  });

  it('a failed re-fetch on a row that already holds a content identity settles RETRIEVAL_FAILED, not SOURCE_NOT_CREDENTIAL', async () => {
    // Unlike the previous test, this row also carries a contentDigest from
    // an earlier successful recovery (holdsIdentity is true). A fetch that
    // never reaches the supplier at all must still take the retrieval-failure
    // path, not be mistaken for an observed-but-wrong-kind body: identity,
    // custody and details all stay exactly as they were.
    fixtures.set('/supplier/recovery-identity-unreachable.json', { body: 'unavailable', status: 503 });
    const oldSourceDigest = await digest(new TextEncoder().encode('previously observed identity source bytes'));
    const heldContentDigest = await digest(new TextEncoder().encode('previously observed identity content'));
    const recordId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-identity-unreachable.json',
      sourceDigest: oldSourceDigest,
      contentDigest: heldContentDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
      details: {
        status: CredentialDetailsStatus.EXTRACTED,
        fields: DETAILS,
        credentialType: 'DigitalProductPassport',
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.6.0',
      },
    });

    const result = await reverifyNoCopy(recordId, recoveryStorage());

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    expect(await jobsFor(recordId)).toHaveLength(0);
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.record).toMatchObject({
      detailsStatus: CredentialDetailsStatus.EXTRACTED,
      name: DETAILS.name,
      issuerName: DETAILS.issuerName,
      issuerDid: DETAILS.issuerDid,
      subjectName: DETAILS.subjectName,
      subjectId: DETAILS.subjectId,
    });
    expect(recovered.external).toMatchObject({
      sourceDigest: oldSourceDigest,
      contentDigest: heldContentDigest,
      duplicateOfRecordId: null,
      storageUri: null,
    });
    expect(recovered.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
      retrieval: CheckResult.FAIL,
      lastSourceCheckAt: expect.any(Date),
    });
  });

  it('recovers a no-copy record through the module default dependencies, with only fetchSource stubbed', async () => {
    // Runs the shipped wiring rather than the test's own recoveryRunner
    // stand-in: reverifyLibraryRecord's own recoverInRequest fallback,
    // defaultRegisterDependencies and settleInRequest in mode 'recover' all
    // execute for real. Only the storage microservice's HTTP boundary is
    // stubbed (ADR-029), the same boundary every other case in this file
    // stubs, just reached through the production resolveStorage call
    // instead of a test-supplied override.
    fixtures.set('/supplier/recovery-default-deps.json', { body: RECOVERY_TEXT });
    const sourceDigest = await digest(new TextEncoder().encode(RECOVERY_TEXT));
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-default-deps.json' });
    (resolveStorageService as jest.Mock).mockResolvedValue({
      service: recoveryStorage(),
      instanceId: 'recovery-storage-default',
    });

    const result = await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue, {
      ...defaultReverifyLibraryRecordDependencies(),
      fetchSource: sourceFetcher(),
    });

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({
      sourceDigest,
      storageUri: expect.stringContaining('/storage/recovered-'),
      storageServiceInstanceId: 'recovery-storage-default',
      contentDigest: await digest(new TextEncoder().encode(RECOVERY_JWT)),
    });
    expect(recovered.checkRun.state).toBe(CheckRunState.PENDING);
    const jobs = await jobsFor(recordId);
    expect(jobs).toHaveLength(1);

    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    await verifyGenerationHandler({ ...defaultVerifyGenerationDependencies(), resolveVerifier: async () => verifier })(
      jobs[0],
      context(),
    );
    const settled = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({ state: CheckRunState.COMPLETE });
  });

  it('revalidates a duplicate pointer against a holder that moved before the lock', async () => {
    // Fails if the advisory pointer is trusted after the lookup instead of
    // being revalidated, or if the fallback holder query is not locked at
    // commit time so a second mover could still win the race.
    fixtures.set('/supplier/recovery-pointer.json', { body: RECOVERY_TEXT });
    const sourceDigest = await digest(new TextEncoder().encode(RECOVERY_TEXT));
    const contentDigest = await digest(new TextEncoder().encode(RECOVERY_JWT));
    const originalHolder = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-pointer.json',
      sourceDigest,
      contentDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
    });
    const movedHolder = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-pointer.json' });
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-pointer.json' });
    const storage = recoveryStorage();
    let moved = false;

    const result = await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue, {
      ...recoveryRunner(storage),
      getRecord: getLibraryRecordById,
      createGeneration: createReverificationGeneration,
      reserveGeneration: reserveRecoveryGeneration,
      fetchStoredCopy: fetchStoredCopyBytes,
      finaliseGeneration: async (input) => {
        if (!moved && input.prepared.duplicateOfRecordId === originalHolder) {
          moved = true;
          await prisma.externalCredential.update({
            where: { id_tenantId_origin: { id: originalHolder, tenantId: SYSTEM_TENANT_ID, origin: 'EXTERNAL' } },
            data: { contentDigest: null },
          });
          await prisma.externalCredential.update({
            where: { id_tenantId_origin: { id: movedHolder, tenantId: SYSTEM_TENANT_ID, origin: 'EXTERNAL' } },
            data: { contentDigest },
          });
        }
        return finaliseRecoveryGeneration(input);
      },
    });

    expect(result).toMatchObject({ outcome: 'created', generation: 2 });
    const recovered = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (recovered?.origin !== 'EXTERNAL') throw new Error('expected an external recovery record');
    expect(recovered.external).toMatchObject({ contentDigest: null, duplicateOfRecordId: movedHolder });
  });

  it('promotes an advisory row when recovery replaces the current content identity, and bumps both parents', async () => {
    // Fails if an old canonical digest is simply cleared, leaving advisories
    // without their content identity while the recovering record takes a new
    // one, or if the promoted advisory's parent `updatedAt` is left stale
    // while its content identity visibly changed (ADR-053 decision 1).
    const oldPayload = { ...RECOVERY_DPP, name: 'Old passport', id: 'https://supplier.example/credentials/old' };
    const oldText = JSON.stringify(envelopedCredential(oldPayload));
    const oldJwt = (JSON.parse(oldText).id as string).split(',')[1];
    fixtures.set('/supplier/recovery-promotion.json', { body: RECOVERY_TEXT });
    const oldDigest = await digest(new TextEncoder().encode(oldText));
    const oldContentDigest = await digest(new TextEncoder().encode(oldJwt));
    const canonicalId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-promotion.json',
      sourceDigest: oldDigest,
      contentDigest: oldContentDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
    });
    const advisoryId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-promotion.json',
      duplicateOfRecordId: canonicalId,
    });
    const advisoryBefore = await getLibraryRecordById(advisoryId, SYSTEM_TENANT_ID);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const storage = recoveryStorage();

    await reverifyNoCopy(canonicalId, storage);

    const canonical = await getLibraryRecordById(canonicalId, SYSTEM_TENANT_ID);
    const advisory = await getLibraryRecordById(advisoryId, SYSTEM_TENANT_ID);
    if (canonical?.origin !== 'EXTERNAL' || advisory?.origin !== 'EXTERNAL')
      throw new Error('expected external records');
    expect(canonical.external).toMatchObject({
      contentDigest: await digest(new TextEncoder().encode(RECOVERY_JWT)),
      duplicateOfRecordId: null,
    });
    expect(advisory.external).toMatchObject({ contentDigest: oldContentDigest, duplicateOfRecordId: null });
    expect(advisory.record.updatedAt.getTime()).toBeGreaterThan(advisoryBefore!.record.updatedAt.getTime());
  });

  it('repoints every other advisory of a promoted digest and bumps its parent too', async () => {
    // The promoted row (the oldest advisory) takes the digest; every other
    // advisory of the same former owner is repointed to it, and both moves
    // must bump their own parent's `updatedAt`, not just the promoted one's.
    const oldPayload = { ...RECOVERY_DPP, name: 'Old passport', id: 'https://supplier.example/credentials/old-2' };
    const oldText = JSON.stringify(envelopedCredential(oldPayload));
    const oldJwt = (JSON.parse(oldText).id as string).split(',')[1];
    fixtures.set('/supplier/recovery-repoint.json', { body: RECOVERY_TEXT });
    const oldDigest = await digest(new TextEncoder().encode(oldText));
    const oldContentDigest = await digest(new TextEncoder().encode(oldJwt));
    const canonicalId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-repoint.json',
      sourceDigest: oldDigest,
      contentDigest: oldContentDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
    });
    const promotedId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-repoint.json',
      duplicateOfRecordId: canonicalId,
    });
    const otherAdvisoryId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-repoint.json',
      duplicateOfRecordId: canonicalId,
    });
    const otherBefore = await getLibraryRecordById(otherAdvisoryId, SYSTEM_TENANT_ID);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await reverifyNoCopy(canonicalId, recoveryStorage());

    const promoted = await getLibraryRecordById(promotedId, SYSTEM_TENANT_ID);
    const other = await getLibraryRecordById(otherAdvisoryId, SYSTEM_TENANT_ID);
    if (promoted?.origin !== 'EXTERNAL' || other?.origin !== 'EXTERNAL') throw new Error('expected external records');
    expect(promoted.external).toMatchObject({ contentDigest: oldContentDigest, duplicateOfRecordId: null });
    expect(other.external).toMatchObject({ contentDigest: null, duplicateOfRecordId: promotedId });
    expect(other.record.updatedAt.getTime()).toBeGreaterThan(otherBefore!.record.updatedAt.getTime());
  });

  it('recovering a digest holder concurrently with a recovery pointing at it does not deadlock', async () => {
    // The verified deadlock: A (holds digest X, no copy) locks its own
    // parent then waits to lock B's child while writing custody; B (no
    // identity, fetching content that duplicates X) locks its own parent,
    // writes its own child, then waits for a KEY SHARE on A's parent to set
    // its FK pointer. A total lock order over every touched LibraryRecord,
    // own included, closes this. Fails if either call times out or throws a
    // deadlock error (Postgres 40P01) instead of both completing.
    const sameText = JSON.stringify(envelopedCredential({ ...RECOVERY_DPP, name: 'Shared content' }));
    const sameJwt = (JSON.parse(sameText).id as string).split(',')[1];
    const sameContentDigest = await digest(new TextEncoder().encode(sameJwt));
    fixtures.set('/supplier/recovery-deadlock-a.json', { body: sameText });
    fixtures.set('/supplier/recovery-deadlock-b.json', { body: sameText });
    const holderId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-deadlock-a.json',
      sourceDigest: await digest(new TextEncoder().encode('a different earlier source for A')),
      contentDigest: sameContentDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
    });
    const duplicateId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-deadlock-b.json' });

    const results = await Promise.all([
      reverifyNoCopy(holderId, recoveryStorage()),
      reverifyNoCopy(duplicateId, recoveryStorage()),
    ]);

    expect(results.every((result) => result.outcome === 'created')).toBe(true);
    const holder = await getLibraryRecordById(holderId, SYSTEM_TENANT_ID);
    const duplicate = await getLibraryRecordById(duplicateId, SYSTEM_TENANT_ID);
    if (holder?.origin !== 'EXTERNAL' || duplicate?.origin !== 'EXTERNAL') throw new Error('expected external records');
    // Exactly one of the two now holds the shared digest as canonical, and
    // the other points at it; both fetched the same content, so which one
    // wins the race is not pinned, only that the identity is never split.
    const holderIsCanonical = holder.external.contentDigest === sameContentDigest;
    const duplicateIsCanonical = duplicate.external.contentDigest === sameContentDigest;
    expect(holderIsCanonical !== duplicateIsCanonical).toBe(true);
    if (holderIsCanonical) expect(duplicate.external.duplicateOfRecordId).toBe(holderId);
    else expect(holder.external.duplicateOfRecordId).toBe(duplicateId);
  });

  it("a deterministic parent/child foreign-key choreography: B blocks on A's LibraryRecord row rather than deadlocking", async () => {
    // A's own two-record scenario cannot deadlock under any lock order: A
    // never needs anything of B's. The genuine cycle is parent-against-child:
    // A holds LibraryRecord A (its own parent) and, once released, updates
    // its own ExternalCredential A row. B has no identity and fetches content
    // duplicating A's digest, so B's plan is {A, B}: B's own parent-lock
    // query needs LibraryRecord A too, and blocks on it immediately (before B
    // ever reaches its own afterParentLock hook) for as long as A holds it.
    // Held open deterministically via the hook and released only once B is
    // *observed* blocked (a `pg_stat_activity` poll, not a guessed sleep), so
    // this reproduces the exact interleaving rather than hoping for it.
    const sameText = JSON.stringify(envelopedCredential({ ...RECOVERY_DPP, name: 'FK choreography shared content' }));
    const sameJwt = (JSON.parse(sameText).id as string).split(',')[1];
    const sameContentDigest = await digest(new TextEncoder().encode(sameJwt));
    fixtures.set('/supplier/recovery-fk-a.json', { body: sameText });
    fixtures.set('/supplier/recovery-fk-b.json', { body: sameText });
    const holderId = await insertNoCopyExternal({
      sourcePath: '/supplier/recovery-fk-a.json',
      sourceDigest: await digest(new TextEncoder().encode('a different earlier source for FK choreography A')),
      contentDigest: sameContentDigest,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
    });
    const duplicateId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-fk-b.json' });

    const reservedA = await reserveRecoveryGeneration({
      recordId: holderId,
      tenantId: SYSTEM_TENANT_ID,
      expectedGeneration: 1,
      expectedCustody: await custodyOf(holderId),
    });
    const reservedB = await reserveRecoveryGeneration({
      recordId: duplicateId,
      tenantId: SYSTEM_TENANT_ID,
      expectedGeneration: 1,
      expectedCustody: await custodyOf(duplicateId),
    });
    if (reservedA.outcome !== 'reserved' || reservedB.outcome !== 'reserved') {
      throw new Error('expected both reservations to succeed');
    }

    const registerDeps = defaultRegisterDependencies(async () => undefined);
    const preparedA = await settleInRequest(
      {
        tenantId: SYSTEM_TENANT_ID,
        sourceUrl: `${fixtures.baseUrl}/supplier/recovery-fk-a.json`,
        annotations: { displayName: 'FK choreography A', declaredCredentialType: CoreCredentialType.DPP },
      },
      {
        ...registerDeps,
        fetchDocument: sourceFetcher(),
        resolveStorage: async () => ({ service: recoveryStorage(), instanceId: 'fk-a-storage' }),
        findExistingExternal: findExternalByContentDigest,
      },
      { mode: 'recover', currentRecordId: holderId, holdsIdentity: true, acquisition: { from: 'source' } },
    );
    const preparedB = await settleInRequest(
      {
        tenantId: SYSTEM_TENANT_ID,
        sourceUrl: `${fixtures.baseUrl}/supplier/recovery-fk-b.json`,
        annotations: { displayName: 'FK choreography B', declaredCredentialType: CoreCredentialType.DPP },
      },
      {
        ...registerDeps,
        fetchDocument: sourceFetcher(),
        resolveStorage: async () => ({ service: recoveryStorage(), instanceId: 'fk-b-storage' }),
        findExistingExternal: findExternalByContentDigest,
      },
      { mode: 'recover', currentRecordId: duplicateId, holdsIdentity: false, acquisition: { from: 'source' } },
    );

    let notifyALocked!: () => void;
    const aLocked = new Promise<void>((resolve) => {
      notifyALocked = resolve;
    });
    let releaseA!: () => void;
    const aReleaseSignal = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    recoveryFinaliseTestHooks.afterParentLock = async (recordId) => {
      if (recordId === holderId) {
        notifyALocked();
        // Held open until this test explicitly releases it, once B is
        // observed blocked below (not a fixed sleep).
        await aReleaseSignal;
      }
    };
    let aPromise: ReturnType<typeof finaliseRecoveryGeneration> | undefined;
    let bPromise: ReturnType<typeof finaliseRecoveryGeneration> | undefined;
    try {
      aPromise = finaliseRecoveryGeneration({
        recordId: holderId,
        tenantId: SYSTEM_TENANT_ID,
        checkRunId: reservedA.checkRunId,
        generation: reservedA.generation,
        expectedCustody: reservedA.custody,
        prepared: preparedA,
        enqueue,
      });
      // Do not start B until A's own parent lock is confirmed held, but race
      // that confirmation against A's own promise: if A rejects before ever
      // reaching the hook, that must surface here as the actual failure
      // rather than leave this await hanging until the outer test timeout.
      await Promise.race([aLocked, aPromise]);
      bPromise = finaliseRecoveryGeneration({
        recordId: duplicateId,
        tenantId: SYSTEM_TENANT_ID,
        checkRunId: reservedB.checkRunId,
        generation: reservedB.generation,
        expectedCustody: reservedB.custody,
        prepared: preparedB,
        enqueue,
      });
      // B's own parent-lock statement (needing both LibraryRecord rows) is
      // now blocked on the row A holds. Confirm that by polling for a real
      // backend reported by Postgres itself as waiting on a lock while
      // running that exact statement, rather than sleeping a guessed
      // duration and hoping B reached this point by then.
      await waitUntilBackendBlocked(prisma, 'FROM "LibraryRecord"');
    } finally {
      // Always releases A's held-open transaction, even when the block above
      // threw (a timeout waiting for B to block, or A's own promise
      // rejecting the race): leaving A's barrier unreleased would strand its
      // transaction open and hang the whole test run rather than failing
      // this one test cleanly.
      releaseA();
      recoveryFinaliseTestHooks.afterParentLock = undefined;
    }

    // Both promises settled, not raced against each other: a genuine failure
    // in either must be reported, not swallowed by the other winning first,
    // and both must be allowed to actually finish (successfully or not)
    // before this test moves on to reading the rows they wrote.
    const [settledA, settledB] = await Promise.allSettled([aPromise, bPromise]);
    if (settledA.status === 'rejected') throw settledA.reason;
    if (settledB.status === 'rejected') throw settledB.reason;
    expect(settledA.value?.outcome).toBe('created');
    expect(settledB.value?.outcome).toBe('created');

    const holder = await getLibraryRecordById(holderId, SYSTEM_TENANT_ID);
    const duplicate = await getLibraryRecordById(duplicateId, SYSTEM_TENANT_ID);
    if (holder?.origin !== 'EXTERNAL' || duplicate?.origin !== 'EXTERNAL') throw new Error('expected external records');
    expect(holder.external.contentDigest).toBe(sameContentDigest);
    expect(duplicate.external.duplicateOfRecordId).toBe(holderId);
  });

  it('two concurrent no-identity recoveries of the same content converge to one canonical row and one duplicate pointer', async () => {
    // A convergence test, not a proof of the exact interleaving: two real,
    // independently scheduled Postgres transactions race here, so which one
    // commits first (and therefore which one, if either, actually hits the
    // unique index and takes the acquisition-collision retry) is not pinned
    // by this test and can vary between runs. What every interleaving must
    // still produce is the same outcome: exactly one row ends up canonical
    // and the other points at it, and this never logs the "collided twice"
    // line a genuine double failure would produce. The acquisition-collision
    // retry path itself (the actual reconciliation under lock after a real
    // unique-index hit) is pinned deterministically by the unit tests in
    // `check-run.repository.test.ts` instead, which control the collision
    // and the winner lookup directly rather than hoping for one here.
    const sharedText = JSON.stringify(envelopedCredential({ ...RECOVERY_DPP, name: 'Collision content' }));
    const sharedJwt = (JSON.parse(sharedText).id as string).split(',')[1];
    const sharedContentDigest = await digest(new TextEncoder().encode(sharedJwt));
    fixtures.set('/supplier/recovery-collision-a.json', { body: sharedText });
    fixtures.set('/supplier/recovery-collision-b.json', { body: sharedText });
    const recordA = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-collision-a.json' });
    const recordB = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-collision-b.json' });

    const results = await Promise.all([
      reverifyNoCopy(recordA, recoveryStorage()),
      reverifyNoCopy(recordB, recoveryStorage()),
    ]);

    expect(results.every((result) => result.outcome === 'created')).toBe(true);
    const a = await getLibraryRecordById(recordA, SYSTEM_TENANT_ID);
    const b = await getLibraryRecordById(recordB, SYSTEM_TENANT_ID);
    if (a?.origin !== 'EXTERNAL' || b?.origin !== 'EXTERNAL') throw new Error('expected external records');
    const aIsCanonical = a.external.contentDigest === sharedContentDigest;
    const bIsCanonical = b.external.contentDigest === sharedContentDigest;
    expect(aIsCanonical !== bIsCanonical).toBe(true);
    if (aIsCanonical) expect(b.external.duplicateOfRecordId).toBe(recordA);
    else expect(a.external.duplicateOfRecordId).toBe(recordB);
    const collidedTwice = capturedLogLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .some((line) => line.msg === 'Content identity collided twice and no record holds it after rollback');
    expect(collidedTwice).toBe(false);
  });

  it('a reservation abandoned mid-fetch is settled by the sweep, and the late fetch cannot finalise it', async () => {
    // The caller reserved and started fetching, then never returns (a crash,
    // a killed process). The sweep settles the abandoned reservation, and a
    // late finalisation attempt against that same reservation must be
    // fenced out rather than attaching custody to a run the sweep has
    // already closed.
    fixtures.set('/supplier/recovery-abandoned.json', { body: RECOVERY_TEXT });
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-abandoned.json' });
    const reserved = await reserveRecoveryGeneration({
      recordId,
      tenantId: SYSTEM_TENANT_ID,
      expectedGeneration: 1,
      expectedCustody: await custodyOf(recordId),
    });
    if (reserved.outcome !== 'reserved') throw new Error('expected the reservation to succeed');
    const oldMarker = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.checkRun.update({ where: { id: reserved.checkRunId }, data: { requestedAt: oldMarker } });

    await sweepQueue.enqueue(LIBRARY_RECONCILE_PENDING_RUNS_JOB, {});
    const abandoned = await waitFor(
      () => prisma.checkRun.findUnique({ where: { id: reserved.checkRunId } }),
      (run): run is NonNullable<typeof run> => run?.state === CheckRunState.FAILED,
    );
    expect(abandoned).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
      failureRetryable: true,
    });

    // The late fetch finally resolves and tries to finalise the same
    // reservation the sweep already closed.
    const registerDeps = defaultRegisterDependencies(async () => undefined);
    const prepared = await settleInRequest(
      {
        tenantId: SYSTEM_TENANT_ID,
        sourceUrl: `${fixtures.baseUrl}/supplier/recovery-abandoned.json`,
        annotations: { displayName: 'Late fetch', declaredCredentialType: CoreCredentialType.DPP },
      },
      {
        ...registerDeps,
        fetchDocument: sourceFetcher(),
        resolveStorage: async () => ({ service: recoveryStorage(), instanceId: 'late-storage' }),
        findExistingExternal: findExternalByContentDigest,
      },
      { mode: 'recover', currentRecordId: recordId, holdsIdentity: false, acquisition: { from: 'source' } },
    );
    const late = await finaliseRecoveryGeneration({
      recordId,
      tenantId: SYSTEM_TENANT_ID,
      checkRunId: reserved.checkRunId,
      generation: reserved.generation,
      expectedCustody: reserved.custody,
      prepared,
      enqueue,
    });

    expect(late).toEqual({ outcome: 'superseded', generation: reserved.generation });
    const record = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (record?.origin !== 'EXTERNAL') throw new Error('expected an external record');
    expect(record.external.storageUri).toBeNull();
    const orphan = capturedLogLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'Prepared recovery copy is orphaned and needs operator cleanup');
    expect(orphan).toMatchObject({ recordId, reason: 'superseded' });
  });

  it('orphan-logs a prepared copy, naming its storage coordinates, when the reservation is settled before finalisation runs', async () => {
    // The fence in `finaliseRecoveryGeneration` rejects a
    // reservation another actor (here, simulating the sweep) has already
    // settled. Fails if a prepared storage object is silently leaked in that
    // case, or if the operator-facing orphan log line is missing or misses
    // the coordinates an operator needs to find and remove the object.
    fixtures.set('/supplier/recovery-orphan.json', { body: RECOVERY_TEXT });
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/recovery-orphan.json' });
    const storage = recoveryStorage();
    let preparedStorageUri: string | undefined;
    const result = await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue, {
      ...recoveryRunner(storage),
      getRecord: getLibraryRecordById,
      createGeneration: createReverificationGeneration,
      reserveGeneration: reserveRecoveryGeneration,
      fetchStoredCopy: fetchStoredCopyBytes,
      finaliseGeneration: async (input) => {
        preparedStorageUri = input.prepared.storage?.uri;
        // Simulate another actor (the sweep) settling this exact reservation
        // as abandoned before this finalisation gets to write to it.
        await prisma.checkRun.update({
          where: { id: input.checkRunId },
          data: {
            state: CheckRunState.FAILED,
            failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
            failureRetryable: true,
            completedAt: new Date(),
          },
        });
        return finaliseRecoveryGeneration(input);
      },
    });

    expect(preparedStorageUri).toEqual(expect.stringContaining('/storage/recovered-'));
    expect(result).toEqual({ outcome: 'superseded', generation: 2 });
    expect(await prisma.checkRun.count({ where: { recordId } })).toBe(2);
    const record = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (record?.origin !== 'EXTERNAL') throw new Error('expected an external record');
    expect(record.external.storageUri).toBeNull();
    expect(record.external.storageDigestMultibase).toBeNull();

    const orphan = capturedLogLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'Prepared recovery copy is orphaned and needs operator cleanup');
    expect(orphan).toMatchObject({
      recordId,
      tenantId: SYSTEM_TENANT_ID,
      reason: 'superseded',
      storageUri: preparedStorageUri,
    });
  });

  it('reports superseded and orphan-logs when a second real finalisation replaced custody under this reservation', async () => {
    // The finalisation fence has two halves. The atomic claim asks whether
    // this exact reservation is still `PENDING` and unqueued; the custody
    // comparison asks whether the record is still the one it reserved
    // against. This case drives the second half: the claim succeeds, and only
    // the comparison stands between a stale attempt and a copy another
    // finalisation has already committed. Fails if the comparison is dropped
    // from the fence, because this attempt then writes its own copy and
    // identity over that one and settles a generation against custody nobody
    // reserved.
    //
    // The two writers cannot actually overlap in production:
    // `replaceCustody` is reached only from a finalisation holding a
    // claimable `PENDING` run, and `CheckRun_one_pending_per_record` allows a
    // record one of those at a time. So the reservation is parked out of
    // `PENDING` for the length of the second recovery and restored
    // afterwards, which is the only way to hold both facts at once. The
    // comparison is therefore defence in depth rather than a live race, and
    // this case pins it as such against real rows.
    fixtures.set('/supplier/custody-fence.json', { body: RECOVERY_TEXT });
    const recordId = await insertNoCopyExternal({ sourcePath: '/supplier/custody-fence.json' });

    const reserved = await reserveRecoveryGeneration({
      recordId,
      tenantId: SYSTEM_TENANT_ID,
      expectedGeneration: 1,
      expectedCustody: await custodyOf(recordId),
    });
    if (reserved.outcome !== 'reserved') throw new Error('expected the reservation to succeed');
    expect(reserved.custody.storageUri).toBeNull();

    await prisma.checkRun.update({
      where: { id: reserved.checkRunId },
      data: { state: CheckRunState.COMPLETE, completedAt: new Date() },
    });
    const second = await reverifyNoCopy(recordId, recoveryStorage());
    expect(second).toMatchObject({ outcome: 'created', generation: 3 });
    const replacedCustody = await custodyOf(recordId);
    expect(replacedCustody.storageUri).toEqual(expect.stringContaining('/storage/recovered-'));

    // The second recovery's own generation is settled by the real worker
    // before the reservation is restored, because the record may hold only
    // one pending run and the restored reservation has to be that one.
    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    await verifyGenerationHandler({
      ...defaultVerifyGenerationDependencies(),
      resolveVerifier: async () => verifier,
    })((await jobsFor(recordId))[0], context());
    await prisma.checkRun.update({
      where: { id: reserved.checkRunId },
      data: { state: CheckRunState.PENDING, completedAt: null, lastEnqueuedAt: null },
    });

    // The first attempt's own acquisition finally returns, having stored its
    // own copy on the way, and tries to finalise against the custody it
    // reserved against.
    const registerDeps = defaultRegisterDependencies(async () => undefined);
    const prepared = await settleInRequest(
      {
        tenantId: SYSTEM_TENANT_ID,
        sourceUrl: `${fixtures.baseUrl}/supplier/custody-fence.json`,
        annotations: { displayName: 'Late attempt', declaredCredentialType: CoreCredentialType.DPP },
      },
      {
        ...registerDeps,
        fetchDocument: sourceFetcher(),
        resolveStorage: async () => ({ service: recoveryStorage(), instanceId: 'late-storage' }),
        findExistingExternal: findExternalByContentDigest,
      },
      { mode: 'recover', currentRecordId: recordId, holdsIdentity: false, acquisition: { from: 'source' } },
    );
    expect(prepared.storage?.uri).toEqual(expect.stringContaining('/storage/recovered-'));
    expect(prepared.storage?.uri).not.toEqual(replacedCustody.storageUri);

    const late = await finaliseRecoveryGeneration({
      recordId,
      tenantId: SYSTEM_TENANT_ID,
      checkRunId: reserved.checkRunId,
      generation: reserved.generation,
      expectedCustody: reserved.custody,
      prepared,
      enqueue,
    });

    expect(late).toEqual({ outcome: 'superseded', generation: 3 });
    // Custody is exactly what the second recovery left, and the parked run is
    // exactly as it was restored: nothing this attempt prepared was written.
    expect(await custodyOf(recordId)).toEqual(replacedCustody);
    expect(await prisma.checkRun.findUnique({ where: { id: reserved.checkRunId } })).toMatchObject({
      state: CheckRunState.PENDING,
      lastEnqueuedAt: null,
      failureCode: null,
    });
    expect(await jobsFor(recordId)).toHaveLength(1);

    const orphan = capturedLogLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find(
        (line) =>
          line.msg === 'Prepared recovery copy is orphaned and needs operator cleanup' &&
          line.storageUri === prepared.storage?.uri,
      );
    expect(orphan).toMatchObject({ recordId, tenantId: SYSTEM_TENANT_ID, reason: 'superseded' });
  });

  it('records changed and not-checked supplier freshness while retaining the protected copy', async () => {
    // Fails if a changed source replaces the pinned copy, or if an outage is
    // collapsed into unchanged or omitted from the settled envelope.
    const sourceDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const storageDigest = sourceDigest;
    fixtures.set('/supplier/changed.json', { body: JSON.stringify({ changed: true }) });
    const changedId = await insertProtectedExternal({
      sourcePath: '/supplier/changed.json',
      storagePath: '/storage/protected.json',
      sourceDigest,
      storageDigest,
    });
    const changed = await reverifyLibraryRecord(changedId, SYSTEM_TENANT_ID, prepareEnqueue);
    expect(changed).toMatchObject({ outcome: 'created', generation: 2 });
    const changedRun = await prisma.checkRun.findFirst({
      where: { recordId: changedId },
      orderBy: { generation: 'desc' },
    });
    expect(changedRun).toMatchObject({ sourceChanged: true, lastSourceCheckAt: expect.any(Date) });
    const changedBeforeWorker = await getLibraryRecordById(changedId, SYSTEM_TENANT_ID);
    expect(changedBeforeWorker?.origin === 'EXTERNAL' && changedBeforeWorker.external.storageUri).toBe(
      `${fixtures.baseUrl}/storage/protected.json`,
    );

    fixtures.set('/supplier/unavailable.json', { body: 'gone', status: 503 });
    const unavailableId = await insertProtectedExternal({
      sourcePath: '/supplier/unavailable.json',
      storagePath: '/storage/protected.json',
      sourceDigest,
      storageDigest,
    });
    const unavailable = await reverifyLibraryRecord(unavailableId, SYSTEM_TENANT_ID, prepareEnqueue);
    expect(unavailable).toMatchObject({ outcome: 'created', generation: 2 });
    const unavailableRun = await prisma.checkRun.findFirst({
      where: { recordId: unavailableId },
      orderBy: { generation: 'desc' },
    });
    expect(unavailableRun).toMatchObject({ sourceChanged: null, lastSourceCheckAt: expect.any(Date) });

    const verifier: IVerifiableCredentialService = {
      sign: jest.fn(),
      verify: jest.fn().mockResolvedValue({ verified: true }),
    };
    const handler = verifyGenerationHandler({
      ...defaultVerifyGenerationDependencies(),
      resolveVerifier: async () => verifier,
    });
    await handler((await jobsFor(changedId))[0], context());
    const projected = toCredentialRecord((await getLibraryRecordById(changedId, SYSTEM_TENANT_ID)) as never);
    expect(projected.verification).toMatchObject({ state: 'complete', sourceChanged: true });
  });

  it('settles a protected copy that no longer matches its digest as STORED_COPY_CORRUPT', async () => {
    // The copy reads back, so retrieval passes, but the body storage now
    // serves is not what was digested when it was stored. Fails if a
    // tampered copy shares STORED_COPY_UNAVAILABLE with an absent one, if the
    // enum value the handler settles is not one the database accepts (this is
    // the only test that writes it to Postgres), or if the verifier is asked
    // about a copy that failed its integrity check.
    const sourceDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const storageDigest = sourceDigest;
    fixtures.set('/supplier/tampered.json', { body: DPP_TEXT });
    fixtures.set('/storage/tampered.json', { body: JSON.stringify({ ...DPP, id: 'urn:uuid:tampered' }) });
    const recordId = await insertProtectedExternal({
      sourcePath: '/supplier/tampered.json',
      storagePath: '/storage/tampered.json',
      sourceDigest,
      storageDigest,
    });
    await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
    const verifier: IVerifiableCredentialService = { sign: jest.fn(), verify: jest.fn() };
    await verifyGenerationHandler({
      ...defaultVerifyGenerationDependencies(),
      resolveVerifier: async () => verifier,
    })((await jobsFor(recordId))[0], context({ isFinalAttempt: true }));

    const corrupt = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(corrupt?.checkRun).toMatchObject({
      generation: 2,
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.STORED_COPY_CORRUPT,
      failureRetryable: false,
      retrieval: CheckResult.PASS,
      digest: CheckResult.FAIL,
    });
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('settles a missing protected copy as terminal and leaves custody for the next request', async () => {
    // Fails if proven storage loss is treated as a transient verifier failure,
    // clears the custody tuple, or prevents a later recovery attempt.
    const sourceDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const storageDigest = sourceDigest;
    fixtures.set('/supplier/lost.json', { body: DPP_TEXT });
    const recordId = await insertProtectedExternal({
      sourcePath: '/supplier/lost.json',
      storagePath: '/storage/lost.json',
      sourceDigest,
      storageDigest,
    });
    const before = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    const created = await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
    const verifier: IVerifiableCredentialService = { sign: jest.fn(), verify: jest.fn() };
    const handler = verifyGenerationHandler({
      ...defaultVerifyGenerationDependencies(),
      resolveVerifier: async () => verifier,
    });
    await handler((await jobsFor(recordId))[0], context({ isFinalAttempt: true }));

    const lost = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(lost?.checkRun).toMatchObject({
      generation: 2,
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
      failureRetryable: false,
    });
    expect(lost?.origin === 'EXTERNAL' && before?.origin === 'EXTERNAL' && lost.external).toMatchObject({
      storageUri: before?.origin === 'EXTERNAL' ? before.external.storageUri : undefined,
      storageDigestMultibase: before?.origin === 'EXTERNAL' ? before.external.storageDigestMultibase : undefined,
      storageExternalId: before?.origin === 'EXTERNAL' ? before.external.storageExternalId : undefined,
      decryptionKey: before?.origin === 'EXTERNAL' ? before.external.decryptionKey : undefined,
    });

    const next = await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
    expect(next).toMatchObject({ outcome: 'created', generation: 3 });
    expect(created).toMatchObject({ outcome: 'created', generation: 2 });
  });

  it('discards a repository call whose generation moved while the request was being prepared', async () => {
    // The preparation race: a winner created and settled generation 2 before
    // this request reached its transaction. Fails if the recheck under the
    // parent lock is dropped, because the loser then appends generation 3 for
    // work nobody asked for a second time.
    const storageDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const native = await insertNativeCredential(prisma, {
      storageUri: `${fixtures.baseUrl}/storage/native.json`,
      digestMultibase: storageDigest,
    });
    const snapshot = {
      recordId: native.id,
      tenantId: SYSTEM_TENANT_ID,
      expectedGeneration: 1,
      expectedOrigin: 'NATIVE' as const,
      expectedCustody: {
        storageUri: `${fixtures.baseUrl}/storage/native.json`,
        storageDigestMultibase: storageDigest,
        storageExternalId: null,
        // The native fixture stores no key, so custody observes none.
        decryptionKeyPresent: false,
        encrypted: null,
      },
      enqueue,
    };

    const winner = await createReverificationGeneration(snapshot);
    if (winner.outcome !== 'created') throw new Error('expected the winner to create generation 2');
    await prisma.checkRun.update({
      where: { id: winner.checkRunId },
      data: {
        state: CheckRunState.COMPLETE,
        ...COMPLETE_CHECKS,
        completedAt: new Date(),
      },
    });

    // The loser commits with the snapshot it took before the winner ran.
    const loser = await createReverificationGeneration(snapshot);

    expect(loser).toEqual({ outcome: 'superseded', generation: 2 });
    expect(await prisma.checkRun.count({ where: { recordId: native.id } })).toBe(1);
    expect(await jobsFor(native.id)).toHaveLength(1);
  });

  it('discards a repository call whose custody moved while the request was being prepared', async () => {
    // The other half of the recheck. Fails if only the generation number is
    // compared, so a request prepared against one durable copy can append a
    // generation for a copy that has since been replaced.
    const sourceDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const recordId = await insertProtectedExternal({
      sourcePath: '/supplier/credential.json',
      storagePath: '/storage/protected.json',
      sourceDigest,
      storageDigest: sourceDigest,
    });
    const before = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    if (before?.origin !== 'EXTERNAL') throw new Error('expected an external record');
    const snapshot = {
      recordId,
      tenantId: SYSTEM_TENANT_ID,
      expectedGeneration: 1,
      expectedOrigin: 'EXTERNAL' as const,
      expectedCustody: {
        storageUri: before.external.storageUri,
        storageDigestMultibase: before.external.storageDigestMultibase,
        storageExternalId: before.external.storageExternalId,
        // Read off the row rather than restated, so this snapshot is the
        // custody the record actually has and the only thing the test moves
        // below is the storage URI it means to move.
        decryptionKeyPresent: before.external.decryptionKey !== null,
        encrypted: before.external.encrypted,
      },
      enqueue,
    };

    await prisma.externalCredential.update({
      where: { id_tenantId_origin: { id: recordId, tenantId: SYSTEM_TENANT_ID, origin: 'EXTERNAL' } },
      data: { storageUri: `${fixtures.baseUrl}/storage/replaced.json`, storageExternalId: 'replaced-object' },
    });

    await expect(createReverificationGeneration(snapshot)).resolves.toEqual({
      outcome: 'superseded',
      generation: 1,
    });
    expect(await prisma.checkRun.count({ where: { recordId } })).toBe(1);
  });

  it('refuses to append a generation for a record read under another tenant', async () => {
    // Fails if the parent lock drops its tenant predicate, which would let a
    // record id from one tenant append a generation in another.
    const storageDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const native = await insertNativeCredential(prisma, {
      storageUri: `${fixtures.baseUrl}/storage/native.json`,
      digestMultibase: storageDigest,
    });

    const result = await createReverificationGeneration({
      recordId: native.id,
      tenantId: 'a-different-tenant',
      expectedGeneration: 1,
      expectedOrigin: 'NATIVE',
      expectedCustody: {
        storageUri: `${fixtures.baseUrl}/storage/native.json`,
        storageDigestMultibase: storageDigest,
        storageExternalId: null,
        // The native fixture stores no key, so custody observes none.
        decryptionKeyPresent: false,
        encrypted: null,
      },
      enqueue,
    });

    expect(result).toEqual({ outcome: 'missing' });
    expect(await prisma.checkRun.count({ where: { recordId: native.id } })).toBe(0);
    expect(await jobsFor(native.id)).toHaveLength(0);
  });

  it('settles a stored key that will not unwrap as retryable, and the detail projection keeps the record readable', async () => {
    // The worker still reports the copy as unavailable and retryable, while
    // the detail route keeps the verification result readable and explains
    // that the held key could not be returned. Fails if the unwrap failure is
    // settled as proven loss, or if the detail projection drops the record.
    const storagePath = '/storage/encrypted.json';
    fixtures.set(storagePath, { body: encryptedBody(DPP_TEXT, RECEIVER_KEY) });
    const sourceDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const recordId = await insertProtectedExternal({
      sourcePath: '/supplier/credential.json',
      storagePath,
      sourceDigest,
      storageDigest: sourceDigest,
      encrypted: true,
      decryptionKey: unopenableKeyEnvelope(),
    });

    await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
    const verifier: IVerifiableCredentialService = { sign: jest.fn(), verify: jest.fn() };
    await verifyGenerationHandler({
      ...defaultVerifyGenerationDependencies(),
      resolveVerifier: async () => verifier,
    })((await jobsFor(recordId))[0], context({ isFinalAttempt: true }));

    const settled = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({
      generation: 2,
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
      failureRetryable: true,
    });
    expect(verifier.verify).not.toHaveBeenCalled();
    // The keyless projection still answers, and detail now degrades only the
    // key field rather than losing the record that carries the run result.
    expect(() => toCredentialRecord(settled as never)).not.toThrow();
    expect(toCredentialRecordDetail(settled as never, { reveal: revealDecryptionKey })).toMatchObject({
      hasKey: true,
      decryptionKey: null,
      warnings: [{ code: 'DECRYPTION_KEY_UNAVAILABLE' }],
    });
  });

  it.each([
    ['plain', false],
    ['encrypted', true],
  ])('checks an opaque %s copy against the exact bytes that were stored', async (label, encrypt) => {
    // A lone 0x80 decodes to U+FFFD and re-encodes as three other bytes, so a
    // decode and re-encode anywhere in the read path turns an intact binary
    // copy into proven corruption. Register stores such a body byte for byte,
    // and the storage service digested those bytes. The encrypted copy is
    // served the way the storage service's binary endpoint serves one, as an
    // envelope over the base64 of the bytes. Fails if the worker puts the
    // copy, or an encrypted copy's plaintext, through a UTF-8 round trip, or
    // if it digests that base64 instead of what it encodes.
    const served = new Uint8Array([...Buffer.from('binary '), 0x80, 0xff, ...Buffer.from(' tail')]);
    const storagePath = `/storage/opaque-${label}.bin`;
    const body = encrypt
      ? Buffer.from(encryptedBody(Buffer.from(served).toString('base64'), RECEIVER_KEY))
      : Buffer.from(served);
    fixtures.set(storagePath, { body });
    const sourceDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const storageDigest = await digest(served);
    // The digest the record carries is checked against a hash this test
    // computes itself, so the copy is not being compared with the rig's own
    // stub through both halves of the assertion. The rig encodes a sha-256 in
    // hex behind a fixed prefix, which is what makes the comparison possible
    // here; the production encoding is pinned in
    // verify-generation-job.digest-preimage.test.ts against a digest the
    // storage service produced.
    expect(storageDigest).toBe(`zINTEG${createHash('sha256').update(served).digest('hex')}`);
    const recordId = await insertProtectedExternal({
      sourcePath: '/supplier/credential.json',
      storagePath,
      sourceDigest,
      storageDigest,
      encrypted: encrypt,
      contentKind: ExternalContentKind.OPAQUE,
    });

    const created = await reverifyLibraryRecord(recordId, SYSTEM_TENANT_ID, prepareEnqueue);
    expect(created).toMatchObject({ outcome: 'created', generation: 2 });
    const verifier: IVerifiableCredentialService = { sign: jest.fn(), verify: jest.fn() };
    await verifyGenerationHandler({
      ...defaultVerifyGenerationDependencies(),
      resolveVerifier: async () => verifier,
    })((await jobsFor(recordId))[0], context({ isFinalAttempt: true }));

    const settled = await getLibraryRecordById(recordId, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({
      generation: 2,
      state: CheckRunState.COMPLETE,
      retrieval: CheckResult.PASS,
      digest: CheckResult.PASS,
      // Not a credential, so the proof fails by definition and the verifier
      // is never asked.
      proof: CheckResult.FAIL,
    });
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('settles an abandoned run through the real reconciliation queue, and a late worker attempt changes nothing', async () => {
    // Fails if the sweep misses stale markers, re-enqueues instead of
    // settling, or lets a late handler overwrite its failure. The late
    // attempt stops at the handler's own early exit, because the run it
    // found is no longer PENDING; the settle's state guard is the second
    // line and is not what this case exercises. The cron registration is
    // proven by the schedule call in setUp; this case drives the sweep
    // through the queue so it does not wait on a tick.
    const storageDigest = await digest(new TextEncoder().encode(DPP_TEXT));
    const native = await insertNativeCredential(prisma, {
      storageUri: `${fixtures.baseUrl}/storage/native.json`,
      digestMultibase: storageDigest,
    });
    const created = await reverifyLibraryRecord(native.id, SYSTEM_TENANT_ID, prepareEnqueue);
    if (created.outcome !== 'created') throw new Error('expected a new native generation');
    const oldMarker = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.checkRun.update({ where: { id: created.checkRunId }, data: { lastEnqueuedAt: oldMarker } });
    await sweepQueue.enqueue(LIBRARY_RECONCILE_PENDING_RUNS_JOB, {});

    const settled = await waitFor(
      () => prisma.checkRun.findUnique({ where: { id: created.checkRunId } }),
      (run): run is NonNullable<typeof run> => run?.state === CheckRunState.FAILED,
    );
    expect(settled).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
      failureRetryable: true,
    });
    const verifier: IVerifiableCredentialService = { sign: jest.fn(), verify: jest.fn() };
    await verifyGenerationHandler({
      ...defaultVerifyGenerationDependencies(),
      resolveVerifier: async () => verifier,
    })(
      {
        tenantId: SYSTEM_TENANT_ID,
        recordId: native.id,
        generation: 2,
        checkRunId: created.checkRunId,
      },
      context(),
    );
    expect((await prisma.checkRun.findUnique({ where: { id: created.checkRunId } }))?.state).toBe(CheckRunState.FAILED);
  });
});
