const capturedLogLines: string[] = [];

jest.mock('@/lib/api/logger', () => {
  const { createLogger } = jest.requireActual('@uncefact/untp-ri-services/logging');
  return {
    apiLogger: createLogger({
      level: 'debug',
      destination: { write: (line: string) => capturedLogLines.push(line) },
    }).child({ module: 'worker' }),
  };
});

jest.mock('@/lib/services/resolve-vc-service', () => ({ resolveVcService: jest.fn() }));

// pg-boss ships as ESM the RI's Jest resolver cannot load, and app-job-queue
// imports the wrapper around it. Only the constructor is stubbed out; the
// error channel this suite exercises is the real one.
jest.mock('@/lib/jobs/pg-boss-job-queue', () => ({ PgBossJobQueue: class {} }));

import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import {
  CheckResult,
  CheckRunState,
  CredentialDetailsStatus,
  CoreCredentialType,
  LibraryRecordOrigin,
  type CheckRun,
  type Credential,
  type LibraryRecord,
} from '@/lib/prisma/generated';
import type { LibraryRecordDetailView } from '@/lib/library/library-record-view';
import { verifyGenerationHandler, type VerifyGenerationDependencies } from '@/lib/library/verify-generation-job';
import { reportQueueError } from '@/lib/jobs/app-job-queue';
import type { JobContext } from '@/lib/jobs/types';

const RECORD_ID = 'crec0000000000000000000001';
const RUN_ID = 'crun0000000000000000000002';
const TENANT_ID = 'tenant-1';
const SENTINEL_KEY = 'deadbeefcafe0042'.repeat(4);

const CREDENTIAL = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: 'EnvelopedVerifiableCredential',
  id: 'data:application/vc+jwt,header.payload.signature',
};

function run(): CheckRun {
  return {
    id: RUN_ID,
    recordId: RECORD_ID,
    tenantId: TENANT_ID,
    generation: 2,
    state: CheckRunState.PENDING,
    retrieval: CheckResult.NOT_RUN,
    decryption: CheckResult.NOT_RUN,
    digest: CheckResult.NOT_RUN,
    proof: CheckResult.NOT_RUN,
    status: CheckResult.NOT_RUN,
    temporal: CheckResult.NOT_RUN,
    schemaConformance: CheckResult.NOT_RUN,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    sourceChanged: null,
    lastSourceCheckAt: null,
    requestedAt: new Date('2026-09-07T00:00:00.000Z'),
    completedAt: null,
    lastEnqueuedAt: new Date('2026-09-07T00:00:00.000Z'),
    schemaConformanceMessage: null,
  };
}

function record(): LibraryRecordDetailView {
  const now = new Date('2026-09-07T00:00:00.000Z');
  const parent: LibraryRecord = {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.NATIVE,
    name: 'Native credential',
    issuerName: 'Issuer',
    issuerDid: 'did:web:issuer.example',
    subjectName: 'Subject',
    subjectId: 'https://issuer.example/subject',
    validFrom: now,
    validUntil: null,
    credentialType: 'DigitalProductPassport',
    coreCredentialType: CoreCredentialType.DPP,
    coreDataModelVersion: '0.6.0',
    detailsStatus: CredentialDetailsStatus.EXTRACTED,
    detailsError: null,
    createdAt: now,
    updatedAt: now,
  };
  const credential: Credential = {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.NATIVE,
    storageUri: 'https://storage.example/native/credential',
    digestMultibase: 'zStoredDigest',
    decryptionKey: 'protected-receiver-key',
    isPublished: false,
    organisationId: null,
    facilityId: null,
    productId: null,
    createdAt: now,
    updatedAt: now,
  };
  return { origin: LibraryRecordOrigin.NATIVE, record: parent, credential, checkRun: run() };
}

function encryptedCopy(): Uint8Array {
  const quiet = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => quiet,
  };
  const encryption = new AesGcmEncryptionAdapter(SENTINEL_KEY, {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => quiet,
  } as never);
  return new TextEncoder().encode(
    JSON.stringify(encryption.encrypt(JSON.stringify(CREDENTIAL), EncryptionAlgorithm.AES_256_GCM)),
  );
}

const JOB = { tenantId: TENANT_ID, recordId: RECORD_ID, generation: 2, checkRunId: RUN_ID };

function jobContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 'job-1',
    attempt: 1,
    isFinalAttempt: true,
    expireSeconds: 300,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function dependencies(overrides: Partial<VerifyGenerationDependencies> = {}): VerifyGenerationDependencies {
  return {
    findRun: jest.fn().mockResolvedValue(run()),
    getRecord: jest.fn().mockResolvedValue(record()),
    fetchStoredCopy: jest.fn().mockResolvedValue(encryptedCopy()),
    revealStoredKey: jest.fn().mockReturnValue(SENTINEL_KEY),
    verifyDigest: jest.fn().mockResolvedValue(true),
    resolveVerifier: jest.fn().mockResolvedValue({ verify: jest.fn().mockResolvedValue({ verified: true }) }),
    checkSchemaConformance: jest.fn().mockResolvedValue({ result: CheckResult.NOT_RUN, message: null }),
    settleComplete: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    settleFailed: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    ...overrides,
  };
}

/** The rendered error-level lines, parsed back from what the logger wrote. */
function errorLines(): Array<Record<string, unknown>> {
  return capturedLogLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.level === 50);
}

beforeEach(() => {
  capturedLogLines.length = 0;
});

describe('worker verification log output', () => {
  it('renders non-empty lines without the receiver key or an injected key-bearing cause', async () => {
    // Fails if the worker logs the native receiver key, serialises an error
    // cause containing it, or if the capture is detached from production logs.
    // The sentinel rides inside a nested Error, not as a plain string cause.
    // Pino's serialiser follows error-like causes and folds their messages
    // into one line, and drops a cause that is only a string, so a string
    // cause would make this suite pass without proving anything.
    const verifierFailure = new Error('verifier failed', { cause: new Error(`key ${SENTINEL_KEY} rejected`) });
    const deps: VerifyGenerationDependencies = {
      findRun: jest.fn().mockResolvedValue(run()),
      getRecord: jest.fn().mockResolvedValue(record()),
      fetchStoredCopy: jest.fn().mockResolvedValue(encryptedCopy()),
      revealStoredKey: jest.fn().mockReturnValue(SENTINEL_KEY),
      verifyDigest: jest.fn().mockResolvedValue(true),
      resolveVerifier: jest.fn().mockResolvedValue({
        verify: jest.fn().mockRejectedValue(verifierFailure),
      }),
      checkSchemaConformance: jest.fn().mockResolvedValue({ result: CheckResult.NOT_RUN, message: null }),
      settleComplete: jest.fn(),
      settleFailed: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    };

    await verifyGenerationHandler(deps)(
      { tenantId: TENANT_ID, recordId: RECORD_ID, generation: 2, checkRunId: RUN_ID },
      {
        jobId: 'job-1',
        attempt: 1,
        isFinalAttempt: true,
        expireSeconds: 300,
        signal: new AbortController().signal,
      },
    );

    expect(capturedLogLines.length).toBeGreaterThan(0);
    expect(capturedLogLines.join('')).not.toContain(SENTINEL_KEY);
    expect(deps.revealStoredKey).toHaveBeenCalledWith('protected-receiver-key');
    // The run row here is a real re-verification generation: every check
    // NOT_RUN. Fails if the failed settlement reports the row rather than what
    // the worker established before the verifier was asked.
    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        checks: {
          retrieval: CheckResult.PASS,
          decryption: CheckResult.PASS,
          digest: CheckResult.PASS,
          proof: CheckResult.NOT_RUN,
          status: CheckResult.NOT_RUN,
          temporal: CheckResult.NOT_RUN,
          schemaConformance: CheckResult.NOT_RUN,
        },
      }),
    );
  });

  it('keeps the injected cause out of the queue error channel on an attempt it rethrows', async () => {
    // A non-final failure is rethrown, and the queue reports it through
    // app-job-queue's error channel rather than the worker's own line. Fails
    // if that channel logs the exception itself, whose cause chain pino folds
    // into one message.
    const verifierFailure = new Error('verifier failed', { cause: new Error(`key ${SENTINEL_KEY} rejected`) });
    const deps = dependencies({
      resolveVerifier: jest.fn().mockResolvedValue({ verify: jest.fn().mockRejectedValue(verifierFailure) }),
    });

    const rethrown = await verifyGenerationHandler(deps)(JOB, jobContext({ isFinalAttempt: false })).then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(rethrown).toBeInstanceOf(Error);
    reportQueueError(rethrown as Error);

    expect(capturedLogLines.length).toBeGreaterThan(0);
    expect(capturedLogLines.join('')).not.toContain(SENTINEL_KEY);
    expect(capturedLogLines.join('')).toContain('Job queue reported an error');
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it('raises an operator line naming what was observed when a copy fails its integrity check', async () => {
    // Proven corruption is not something the caller can act on, so it gets an
    // error-level line of its own carrying the record, the tenant, the
    // generation and what was seen. Fails if the only signal is the caller's
    // warning, which an operator's alerting does not read.
    const deps = dependencies({ verifyDigest: jest.fn().mockResolvedValue(false) });

    await verifyGenerationHandler(deps)(JOB, jobContext({ isFinalAttempt: true }));

    const operatorLine = errorLines().find((line) => line.classification === 'digest-mismatch');
    expect(operatorLine).toMatchObject({
      classification: 'digest-mismatch',
      recordId: RECORD_ID,
      tenantId: TENANT_ID,
      generation: 2,
      checkRunId: RUN_ID,
      msg: 'A durable copy read back does not match the digest recorded when it was stored',
    });
    expect(capturedLogLines.join('')).not.toContain(SENTINEL_KEY);
  });

  it('points the operator at the encryption audit when a stored key will not unwrap, and asserts nothing about the key', async () => {
    // A rotated-away key and a damaged envelope fail identically here. Fails
    // if the line claims the master key is wrong, or if it leaves the
    // operator with no command to tell the two apart.
    const deps = dependencies({
      revealStoredKey: jest.fn(() => {
        throw new Error('Failed to decrypt the stored credential decryption key.');
      }),
    });

    await verifyGenerationHandler(deps)(JOB, jobContext({ isFinalAttempt: true }));

    const operatorLine = errorLines().find((line) => line.classification === 'stored-key-unwrap-failed');
    expect(operatorLine).toMatchObject({
      recordId: RECORD_ID,
      tenantId: TENANT_ID,
      generation: 2,
      msg: 'A stored decryption key did not unwrap under the active DATA_ENCRYPTION_KEY; run audit:encryption to see which stored envelopes are affected',
    });
    expect(String(operatorLine?.msg)).not.toMatch(/is wrong|incorrect key|wrong key/i);
    expect(capturedLogLines.join('')).not.toContain(SENTINEL_KEY);
  });
});
