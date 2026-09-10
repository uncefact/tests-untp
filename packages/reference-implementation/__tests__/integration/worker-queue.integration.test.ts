import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import type { IStorageService, IVerifiableCredentialService, StorageRecord } from '@uncefact/untp-ri-services';
import { buildUntpArtefactUrls } from '@uncefact/untp-utils/artefacts';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { CheckResult, CheckRunFailureCode, CheckRunState, CoreCredentialType } from '../../src/lib/prisma/generated';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import { waitFor } from './rig/wait-for';
import { seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import { PgBossJobQueue } from '../../src/lib/jobs/pg-boss-job-queue';
import type { JobHandler } from '../../src/lib/jobs/types';
import { LIBRARY_VERIFY_JOB } from '../../src/lib/jobs/queue-names';
import {
  createExternalCredential,
  findExternalByContentDigest,
  getExternalCredentialById,
  type VerifyJobReference,
} from '../../src/lib/prisma/repositories/external-credential.repository';
import { fetchCredentialDocument } from '../../src/lib/credentials/fetch-credential-document';
import { getEncryptionService } from '../../src/lib/encryption/encryption';
import { registerExternalCredential } from '../../src/lib/library/register-external-credential';
import { defaultVerifyGenerationDependencies, registerLibraryJobs } from '../../src/lib/library/verify-generation-job';

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

jest.unmock('jose');

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.SERVICE_ENCRYPTION_KEY;

const TEST_QUEUE = 'integration.worker-queue-handler';
const STORAGE_KEY = 'b'.repeat(64);
const TEST_RETRY_OPTIONS = {
  retry: { limit: 2, backoffSeconds: 1, backoffMaxSeconds: 1 },
  expireSeconds: 30,
};
const REDELIVERY_OPTIONS = {
  retry: { limit: 1, backoffSeconds: 1, backoffMaxSeconds: 1 },
  expireSeconds: 30,
};

const VCDM_CONTEXT_URL = 'https://www.w3.org/ns/credentials/v2';
const { schemaUrl: DPP_070_SCHEMA_URL, contextUrl: UNTP_070_CONTEXT_URL } = buildUntpArtefactUrls(
  'DigitalProductPassport',
  '0.7.0',
);

const CREDENTIAL = envelopedCredential({
  '@context': [VCDM_CONTEXT_URL, UNTP_070_CONTEXT_URL],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  id: 'https://supplier.example/credentials/worker-queue-1',
  name: 'Worker queue integration credential',
  issuer: { id: 'did:web:supplier.example', name: 'Supplier Ltd' },
  validFrom: '2026-07-22T10:00:00Z',
  credentialSubject: {
    type: ['Product'],
    id: 'https://supplier.example/products/worker-queue',
    name: 'Battery pack',
    idScheme: {
      type: ['IdentifierScheme'],
      id: 'https://supplier.example/identifiers/',
      name: 'Supplier identifier scheme',
    },
    idGranularity: 'batch',
    producedAtFacility: {
      type: ['Facility'],
      id: 'https://supplier.example/facilities/worker-queue',
      name: 'Supplier facility',
    },
    countryOfProduction: { countryCode: 'AU', countryName: 'Australia' },
    productCategory: [
      {
        code: 'worker-queue',
        name: 'Battery pack',
        schemeId: 'https://supplier.example/schemes/product-category',
        schemeName: 'Supplier product category scheme',
      },
    ],
  },
});
const CREDENTIAL_TEXT = JSON.stringify(CREDENTIAL);

const quiet = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quiet,
};

type QueueJobRow = {
  id: string;
  state: string;
  retryCount: number;
  retryLimit: number;
  expireSeconds: number;
  completedOn: Date | null;
  startAfter: Date;
};

type ManagedQueue = { queue: PgBossJobQueue; errors: Error[] };

const prisma = createRigClient();
let fixtures: FixtureServer;
const realFetch = globalThis.fetch.bind(globalThis);
const externalFixtureMap = new Map<string, string>();
let storageSequence = 0;
let enqueueOptions = TEST_RETRY_OPTIONS;
let currentVerifier: IVerifiableCredentialService;
const managedQueues: ManagedQueue[] = [];

function envelopedCredential(payload: object): Record<string, unknown> {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${b64({ alg: 'ES256', typ: 'vc+jwt' })}.${b64(payload)}.sig`;
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: `data:application/vc+jwt,${jwt}`,
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
  fixtures.set('/remote/context/vcdm/2/credentials.json', {
    body: artefactFixture('context/vcdm/2/credentials.json'),
  });
  fixtures.set('/remote/context/untp/0.7.0/untp.json', {
    body: artefactFixture('context/untp/0.7.0/untp.json'),
  });
  externalFixtureMap.set(DPP_070_SCHEMA_URL, '/remote/schema/untp/0.7.0/dpp.json');
  externalFixtureMap.set(VCDM_CONTEXT_URL, '/remote/context/vcdm/2/credentials.json');
  externalFixtureMap.set(UNTP_070_CONTEXT_URL, '/remote/context/untp/0.7.0/untp.json');
}

function requestUrlOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function installFixtureFetch(): void {
  globalThis.fetch = (async (input, init) => {
    const requestUrl = requestUrlOf(input);
    if (new URL(requestUrl).origin === fixtures.baseUrl) return realFetch(input, init);
    const fixturePath = externalFixtureMap.get(requestUrl);
    if (fixturePath === undefined)
      throw new Error(`integration fixture attempted an unmapped network request: ${requestUrl}`);
    return realFetch(`${fixtures.baseUrl}${fixturePath}`, init);
  }) as typeof globalThis.fetch;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setVerifier(): jest.Mock<ReturnType<IVerifiableCredentialService['verify']>, [unknown]> {
  const verify = jest.fn<ReturnType<IVerifiableCredentialService['verify']>, [unknown]>();
  currentVerifier = { sign: jest.fn(), verify: verify as never };
  return verify;
}

function newManagedQueue(): ManagedQueue {
  const errors: Error[] = [];
  const managed = {
    queue: new PgBossJobQueue({
      connectionString: process.env.RI_DATABASE_URL as string,
      onError: (error) => errors.push(error),
    }),
    errors,
  };
  managedQueues.push(managed);
  return managed;
}

async function startLibraryQueue(): Promise<ManagedQueue> {
  const managed = newManagedQueue();
  registerLibraryJobs(managed.queue, {
    ...defaultVerifyGenerationDependencies(),
    resolveVerifier: async () => currentVerifier,
  });
  await managed.queue.start();
  return managed;
}

async function startQueue<P extends object>(name: string, handler: JobHandler<P>): Promise<ManagedQueue> {
  const managed = newManagedQueue();
  managed.queue.register(name, handler);
  await managed.queue.start();
  return managed;
}

async function digest(bytes: Uint8Array): Promise<string> {
  return (await MultibaseDigest.fromData(bytes, { algorithm: 'sha2-256', base: 'base58btc' })).toString();
}

const storage: IStorageService = {
  async store(credential: Parameters<IStorageService['store']>[0], encrypt = false): Promise<StorageRecord> {
    const plaintext = Buffer.from(JSON.stringify(credential), 'utf8');
    const externalId = `worker-queue-${++storageSequence}`;
    const body = encrypt
      ? Buffer.from(
          JSON.stringify(
            new AesGcmEncryptionAdapter(STORAGE_KEY, quiet as never).encrypt(
              plaintext.toString('utf8'),
              EncryptionAlgorithm.AES_256_GCM,
            ),
          ),
          'utf8',
        )
      : plaintext;
    fixtures.set(`/storage/${externalId}`, { body, contentType: 'application/json' });
    return {
      uri: `${fixtures.baseUrl}/storage/${externalId}`,
      digestMultibase: await digest(plaintext),
      decryptionKey: encrypt ? STORAGE_KEY : undefined,
      externalId,
      bucket: encrypt ? 'private' : 'public',
      mimeType: 'application/json',
    };
  },
  async storeBinary(): Promise<StorageRecord> {
    throw new Error('worker queue integration does not store binary content');
  },
  async delete() {},
};

function registerDependencies(queue: PgBossJobQueue) {
  return {
    fetchDocument: (href: string) => fetchCredentialDocument(href, { maxBytes: 1_000_000, timeoutMs: 5_000 }),
    resolveStorage: async () => ({ service: storage, instanceId: 'worker-queue-storage' }),
    assertEncryptionReady: () => {
      getEncryptionService();
    },
    enqueueVerification: (sql: Parameters<typeof queue.enqueueWithin>[0], job: VerifyJobReference) =>
      queue.enqueueWithin(sql, LIBRARY_VERIFY_JOB, job, enqueueOptions),
    persist: createExternalCredential,
    findExistingExternal: findExternalByContentDigest,
  };
}

async function registerCredential(queue: PgBossJobQueue) {
  return registerExternalCredential(
    {
      tenantId: SYSTEM_TENANT_ID,
      sourceUrl: `${fixtures.baseUrl}/credential.json`,
      annotations: { displayName: 'Worker queue credential', declaredCredentialType: CoreCredentialType.DPP },
    },
    registerDependencies(queue),
  );
}

async function readLibraryJob(recordId: string): Promise<QueueJobRow | null> {
  // Contract pin: pg-boss 12.29.0 ships schema.json version 39 with these
  // pgboss.job columns and the created, retry, active and completed states.
  const rows = await prisma.$queryRawUnsafe<QueueJobRow[]>(
    `
      SELECT id, state::text AS state, retry_count AS "retryCount", retry_limit AS "retryLimit",
             expire_seconds AS "expireSeconds", completed_on AS "completedOn", start_after AS "startAfter"
      FROM pgboss.job
      WHERE name = $1 AND data->>'recordId' = $2
      ORDER BY created_on DESC
    `,
    LIBRARY_VERIFY_JOB,
    recordId,
  );
  if (rows.length > 1) throw new Error(`Expected one verification job for ${recordId}, found ${rows.length}`);
  return rows[0] ?? null;
}

async function readTestJob(testId: string): Promise<QueueJobRow | null> {
  // Contract pin: pg-boss 12.29.0 ships schema.json version 39 with these
  // pgboss.job columns and the created, retry, active and completed states.
  const rows = await prisma.$queryRawUnsafe<QueueJobRow[]>(
    `
      SELECT id, state::text AS state, retry_count AS "retryCount", retry_limit AS "retryLimit",
             expire_seconds AS "expireSeconds", completed_on AS "completedOn", start_after AS "startAfter"
      FROM pgboss.job
      WHERE name = $1 AND data->>'testId' = $2
      ORDER BY created_on DESC
    `,
    TEST_QUEUE,
    testId,
  );
  if (rows.length > 1) throw new Error(`Expected one test job for ${testId}, found ${rows.length}`);
  return rows[0] ?? null;
}

async function scheduledLibraryJobs(recordId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `
      SELECT count(*)::int AS count
      FROM pgboss.job
      WHERE name = $1 AND data->>'recordId' = $2
        AND state::text IN ('created', 'retry', 'active')
    `,
    LIBRARY_VERIFY_JOB,
    recordId,
  );
  return Number(rows[0]?.count ?? 0);
}

async function clearQueueJobs(): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name IN ($1, $2)`, LIBRARY_VERIFY_JOB, TEST_QUEUE);
}

function assertNoQueueErrors(managed: ManagedQueue): void {
  expect(managed.errors).toEqual([]);
}

function assertExpectedAbandonedShutdownError(managed: ManagedQueue): void {
  expect(managed.errors).toHaveLength(1);
  expect(managed.errors[0]?.message).toContain('Database connection is not opened');
  managed.errors.length = 0;
}

describe('worker queue guarantees against Postgres and pg-boss', () => {
  beforeAll(async () => {
    fixtures = await startFixtureServer();
    fixtures.set('/credential.json', { body: CREDENTIAL_TEXT });
    registerSchemaAndContextFixtures();
    installFixtureFetch();

    // Start once before the first test so the pg-boss schema exists for the
    // per-test cleanup query. No handlers are registered, so another suite's
    // leftover job cannot be consumed during setup.
    const bootstrap = newManagedQueue();
    await bootstrap.queue.start();
    await bootstrap.queue.stop();
    await clearQueueJobs();
  });

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await seedSystemTenant(prisma);
    await clearQueueJobs();
    enqueueOptions = TEST_RETRY_OPTIONS;
    storageSequence = 0;
    fixtures.set('/credential.json', { body: CREDENTIAL_TEXT });
    setVerifier().mockResolvedValue({ verified: true });
  });

  afterEach(async () => {
    const errors: unknown[] = [];
    for (const managed of [...managedQueues].reverse()) {
      try {
        await managed.queue.stop();
      } catch (error) {
        errors.push(error);
      }
    }
    managedQueues.length = 0;
    await clearQueueJobs();
    expect(errors).toEqual([]);
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await fixtures.close();
    await prisma.$disconnect();
  });

  it('retries a registered credential twice, then completes on the final delivery', async () => {
    // Fails if retry.limit is ignored, if the first transient verifier error
    // settles the run, or if final-attempt metadata is calculated too early.
    const managed = await startLibraryQueue();
    let failures = 2;
    const deliveries: { attempt: number; isFinalAttempt: boolean }[] = [];
    const verify = setVerifier();
    const verifierReady = deferred();
    let recordId: string | undefined;
    verify.mockImplementation(async () => {
      await verifierReady.promise;
      if (recordId === undefined) throw new Error('verification record was not registered');
      const job = await readLibraryJob(recordId);
      if (job === null) throw new Error('verification job row was not visible to the verifier');
      deliveries.push({ attempt: job.retryCount + 1, isFinalAttempt: job.retryCount >= job.retryLimit });
      if (failures-- > 0) throw new Error('verifier unavailable');
      return { verified: true };
    });
    const registered = await registerCredential(managed.queue);
    recordId = registered.record.id;
    verifierReady.resolve();
    const settled = await waitFor(
      () => getExternalCredentialById(registered.record.id, SYSTEM_TENANT_ID),
      (record): record is NonNullable<typeof record> => record?.checkRun.state === CheckRunState.COMPLETE,
    );
    if (settled === null) throw new Error('completed verification record was not returned');
    const job = await waitFor(
      () => readLibraryJob(registered.record.id),
      (row): row is QueueJobRow => row?.state === 'completed',
    );

    expect(deliveries).toEqual([
      { attempt: 1, isFinalAttempt: false },
      { attempt: 2, isFinalAttempt: false },
      { attempt: 3, isFinalAttempt: true },
    ]);
    expect(job).toMatchObject({ retryCount: 2, retryLimit: 2, expireSeconds: TEST_RETRY_OPTIONS.expireSeconds });
    expect(settled.checkRun).toMatchObject({
      generation: 1,
      state: CheckRunState.COMPLETE,
      retrieval: CheckResult.PASS,
      digest: CheckResult.PASS,
      proof: CheckResult.PASS,
      schemaConformance: CheckResult.PASS,
      failureCode: null,
    });
    expect(await scheduledLibraryJobs(registered.record.id)).toBe(0);
    expect(managed.errors).toHaveLength(2);
    managed.errors.length = 0;
  });

  it('settles an always-unavailable verifier as failed on the final delivery with no scheduled retry', async () => {
    // Fails if a final transient failure is left pending, if the failure code
    // is changed, or if the queue leaves a retryable row after settlement.
    const managed = await startLibraryQueue();
    const verify = setVerifier();
    verify.mockRejectedValue(new Error('verifier unavailable'));
    const registered = await registerCredential(managed.queue);

    const settled = await waitFor(
      () => getExternalCredentialById(registered.record.id, SYSTEM_TENANT_ID),
      (record): record is NonNullable<typeof record> => record?.checkRun.state === CheckRunState.FAILED,
    );
    if (settled === null) throw new Error('failed verification record was not returned');
    const job = await waitFor(
      () => readLibraryJob(registered.record.id),
      (row): row is QueueJobRow => row?.state === 'completed',
    );

    expect(settled.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
      failureRetryable: true,
      schemaConformance: CheckResult.PASS,
    });
    expect(job).toMatchObject({ retryCount: 2, retryLimit: 2 });
    expect(await scheduledLibraryJobs(registered.record.id)).toBe(0);
    expect(managed.errors).toHaveLength(2);
    managed.errors.length = 0;
  });

  it('gracefully drains an in-flight handler and completes the job without re-queueing it', async () => {
    // Fails if stop uses graceful: false, interrupts a handler that can finish,
    // or marks the completed job as retryable after the drain.
    const entered = deferred();
    const release = deferred();
    const managed = await startQueue<{ testId: string }>(TEST_QUEUE, async () => {
      entered.resolve();
      await release.promise;
    });
    const testId = randomUUID();
    await managed.queue.enqueue(TEST_QUEUE, { testId }, TEST_RETRY_OPTIONS);
    await entered.promise;

    const stopping = managed.queue.stop({ drainTimeoutMs: 2_000 });
    release.resolve();
    await stopping;

    const job = await waitFor(
      () => readTestJob(testId),
      (row): row is QueueJobRow => row?.state === 'completed',
    );
    expect(job).toMatchObject({ retryCount: 0, retryLimit: 2 });
    assertNoQueueErrors(managed);
  });

  it('redelivers after a drain timeout and preserves the registered generation when the fresh queue settles it', async () => {
    // Fails if a timed-out handler is lost instead of re-queued, or if the
    // second delivery creates a duplicate generation or loses settled checks.
    enqueueOptions = REDELIVERY_OPTIONS;
    const entered = deferred();
    const abandoned = deferred();
    const first = await startQueue<VerifyJobReference>(LIBRARY_VERIFY_JOB, async () => {
      entered.resolve();
      await abandoned.promise;
    });
    const registered = await registerCredential(first.queue);
    await entered.promise;
    const initialStorageId = registered.external.storageExternalId;
    const stoppedAt = Date.now();
    await first.queue.stop({ drainTimeoutMs: 50 });
    assertExpectedAbandonedShutdownError(first);

    const retried = await waitFor(
      () => readLibraryJob(registered.record.id),
      (row): row is QueueJobRow => row?.state === 'retry' && row.retryCount === 0,
    );
    if (retried === null) throw new Error('timed-out verification job was not re-queued');
    expect(retried.retryLimit).toBe(1);

    const verify = setVerifier();
    verify.mockImplementation(async () => {
      return { verified: true };
    });
    const fresh = await startLibraryQueue();
    const settled = await waitFor(
      () => getExternalCredentialById(registered.record.id, SYSTEM_TENANT_ID),
      (record): record is NonNullable<typeof record> => record?.checkRun.state === CheckRunState.COMPLETE,
    );
    if (settled === null) throw new Error('redelivered verification record was not returned');
    const completed = await waitFor(
      () => readLibraryJob(registered.record.id),
      (row): row is QueueJobRow => row?.state === 'completed',
    );

    expect(Date.now() - stoppedAt).toBeLessThan(REDELIVERY_OPTIONS.expireSeconds * 1_000);
    expect(completed).toMatchObject({ retryCount: 1, retryLimit: 1 });
    expect(settled.checkRun).toMatchObject({
      generation: 1,
      state: CheckRunState.COMPLETE,
      retrieval: CheckResult.PASS,
      digest: CheckResult.PASS,
      proof: CheckResult.PASS,
      schemaConformance: CheckResult.PASS,
    });
    expect(await prisma.checkRun.count({ where: { recordId: registered.record.id } })).toBe(1);
    expect((await getExternalCredentialById(registered.record.id, SYSTEM_TENANT_ID))?.external.storageExternalId).toBe(
      initialStorageId,
    );
    assertNoQueueErrors(fresh);
  });

  it('approximates abrupt worker death with expiry-backed redelivery and idempotent settlement', async () => {
    // The real worker bootstrap has no verifier seam, so S3 permits this
    // stopped-consumer approximation. It fails if expiry does not make the
    // job claimable by a fresh queue or if settlement creates another run.
    enqueueOptions = REDELIVERY_OPTIONS;
    const entered = deferred();
    const abandoned = deferred();
    const first = await startQueue<VerifyJobReference>(LIBRARY_VERIFY_JOB, async () => {
      entered.resolve();
      await abandoned.promise;
    });
    const registered = await registerCredential(first.queue);
    await entered.promise;
    const initialStorageId = registered.external.storageExternalId;
    const stoppedAt = Date.now();
    await first.queue.stop({ drainTimeoutMs: 50 });
    assertExpectedAbandonedShutdownError(first);

    const retried = await waitFor(
      () => readLibraryJob(registered.record.id),
      (row): row is QueueJobRow => row?.state === 'retry' && row.retryCount === 0,
    );
    expect(retried).toMatchObject({ retryLimit: 1, expireSeconds: REDELIVERY_OPTIONS.expireSeconds });

    const verify = setVerifier();
    verify.mockResolvedValue({ verified: true });
    const fresh = await startLibraryQueue();
    const settled = await waitFor(
      () => getExternalCredentialById(registered.record.id, SYSTEM_TENANT_ID),
      (record): record is NonNullable<typeof record> => record?.checkRun.state === CheckRunState.COMPLETE,
    );
    if (settled === null) throw new Error('redelivered verification record was not returned');
    const completed = await waitFor(
      () => readLibraryJob(registered.record.id),
      (row): row is QueueJobRow => row?.state === 'completed',
    );

    expect(Date.now() - stoppedAt).toBeLessThan(REDELIVERY_OPTIONS.expireSeconds * 1_000);
    expect(completed).toMatchObject({ retryCount: 1, retryLimit: 1 });
    expect(settled.checkRun).toMatchObject({
      generation: 1,
      state: CheckRunState.COMPLETE,
      retrieval: CheckResult.PASS,
      digest: CheckResult.PASS,
      proof: CheckResult.PASS,
      schemaConformance: CheckResult.PASS,
    });
    expect(await prisma.checkRun.count({ where: { recordId: registered.record.id } })).toBe(1);
    expect((await getExternalCredentialById(registered.record.id, SYSTEM_TENANT_ID))?.external.storageExternalId).toBe(
      initialStorageId,
    );
    assertNoQueueErrors(fresh);
  });
});
