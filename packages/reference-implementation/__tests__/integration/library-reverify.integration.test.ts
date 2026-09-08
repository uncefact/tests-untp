import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IVerifiableCredentialService } from '@uncefact/untp-ri-services';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
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
import { createReverificationGeneration } from '../../src/lib/prisma/repositories/check-run.repository';
import { reverifyLibraryRecord } from '../../src/lib/library/reverify-library-record';
import {
  defaultVerifyGenerationDependencies,
  LIBRARY_VERIFY_JOB,
  VERIFY_JOB_ENQUEUE_OPTIONS,
  verifyGenerationHandler,
} from '../../src/lib/library/verify-generation-job';

jest.unmock('jose');

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

const prisma = createRigClient();
let fixtures: FixtureServer;
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
  };
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
      coreDataModelVersion: '0.6.0',
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

describe('re-verify a library record through Postgres and pg-boss', () => {
  beforeAll(async () => {
    fixtures = await startFixtureServer();
    await senderQueue.start();
    await senderQueue.declareQueue(LIBRARY_VERIFY_JOB);
    registerPendingRunReconciliation(sweepQueue, defaultReconcilePendingRunsDependencies());
    await sweepQueue.start();
    await sweepQueue.schedule(LIBRARY_RECONCILE_PENDING_RUNS_JOB, DEFAULT_RECONCILE_PENDING_RUNS_CRON);
  });

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await seedSystemTenant(prisma);
    await prisma.$executeRawUnsafe(
      `DELETE FROM pgboss.job WHERE name IN ('${LIBRARY_VERIFY_JOB}', '${LIBRARY_RECONCILE_PENDING_RUNS_JOB}')`,
    );
    fixtures.set('/storage/native.json', { body: DPP_TEXT });
    fixtures.set('/supplier/credential.json', { body: DPP_TEXT });
    fixtures.set('/storage/protected.json', { body: DPP_TEXT });
    senderErrors.splice(0);
    sweepErrors.splice(0);
  });

  afterEach(() => {
    expect(senderErrors.splice(0)).toEqual([]);
    expect(sweepErrors.splice(0)).toEqual([]);
  });

  afterAll(async () => {
    await sweepQueue.unschedule(LIBRARY_RECONCILE_PENDING_RUNS_JOB);
    await senderQueue.stop();
    await sweepQueue.stop();
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
    const handler = verifyGenerationHandler({
      ...defaultVerifyGenerationDependencies(),
      resolveVerifier: async () => verifier,
    });
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
      },
      enqueue,
    });

    expect(result).toEqual({ outcome: 'missing' });
    expect(await prisma.checkRun.count({ where: { recordId: native.id } })).toBe(0);
    expect(await jobsFor(native.id)).toHaveLength(0);
  });

  it('settles a stored key that will not unwrap as retryable, and the detail projection then refuses the record', async () => {
    // The interim mapping shared with #769. The caller is told to re-verify
    // once access is restored, and cannot read that settled generation off the
    // detail route until an operator restores the key. Fails if the unwrap
    // failure is settled as proven loss, or if the detail projection quietly
    // publishes a record whose key it could not open.
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
    // The keyless projection still answers, so the record is readable through
    // every surface that does not open the key. The detail route's own reveal
    // is what fails, and it answers the sanitised 500 that #769 tracks.
    expect(() => toCredentialRecord(settled as never)).not.toThrow();
    expect(() => toCredentialRecordDetail(settled as never, { reveal: revealDecryptionKey })).toThrow(
      /Failed to decrypt the stored credential decryption key/,
    );
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
