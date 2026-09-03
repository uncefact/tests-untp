import { randomUUID } from 'node:crypto';
import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import type { IStorageService, IVerifiableCredentialService, StorageRecord } from '@uncefact/untp-ri-services';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsStatus,
  ExternalContentKind,
  IdempotencyOperation,
} from '../../src/lib/prisma/generated';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import { seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import { PgBossJobQueue } from '../../src/lib/jobs/pg-boss-job-queue';
import type { JobContext } from '../../src/lib/jobs/types';
import {
  createExternalCredential,
  getExternalCredentialById,
  type VerifyJobReference,
} from '../../src/lib/prisma/repositories/external-credential.repository';
import { claimIdempotencyKey, findIdempotencyKey } from '../../src/lib/prisma/repositories/idempotency-key.repository';
import { fetchCredentialDocument } from '../../src/lib/credentials/fetch-credential-document';
import { getEncryptionService } from '../../src/lib/encryption/encryption';
import {
  registerExternalCredential,
  type RegisterExternalCredentialDependencies,
} from '../../src/lib/library/register-external-credential';
import {
  defaultVerifyGenerationDependencies,
  LIBRARY_VERIFY_JOB,
  VERIFY_JOB_ENQUEUE_OPTIONS,
  verifyGenerationHandler,
} from '../../src/lib/library/verify-generation-job';
import { toCredentialRecord } from '../../src/lib/library/credential-record-projection';
import { revealDecryptionKey } from '../../src/lib/credentials/decryption-key-protection';

// The unit suites' manual mock of jose (src/__mocks__/jose.ts) is picked up
// here too, because jest registers every __mocks__ directory under its roots
// as a node-module mock. This suite decodes real JWT payloads, so the real
// module is restored.
jest.unmock('jose');

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.SERVICE_ENCRYPTION_KEY;

const SUPPLIER_KEY = 'b'.repeat(64);

const quiet = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quiet,
};

function envelopedCredential(payload: object): Record<string, unknown> {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${b64({ alg: 'ES256', typ: 'vc+jwt' })}.${b64(payload)}.sig`;
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: `data:application/vc+jwt,${jwt}`,
  };
}

const DPP = envelopedCredential({
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/'],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  name: 'Battery pack passport',
  issuer: { id: 'did:web:supplier.example', name: 'Supplier Ltd' },
  validFrom: '2026-07-22T10:00:00Z',
  credentialSubject: { id: 'https://supplier.example/products/1', name: 'Battery pack' },
});
const DPP_TEXT = JSON.stringify(DPP);
const ENCRYPTED_TEXT = JSON.stringify(
  new AesGcmEncryptionAdapter(SUPPLIER_KEY, quiet as never).encrypt(DPP_TEXT, EncryptionAlgorithm.AES_256_GCM),
);

/**
 * The register pipeline and the verify job against a real database, the
 * real guarded fetch against a loopback fixture server, the real pg-boss
 * queue, and this deployment's storage and verifier replaced at the HTTP
 * boundary by fakes (ADR-029). What is proven here and nowhere else: a
 * registration leaves the rows, the claim link and the job the route relies
 * on, the job's payload is references only, and the handler settles the
 * generation the register left pending.
 */
describe('register an external credential, end to end', () => {
  const prisma = createRigClient();
  const errors: Error[] = [];
  const queue = new PgBossJobQueue({
    connectionString: process.env.RI_DATABASE_URL as string,
    onError: (error) => errors.push(error),
  });
  let fixtures: FixtureServer;

  /**
   * An in-memory storage service that serves what it stored from the fixture
   * server, so the job can read it back. It keeps bytes as it was given them:
   * a fake that decoded to text would hide exactly the loss the pipeline must
   * not have (a byte-order mark, an invalid UTF-8 sequence).
   */
  const stored = new Map<string, Buffer>();
  /** What the caller handed storeBinary, before this fake did anything to it. */
  let lastStoredContent: string | Uint8Array | undefined;
  /** The raw key the fake last handed back, so a test can prove what the row holds is not it. */
  let lastKey: string | undefined;
  const storage: IStorageService & { failNext?: Error } = {
    async store(credential, encrypt = false) {
      return this.storeBinary(JSON.stringify(credential), 'credential.json', 'application/json', encrypt);
    },
    async storeBinary(content, _filename, contentType, encrypt = false): Promise<StorageRecord> {
      if (storage.failNext) {
        const error = storage.failNext;
        storage.failNext = undefined;
        throw error;
      }
      lastStoredContent = content;
      const externalId = randomUUID();
      const key = encrypt ? randomUUID().replace(/-/g, '').padEnd(64, '0') : undefined;
      lastKey = key;
      const asGiven = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
      const body = key
        ? Buffer.from(
            JSON.stringify(
              new AesGcmEncryptionAdapter(key, quiet as never).encrypt(
                asGiven.toString('utf8'),
                EncryptionAlgorithm.AES_256_GCM,
              ),
            ),
            'utf8',
          )
        : asGiven;
      stored.set(externalId, body);
      fixtures.set(`/storage/${externalId}`, { body, contentType });
      return {
        uri: `${fixtures.baseUrl}/storage/${externalId}`,
        digestMultibase: `zdigest-${externalId}`,
        ...(key ? { decryptionKey: key } : {}),
        externalId,
        bucket: encrypt ? 'private' : 'public',
        mimeType: contentType,
      };
    },
    async delete() {},
  };

  const verify = jest.fn<ReturnType<IVerifiableCredentialService['verify']>, [unknown]>();
  const verifier: IVerifiableCredentialService = { sign: jest.fn(), verify: verify as never };

  const deps: RegisterExternalCredentialDependencies = {
    fetchDocument: (href) => fetchCredentialDocument(href, { maxBytes: 1_000_000, timeoutMs: 5_000 }),
    resolveStorage: async () => ({ service: storage, instanceId: 'storage-fake' }),
    assertEncryptionReady: () => {
      getEncryptionService();
    },
    enqueueVerification: (sql, job) => queue.enqueueWithin(sql, LIBRARY_VERIFY_JOB, job, VERIFY_JOB_ENQUEUE_OPTIONS),
    persist: createExternalCredential,
  };

  const handler = verifyGenerationHandler({
    ...defaultVerifyGenerationDependencies(),
    resolveVerifier: async () => verifier,
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

  async function jobsFor(recordId: string): Promise<VerifyJobReference[]> {
    const rows = await prisma.$queryRawUnsafe<{ data: VerifyJobReference }[]>(
      `SELECT data FROM pgboss.job WHERE name = $1 AND data->>'recordId' = $2`,
      LIBRARY_VERIFY_JOB,
      recordId,
    );
    return rows.map((row) => row.data);
  }

  function register(sourcePath: string, overrides: { decryptionKey?: string; idempotencyClaimId?: string } = {}) {
    return registerExternalCredential(
      {
        tenantId: SYSTEM_TENANT_ID,
        sourceUrl: `${fixtures.baseUrl}${sourcePath}`,
        annotations: { displayName: 'Supplier DPP', declaredCredentialType: CoreCredentialType.DPP },
        ...overrides,
      },
      deps,
    );
  }

  beforeAll(async () => {
    fixtures = await startFixtureServer();
    await queue.start();
    await queue.declareQueue(LIBRARY_VERIFY_JOB);
  });

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await seedSystemTenant(prisma);
    await prisma.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name = '${LIBRARY_VERIFY_JOB}'`);
    verify.mockReset();
    stored.clear();
    fixtures.set('/dpp.json', { body: DPP_TEXT });
    fixtures.set('/page.html', { body: '<html><body>not a credential</body></html>', contentType: 'text/html' });
    fixtures.set('/encrypted.json', { body: ENCRYPTED_TEXT });
  });

  afterEach(() => {
    expect(errors.splice(0)).toEqual([]);
  });

  afterAll(async () => {
    await queue.stop();
    await fixtures.close();
    await prisma.$disconnect();
    expect(errors.splice(0)).toEqual([]);
  });

  it('registers a plaintext credential as pending, with an encrypted copy the job then verifies', async () => {
    const record = await register('/dpp.json');

    expect(record.checkRun).toMatchObject({
      state: CheckRunState.PENDING,
      generation: 1,
      retrieval: CheckResult.PASS,
      decryption: CheckResult.NOT_RUN,
      digest: CheckResult.PASS,
    });
    expect(record.external).toMatchObject({
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      storageServiceInstanceId: 'storage-fake',
      storageBucket: 'private',
    });
    expect(record.external.sourceDigest).toEqual(expect.any(String));
    // The storage key is protected on the way into the row: what is stored is
    // neither the raw key nor anything containing it, and revealing it returns
    // the key the store handed back. Fails if protectDecryptionKey is dropped
    // from the register path, or if the protection stops round-tripping.
    expect(lastKey).toEqual(expect.any(String));
    expect(record.external.decryptionKey).not.toBeNull();
    expect(record.external.decryptionKey).not.toBe(lastKey);
    expect(record.external.decryptionKey).not.toContain(lastKey as string);
    expect(revealDecryptionKey(record.external.decryptionKey as string)).toBe(lastKey);
    expect(record.record).toMatchObject({
      detailsStatus: CredentialDetailsStatus.EXTRACTED,
      coreCredentialType: CoreCredentialType.DPP,
      name: 'Battery pack passport',
      issuerDid: 'did:web:supplier.example',
      validFrom: new Date('2026-07-22T10:00:00Z'),
    });

    // The job carries references only: no content, no key, no URL.
    const jobs = await jobsFor(record.record.id);
    expect(jobs).toEqual([
      { tenantId: SYSTEM_TENANT_ID, recordId: record.record.id, generation: 1, checkRunId: record.checkRun.id },
    ]);

    verify.mockResolvedValueOnce({ verified: true });
    await handler(jobs[0], context());

    expect(verify).toHaveBeenCalledWith(DPP);
    const settled = await getExternalCredentialById(record.record.id, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({
      state: CheckRunState.COMPLETE,
      proof: CheckResult.PASS,
      status: CheckResult.PASS,
      temporal: CheckResult.PASS,
      digest: CheckResult.PASS,
      failureCode: null,
    });
    expect(settled?.checkRun.completedAt).not.toBeNull();
    const projected = toCredentialRecord(settled as NonNullable<typeof settled>);
    expect(projected.verification).toMatchObject({ state: 'complete', summary: 'verified' });
    expect(projected.hasKey).toBe(true);
    expect(projected.issuedAt).toBe('2026-07-22T10:00:00.000Z');
  });

  it('settles a credential the verifier rejects as not conformant, keeping the record and its copy', async () => {
    const record = await register('/dpp.json');
    verify.mockResolvedValueOnce({ verified: false, error: { type: 'status' as never, message: 'revoked' } });

    await handler((await jobsFor(record.record.id))[0], context());

    const settled = await getExternalCredentialById(record.record.id, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({
      state: CheckRunState.COMPLETE,
      status: CheckResult.FAIL,
      proof: CheckResult.NOT_RUN,
    });
    expect(settled?.external.storageUri).toEqual(expect.any(String));
    expect(toCredentialRecord(settled as NonNullable<typeof settled>).verification.summary).toBe('not_conformant');
  });

  it('opens an encrypted source with the supplied key and the job verifies the decrypted copy', async () => {
    const record = await register('/encrypted.json', { decryptionKey: SUPPLIER_KEY });

    expect(record.checkRun).toMatchObject({ state: CheckRunState.PENDING, decryption: CheckResult.PASS });
    expect(record.external.encrypted).toBe(true);
    expect(record.record.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
    // The supplier's key is nowhere in the rows: the stored key is ours, protected.
    const rows = await prisma.externalCredential.findMany();
    expect(JSON.stringify(rows)).not.toContain(SUPPLIER_KEY);

    verify.mockResolvedValueOnce({ verified: true });
    await handler((await jobsFor(record.record.id))[0], context());
    expect(verify).toHaveBeenCalledWith(DPP);
  });

  it('keeps an encrypted source with no key as the unopened ciphertext, failed DECRYPTION_REQUIRED, with no job', async () => {
    const record = await register('/encrypted.json');

    expect(record.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      retrieval: CheckResult.PASS,
      decryption: CheckResult.FAIL,
      failureCode: CheckRunFailureCode.DECRYPTION_REQUIRED,
      failureRetryable: true,
    });
    expect(record.external).toMatchObject({ encrypted: true, decryptionKey: null, storageBucket: 'public' });
    expect(stored.get(record.external.storageExternalId as string)?.equals(Buffer.from(ENCRYPTED_TEXT, 'utf8'))).toBe(
      true,
    );
    expect(record.record.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_PENDING);
    expect(await jobsFor(record.record.id)).toEqual([]);
    const projected = toCredentialRecord(record);
    expect(projected).toMatchObject({ hasKey: false, encrypted: true });
    expect(projected.verification).toMatchObject({ state: 'failed', summary: 'failed' });
  });

  it('stores the unopened ciphertext byte for byte, byte-order mark included', async () => {
    // A decode-to-text step drops the mark, so the durable copy would be
    // three bytes shorter than the body the supplier served. Fails the moment
    // the pipeline stores decoded text rather than the bytes it fetched.
    const served = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ENCRYPTED_TEXT, 'utf8')]);
    fixtures.set('/encrypted-bom.json', { body: served });

    const record = await register('/encrypted-bom.json');

    expect(record.checkRun.failureCode).toBe(CheckRunFailureCode.DECRYPTION_REQUIRED);
    expect(Buffer.from(lastStoredContent as Uint8Array).equals(served)).toBe(true);
    expect(stored.get(record.external.storageExternalId as string)?.equals(served)).toBe(true);
  });

  it('stores a body with an invalid UTF-8 sequence byte for byte', async () => {
    // A lone 0x80 decodes to U+FFFD, which re-encodes as three other bytes.
    // Fails if the stored copy is ever a re-encoding of decoded text.
    const served = Buffer.concat([Buffer.from('binary '), Buffer.from([0x80, 0xff]), Buffer.from(' tail')]);
    fixtures.set('/binary.bin', { body: served, contentType: 'application/octet-stream' });

    const record = await register('/binary.bin');

    expect(record.external.contentKind).toBe(ExternalContentKind.OPAQUE);
    expect(Buffer.from(lastStoredContent as Uint8Array).equals(served)).toBe(true);
  });

  it('fails DECRYPTION_FAILED, distinct from the no-key case, when the key does not open the source', async () => {
    const record = await register('/encrypted.json', { decryptionKey: 'c'.repeat(64) });
    expect(record.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.DECRYPTION_FAILED,
      failureRetryable: true,
    });
    expect(record.external.storageUri).toEqual(expect.any(String));
  });

  it('records a deterministic refusal as RETRIEVAL_FAILED, not retryable, with nothing observed and no job', async () => {
    const record = await register('/missing.json');

    expect(record.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      retrieval: CheckResult.FAIL,
      failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
      failureRetryable: false,
    });
    expect(record.checkRun.failureMessage).toContain('HTTP 404');
    expect(record.external).toMatchObject({ encrypted: null, sourceDigest: null, storageUri: null });
    expect(await jobsFor(record.record.id)).toEqual([]);
  });

  it('records a transient refusal as RETRIEVAL_FAILED, retryable', async () => {
    fixtures.set('/flaky.json', { body: 'later', status: 503 });
    const record = await register('/flaky.json');
    expect(record.checkRun).toMatchObject({
      failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
      failureRetryable: true,
    });
  });

  it('records STORAGE_FAILED with the digest and the extracted fields kept when the copy cannot be written', async () => {
    storage.failNext = new Error('storage down');
    const record = await register('/dpp.json');

    expect(record.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      retrieval: CheckResult.PASS,
      digest: CheckResult.NOT_RUN,
      failureCode: CheckRunFailureCode.STORAGE_FAILED,
      failureRetryable: true,
    });
    expect(record.external).toMatchObject({ storageUri: null, decryptionKey: null, encrypted: false });
    expect(record.external.sourceDigest).toEqual(expect.any(String));
    expect(record.record.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
    expect(await jobsFor(record.record.id)).toEqual([]);
  });

  it('stores a body that is not a credential as fetched and settles it not conformant without asking the verifier', async () => {
    const record = await register('/page.html');

    expect(record.external).toMatchObject({ contentKind: ExternalContentKind.OPAQUE, encrypted: false });
    expect(record.external.decryptionKey).not.toBeNull();
    expect(record.record).toMatchObject({ detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED });
    // An HTML body has no signed form, so the digest check did not apply.
    // Fails if the pending run goes back to a blanket digest PASS.
    expect(record.checkRun).toMatchObject({
      state: CheckRunState.PENDING,
      retrieval: CheckResult.PASS,
      decryption: CheckResult.NOT_RUN,
      digest: CheckResult.NOT_RUN,
    });

    await handler((await jobsFor(record.record.id))[0], context());

    expect(verify).not.toHaveBeenCalled();
    const settled = await getExternalCredentialById(record.record.id, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({ state: CheckRunState.COMPLETE, proof: CheckResult.FAIL });
    expect(toCredentialRecord(settled as NonNullable<typeof settled>).verification.summary).toBe('not_conformant');
  });

  it('leaves the run pending while the verifier is unreachable and retries remain, and fails it on the last attempt', async () => {
    const record = await register('/dpp.json');
    const job = (await jobsFor(record.record.id))[0];
    verify.mockRejectedValue(new Error('verifier down'));

    await expect(handler(job, context({ isFinalAttempt: false }))).rejects.toThrow('verification service');
    expect((await getExternalCredentialById(record.record.id, SYSTEM_TENANT_ID))?.checkRun.state).toBe(
      CheckRunState.PENDING,
    );

    await handler(job, context({ attempt: 5, isFinalAttempt: true }));
    const settled = await getExternalCredentialById(record.record.id, SYSTEM_TENANT_ID);
    expect(settled?.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
      failureRetryable: true,
      retrieval: CheckResult.PASS,
      digest: CheckResult.PASS,
      proof: CheckResult.NOT_RUN,
    });
  });

  it('does nothing when the job is delivered again after the run settled', async () => {
    const record = await register('/dpp.json');
    const job = (await jobsFor(record.record.id))[0];
    verify.mockResolvedValue({ verified: true });

    await handler(job, context());
    await handler(job, context({ attempt: 2 }));

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('links the register claim to the record in the same transaction, and the claim goes with the record', async () => {
    const claim = await claimIdempotencyKey({
      tenantId: SYSTEM_TENANT_ID,
      operation: IdempotencyOperation.LIBRARY_REGISTER,
      key: 'key-1',
      bodyDigest: 'digest-1',
    });
    if (claim.outcome !== 'claimed') throw new Error(`expected a fresh claim, got ${claim.outcome}`);

    const record = await register('/dpp.json', { idempotencyClaimId: claim.claimId });

    const linked = await prisma.idempotencyKey.findUnique({ where: { id: claim.claimId } });
    expect(linked?.recordId).toBe(record.record.id);

    await prisma.libraryRecord.delete({ where: { id: record.record.id } });
    expect(
      await findIdempotencyKey({
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: 'key-1',
        bodyDigest: 'digest-1',
      }),
    ).toEqual({ outcome: 'absent' });
  });
});
