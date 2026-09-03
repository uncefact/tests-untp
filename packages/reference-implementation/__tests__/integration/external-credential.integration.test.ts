import {
  CoreCredentialType,
  CredentialDetailsError,
  CredentialDetailsStatus,
  ExternalContentKind,
  IdempotencyOperation,
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  LibraryRecordOrigin,
} from '../../src/lib/prisma/generated';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential, seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import {
  createExternalCredential,
  getExternalCredentialById,
  type CreateExternalCredentialInput,
  type ExternalCredentialRecord,
  type VerifyJobReference,
} from '../../src/lib/prisma/repositories/external-credential.repository';
import {
  findCheckRun,
  findLatestCheckRun,
  noChecksRun,
  settleCheckRunComplete,
  settleCheckRunFailed,
  type CheckResults,
} from '../../src/lib/prisma/repositories/check-run.repository';
import { LibraryRecordShapeError } from '../../src/lib/library/library-record-view';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  findIdempotencyKey,
  IdempotencyClaimLostError,
  IdempotencyClaimOperationMismatchError,
  releaseIdempotencyKey,
} from '../../src/lib/prisma/repositories/idempotency-key.repository';
import { PgBossJobQueue } from '../../src/lib/jobs/pg-boss-job-queue';
import { protectDecryptionKey } from '../../src/lib/credentials/decryption-key-protection';

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.SERVICE_ENCRYPTION_KEY;

/**
 * Postgres round-trip for the external credential record, its check runs,
 * and the idempotency claim that links to it (#955; ADR-053, ADR-054
 * decision 4). The repositories are I/O all the way down, so this real
 * database is where their behaviour is proven: what each write leaves in
 * the rows, what each read returns and under which key, that the persist is
 * one transaction, that cascade frees the key, and that a job inserted
 * through the Prisma transaction commits and rolls back with it. The
 * constraints suite pins the schema's triggers and checks.
 */
describe('external credential record', () => {
  const prisma = createRigClient();
  const JOB_NAME = 'library.verify-generation';
  const OTHER_TENANT_ID = 'ctestexternalothertenant';
  const RAW_STORAGE_KEY = 'b'.repeat(64);
  const errors: Error[] = [];
  const queue = new PgBossJobQueue({
    connectionString: process.env.RI_DATABASE_URL as string,
    onError: (error) => errors.push(error),
  });

  beforeAll(async () => {
    await queue.start();
  });

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await seedSystemTenant(prisma);
    await prisma.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name = '${JOB_NAME}'`);
  });

  afterEach(() => {
    // Anything the queue reported during this test fails this test, and is
    // then cleared so it cannot be blamed on the next one.
    const reported = errors.splice(0);
    expect(reported).toEqual([]);
  });

  afterAll(async () => {
    await queue.stop();
    await prisma.$disconnect();
    // Shutdown is the one step no test's afterEach watches.
    expect(errors.splice(0)).toEqual([]);
  });

  type EnqueueStep = Extract<CreateExternalCredentialInput['checkRun'], { enqueue: unknown }>['enqueue'];

  /** The enqueue every pending registration performs unless a test replaces it. */
  const enqueueVerifyJob: EnqueueStep = async (sql, job) => {
    await queue.enqueueWithin(sql, JOB_NAME, job);
  };

  function registration(overrides: Partial<CreateExternalCredentialInput> = {}): CreateExternalCredentialInput {
    return {
      tenantId: SYSTEM_TENANT_ID,
      sourceUrl: 'https://supplier.example/credential-a',
      annotations: { displayName: 'Supplier DCC', declaredCredentialType: CoreCredentialType.DCC },
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: pendingRun(),
      ...overrides,
    };
  }

  /**
   * Generation 1 as a pending run. The enqueue defaults to the suite's real
   * queue, so a registration leaves a committed job behind exactly as
   * production does, and a callback that quietly enqueues nothing is
   * something a test has to ask for.
   */
  function pendingRun(
    overrides: { checks?: Partial<CheckResults>; enqueue?: EnqueueStep } = {},
  ): CreateExternalCredentialInput['checkRun'] {
    return {
      state: CheckRunState.PENDING,
      checks: overrides.checks ?? { retrieval: CheckResult.PASS },
      enqueue: overrides.enqueue ?? enqueueVerifyJob,
    };
  }

  /**
   * A second tenant holding an external credential of its own, so a
   * tenant-scoped read proves it refuses a real row under the wrong key
   * rather than reading an empty database.
   */
  async function seedOtherTenantRecord(): Promise<ExternalCredentialRecord> {
    await prisma.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Other' } });
    return createExternalCredential(
      registration({ tenantId: OTHER_TENANT_ID, sourceUrl: 'https://other.example/credential-b' }),
    );
  }

  async function countJobs(): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM pgboss.job WHERE name = $1`,
      JOB_NAME,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async function jobPayloads(): Promise<VerifyJobReference[]> {
    const rows = await prisma.$queryRawUnsafe<{ data: VerifyJobReference }[]>(
      `SELECT data FROM pgboss.job WHERE name = $1`,
      JOB_NAME,
    );
    return rows.map((row) => row.data);
  }

  describe('registering an external credential', () => {
    it('writes the descriptive fields on the parent, custody and annotations on the child, and a generation 1 with every check present, at one instant', async () => {
      const protectedKey = protectDecryptionKey(RAW_STORAGE_KEY);
      const { record, external, checkRun } = await createExternalCredential(
        registration({
          sourceDigest: 'zRaw',
          encrypted: false,
          contentKind: ExternalContentKind.CREDENTIAL,
          storage: {
            uri: 'https://storage.example/copy',
            digestMultibase: 'zCopy',
            serviceInstanceId: 'storage-1',
            externalId: 'obj-1',
            bucket: 'private-data',
            decryptionKey: protectedKey,
          },
          annotations: {
            displayName: 'Supplier passport',
            declaredCredentialType: CoreCredentialType.DPP,
            dateReceived: new Date('2026-09-01T00:00:00.000Z'),
            notes: 'Arrived by email',
          },
          details: {
            status: CredentialDetailsStatus.EXTRACTED,
            fields: {
              name: 'Cert',
              issuerName: 'Issuer Ltd',
              issuerDid: 'did:web:issuer.example',
              subjectName: null,
              subjectId: 'https://id.example/product/1',
              validFrom: new Date('2026-01-01T00:00:00.000Z'),
              validUntil: null,
            },
            credentialType: 'DigitalLivestockPassport',
            coreCredentialType: CoreCredentialType.DPP,
            coreDataModelVersion: '0.6.1',
          },
          // The contract's pending row after a plaintext fetch with a stored
          // copy: retrieval and digest passed, decryption did not apply, the
          // rest waits for the verifier.
          checkRun: pendingRun({ checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS } }),
        }),
      );

      await expect(prisma.libraryRecord.findUniqueOrThrow({ where: { id: record.id } })).resolves.toMatchObject({
        tenantId: SYSTEM_TENANT_ID,
        origin: LibraryRecordOrigin.EXTERNAL,
        name: 'Cert',
        issuerName: 'Issuer Ltd',
        issuerDid: 'did:web:issuer.example',
        subjectName: null,
        subjectId: 'https://id.example/product/1',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: null,
        credentialType: 'DigitalLivestockPassport',
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.6.1',
        detailsStatus: CredentialDetailsStatus.EXTRACTED,
        detailsError: null,
      });
      const storedChild = await prisma.externalCredential.findUniqueOrThrow({ where: { id: record.id } });
      expect(storedChild).toMatchObject({
        tenantId: SYSTEM_TENANT_ID,
        origin: LibraryRecordOrigin.EXTERNAL,
        sourceUrl: 'https://supplier.example/credential-a',
        sourceDigest: 'zRaw',
        encrypted: false,
        contentKind: ExternalContentKind.CREDENTIAL,
        storageUri: 'https://storage.example/copy',
        storageDigestMultibase: 'zCopy',
        storageServiceInstanceId: 'storage-1',
        storageExternalId: 'obj-1',
        storageBucket: 'private-data',
        displayName: 'Supplier passport',
        declaredCredentialType: CoreCredentialType.DPP,
        dateReceived: new Date('2026-09-01T00:00:00.000Z'),
        notes: 'Arrived by email',
        annotationVersion: 1,
        decryptionKeyUnused: false,
      });
      // Stored exactly as the caller wrapped it: the repository neither
      // wraps a raw key nor unwraps a protected one, so the raw key never
      // reaches the row.
      expect(storedChild.decryptionKey).toBe(protectedKey);
      expect(storedChild.decryptionKey).not.toContain(RAW_STORAGE_KEY);
      const stored = await prisma.checkRun.findUniqueOrThrow({ where: { id: checkRun.id } });
      expect(stored).toMatchObject({
        recordId: record.id,
        tenantId: SYSTEM_TENANT_ID,
        generation: 1,
        state: CheckRunState.PENDING,
        retrieval: CheckResult.PASS,
        decryption: CheckResult.NOT_RUN,
        digest: CheckResult.PASS,
        proof: CheckResult.NOT_RUN,
        status: CheckResult.NOT_RUN,
        temporal: CheckResult.NOT_RUN,
        schemaConformance: CheckResult.NOT_RUN,
        failureCode: null,
        failureMessage: null,
        failureRetryable: null,
        completedAt: null,
      });
      expect([
        record.updatedAt,
        external.createdAt,
        external.updatedAt,
        stored.requestedAt,
        stored.lastEnqueuedAt,
      ]).toEqual(Array(5).fill(record.createdAt));
      // The pending run's job carries the four references its handler needs
      // to find the run again, and nothing else: no content and no key
      // (ADR-054 decision 5).
      await expect(jobPayloads()).resolves.toEqual([
        { tenantId: SYSTEM_TENANT_ID, recordId: record.id, generation: 1, checkRunId: checkRun.id },
      ]);
    });

    it('writes a FAILED generation 1 with its failure and completion, no enqueue marker and no job, and nothing the fetch never observed', async () => {
      const { record, external, checkRun } = await createExternalCredential(
        registration({
          checkRun: {
            state: CheckRunState.FAILED,
            checks: { retrieval: CheckResult.FAIL },
            failure: { code: CheckRunFailureCode.RETRIEVAL_FAILED, message: 'The source timed out', retryable: true },
          },
        }),
      );

      expect(checkRun).toMatchObject({
        state: CheckRunState.FAILED,
        retrieval: CheckResult.FAIL,
        decryption: CheckResult.NOT_RUN,
        failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
        failureMessage: 'The source timed out',
        failureRetryable: true,
        lastEnqueuedAt: null,
      });
      expect(checkRun.completedAt).toEqual(record.createdAt);
      expect(external).toMatchObject({
        encrypted: null,
        contentKind: null,
        sourceDigest: null,
        storageUri: null,
        decryptionKey: null,
        decryptionKeyUnused: false,
      });
      expect(record).toMatchObject({ detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING, detailsError: null });
      await expect(countJobs()).resolves.toBe(0);
    });

    it('writes an encrypted source held unopened: the as-fetched copy with no key of ours, DECRYPTION_REQUIRED and retryable', async () => {
      const { record, external, checkRun } = await createExternalCredential(
        registration({
          sourceDigest: 'zCipher',
          encrypted: true,
          storage: {
            uri: 'https://storage.example/raw',
            digestMultibase: 'zCipher',
            serviceInstanceId: 'storage-1',
            externalId: 'obj-raw',
          },
          checkRun: {
            state: CheckRunState.FAILED,
            checks: { retrieval: CheckResult.PASS, decryption: CheckResult.FAIL },
            failure: {
              code: CheckRunFailureCode.DECRYPTION_REQUIRED,
              message: 'The credential is encrypted and no key was supplied; re-verify with a key to open it',
              retryable: true,
            },
          },
        }),
      );

      expect(external).toMatchObject({
        encrypted: true,
        contentKind: null,
        sourceDigest: 'zCipher',
        storageUri: 'https://storage.example/raw',
        storageDigestMultibase: 'zCipher',
        decryptionKey: null,
        decryptionKeyUnused: false,
      });
      expect(checkRun).toMatchObject({
        state: CheckRunState.FAILED,
        retrieval: CheckResult.PASS,
        decryption: CheckResult.FAIL,
        failureCode: CheckRunFailureCode.DECRYPTION_REQUIRED,
        failureRetryable: true,
        lastEnqueuedAt: null,
      });
      expect(record.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_PENDING);
      await expect(countJobs()).resolves.toBe(0);
    });

    it('writes an encrypted source whose key did not open it: the unopened copy kept, DECRYPTION_FAILED and retryable', async () => {
      const { external, checkRun } = await createExternalCredential(
        registration({
          sourceDigest: 'zCipher',
          encrypted: true,
          storage: {
            uri: 'https://storage.example/raw',
            digestMultibase: 'zCipher',
            serviceInstanceId: 'storage-1',
            externalId: 'obj-raw',
          },
          checkRun: {
            state: CheckRunState.FAILED,
            checks: { retrieval: CheckResult.PASS, decryption: CheckResult.FAIL },
            failure: {
              code: CheckRunFailureCode.DECRYPTION_FAILED,
              message: 'The supplied key did not open the credential; re-verify with the right key',
              retryable: true,
            },
          },
        }),
      );

      expect(external).toMatchObject({
        encrypted: true,
        storageUri: 'https://storage.example/raw',
        decryptionKey: null,
      });
      expect(checkRun).toMatchObject({
        state: CheckRunState.FAILED,
        retrieval: CheckResult.PASS,
        decryption: CheckResult.FAIL,
        failureCode: CheckRunFailureCode.DECRYPTION_FAILED,
        failureRetryable: true,
      });
    });

    it('writes a storage failure after a successful fetch: the digest and what was observed, no copy, STORAGE_FAILED and retryable', async () => {
      const { record, external, checkRun } = await createExternalCredential(
        registration({
          sourceDigest: 'zRaw',
          encrypted: false,
          contentKind: ExternalContentKind.CREDENTIAL,
          // Extraction runs the moment the artefact is in hand, before the
          // store, so a plaintext fetch whose copy then failed to store has
          // its fields.
          details: {
            status: CredentialDetailsStatus.EXTRACTED,
            fields: {
              name: 'Cert',
              issuerName: 'Issuer Ltd',
              issuerDid: 'did:web:issuer.example',
              subjectName: null,
              subjectId: null,
              validFrom: null,
              validUntil: null,
            },
            credentialType: 'DigitalProductPassport',
            coreCredentialType: CoreCredentialType.DPP,
            coreDataModelVersion: '0.6.1',
          },
          checkRun: {
            state: CheckRunState.FAILED,
            // The digest check is over the stored copy, and there is none.
            checks: { retrieval: CheckResult.PASS },
            failure: {
              code: CheckRunFailureCode.STORAGE_FAILED,
              message: 'The durable copy could not be stored; verify again to retry',
              retryable: true,
            },
          },
        }),
      );

      expect(external).toMatchObject({
        encrypted: false,
        contentKind: ExternalContentKind.CREDENTIAL,
        sourceDigest: 'zRaw',
        storageUri: null,
        storageDigestMultibase: null,
        storageServiceInstanceId: null,
        storageExternalId: null,
        decryptionKey: null,
      });
      expect(checkRun).toMatchObject({
        state: CheckRunState.FAILED,
        retrieval: CheckResult.PASS,
        digest: CheckResult.NOT_RUN,
        failureCode: CheckRunFailureCode.STORAGE_FAILED,
        failureRetryable: true,
      });
      expect(record).toMatchObject({
        detailsStatus: CredentialDetailsStatus.EXTRACTED,
        name: 'Cert',
        coreCredentialType: CoreCredentialType.DPP,
      });
    });

    it('records an extraction failure with its reason on the parent and no descriptive fields', async () => {
      const { record } = await createExternalCredential(
        registration({
          details: {
            status: CredentialDetailsStatus.EXTRACTION_FAILED,
            error: CredentialDetailsError.UNREADABLE_ENVELOPE,
          },
        }),
      );

      await expect(prisma.libraryRecord.findUniqueOrThrow({ where: { id: record.id } })).resolves.toMatchObject({
        detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED,
        detailsError: CredentialDetailsError.UNREADABLE_ENVELOPE,
        name: null,
        issuerDid: null,
        credentialType: null,
        coreCredentialType: null,
      });
    });

    it('records a key that was supplied against a source that turned out to be plaintext', async () => {
      const { record } = await createExternalCredential(registration({ encrypted: false, decryptionKeyUnused: true }));

      await expect(prisma.externalCredential.findUniqueOrThrow({ where: { id: record.id } })).resolves.toMatchObject({
        decryptionKeyUnused: true,
        decryptionKey: null,
        encrypted: false,
      });
    });
  });

  describe('reading an external credential', () => {
    it('returns the narrowed external view with the newest generation, and null under a tenant that holds its own record', async () => {
      const { record, checkRun } = await createExternalCredential(registration());
      await settleCheckRunComplete({ id: checkRun.id, tenantId: SYSTEM_TENANT_ID, checks: noChecksRun() });
      await prisma.checkRun.create({
        data: { recordId: record.id, tenantId: SYSTEM_TENANT_ID, generation: 2, state: CheckRunState.PENDING },
      });
      const other = await seedOtherTenantRecord();

      const view = await getExternalCredentialById(record.id, SYSTEM_TENANT_ID);

      expect(view).toMatchObject({
        origin: LibraryRecordOrigin.EXTERNAL,
        record: { id: record.id, origin: LibraryRecordOrigin.EXTERNAL },
        external: { id: record.id, sourceUrl: 'https://supplier.example/credential-a' },
        checkRun: { generation: 2, state: CheckRunState.PENDING },
      });
      // The narrowed view carries the child its origin has and no other.
      expect(view).not.toHaveProperty('credential');
      expect(view?.record).not.toHaveProperty('externalCredential');
      await expect(getExternalCredentialById(record.id, OTHER_TENANT_ID)).resolves.toBeNull();
      await expect(getExternalCredentialById(other.record.id, OTHER_TENANT_ID)).resolves.toMatchObject({
        external: { sourceUrl: 'https://other.example/credential-b' },
      });
    });

    it('fails loudly on a record whose runs are gone, a state registration never produces', async () => {
      const { record } = await createExternalCredential(registration());
      await prisma.checkRun.deleteMany({ where: { recordId: record.id } });

      await expect(getExternalCredentialById(record.id, SYSTEM_TENANT_ID)).rejects.toThrow(LibraryRecordShapeError);
      await expect(getExternalCredentialById(record.id, SYSTEM_TENANT_ID)).rejects.toThrow('has no check run');
    });
  });

  describe('a check run belongs to one record', () => {
    it('accepts a run on a native record and one on an external record, and refuses one on no record', async () => {
      const native = await insertNativeCredential(prisma);
      const { record } = await createExternalCredential(registration());

      await expect(
        prisma.checkRun.create({
          data: { recordId: native.id, tenantId: SYSTEM_TENANT_ID, generation: 2, state: CheckRunState.PENDING },
        }),
      ).resolves.toMatchObject({ recordId: native.id });
      // Registration already wrote the external record's generation 1 as
      // PENDING, and a record holds at most one PENDING run, so its second
      // generation is written settled here.
      await expect(
        prisma.checkRun.create({
          data: { recordId: record.id, tenantId: SYSTEM_TENANT_ID, generation: 2, state: CheckRunState.COMPLETE },
        }),
      ).resolves.toMatchObject({ recordId: record.id });
      await expect(
        prisma.checkRun.create({
          data: { recordId: 'no-such-record', tenantId: SYSTEM_TENANT_ID, generation: 7, state: CheckRunState.PENDING },
        }),
      ).rejects.toThrow(/Foreign key constraint/);
    });

    it('numbers generations uniquely per record', async () => {
      const { record } = await createExternalCredential(registration());

      await expect(
        prisma.checkRun.create({
          data: { recordId: record.id, tenantId: SYSTEM_TENANT_ID, generation: 1, state: CheckRunState.PENDING },
        }),
      ).rejects.toThrow(/Unique constraint failed on the fields: \(`recordId`,`generation`\)/);
    });

    it('reads a generation, and the newest one, of the named record under the tenant key only', async () => {
      const { record, checkRun } = await createExternalCredential(registration());
      await settleCheckRunComplete({ id: checkRun.id, tenantId: SYSTEM_TENANT_ID, checks: noChecksRun() });
      await prisma.checkRun.create({
        data: { recordId: record.id, tenantId: SYSTEM_TENANT_ID, generation: 2, state: CheckRunState.PENDING },
      });
      // A sibling record in the same tenant carrying a higher generation than
      // any run of the record under test: a read that dropped `recordId`
      // would answer with this one.
      const sibling = await insertNativeCredential(prisma, { id: 'rec-sibling' });
      await prisma.checkRun.create({
        data: { recordId: sibling.id, tenantId: SYSTEM_TENANT_ID, generation: 9, state: CheckRunState.COMPLETE },
      });
      const other = await seedOtherTenantRecord();

      await expect(findCheckRun(record.id, 1, SYSTEM_TENANT_ID)).resolves.toMatchObject({
        id: checkRun.id,
        state: CheckRunState.COMPLETE,
      });
      await expect(findLatestCheckRun(record.id, SYSTEM_TENANT_ID)).resolves.toMatchObject({
        generation: 2,
        state: CheckRunState.PENDING,
      });
      await expect(findLatestCheckRun(sibling.id, SYSTEM_TENANT_ID)).resolves.toMatchObject({ generation: 9 });
      await expect(findCheckRun(record.id, 1, OTHER_TENANT_ID)).resolves.toBeNull();
      await expect(findLatestCheckRun(record.id, OTHER_TENANT_ID)).resolves.toBeNull();
      await expect(findLatestCheckRun(other.record.id, OTHER_TENANT_ID)).resolves.toMatchObject({
        id: other.checkRun.id,
      });
    });

    it('creates the parent and the external child with one id and one instant, and finds neither through a native lookup', async () => {
      const { record, external } = await createExternalCredential(registration());
      expect(external.id).toBe(record.id);
      expect(record.origin).toBe('EXTERNAL');
      expect([record.updatedAt, external.createdAt, external.updatedAt]).toEqual([
        record.createdAt,
        record.createdAt,
        record.createdAt,
      ]);
      await expect(prisma.credential.findUnique({ where: { id: record.id } })).resolves.toBeNull();
      const native = await insertNativeCredential(prisma);
      await expect(getExternalCredentialById(native.id, SYSTEM_TENANT_ID)).resolves.toBeNull();
    });
  });

  describe('deleting the parent is the supported path', () => {
    it('cascades from the parent to the child, its runs and its claim', async () => {
      const claim = await claimIdempotencyKey({
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: 'shape-1',
        bodyDigest: 'zBody',
      });
      if (claim.outcome !== 'claimed') throw new Error('expected a fresh claim');
      const { record } = await createExternalCredential(registration({ idempotencyClaimId: claim.claimId }));

      await prisma.libraryRecord.delete({ where: { id: record.id } });
      await expect(prisma.externalCredential.count({ where: { id: record.id } })).resolves.toBe(0);
      await expect(prisma.checkRun.count({ where: { recordId: record.id } })).resolves.toBe(0);
      await expect(prisma.idempotencyKey.findUnique({ where: { id: claim.claimId } })).resolves.toBeNull();
    });
  });

  describe('the register persist is one transaction', () => {
    it('writes the record, generation 1 and the claim link together, and deleting the record frees the key', async () => {
      const claim = await claimIdempotencyKey({
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: 'register-1',
        bodyDigest: 'zBody',
      });
      expect(claim.outcome).toBe('claimed');
      if (claim.outcome !== 'claimed') return;

      const { record, checkRun } = await createExternalCredential(registration({ idempotencyClaimId: claim.claimId }));

      expect(checkRun).toMatchObject({ recordId: record.id, generation: 1, state: CheckRunState.PENDING });
      const claimRow = await prisma.idempotencyKey.findUnique({ where: { id: claim.claimId } });
      expect(claimRow).toMatchObject({ recordId: record.id });
      expect(claimRow?.resultRecordedAt).not.toBeNull();

      await completeIdempotencyKey({ claimId: claim.claimId, recordId: record.id, responseBody: null });
      await expect(
        findIdempotencyKey({
          tenantId: SYSTEM_TENANT_ID,
          operation: IdempotencyOperation.LIBRARY_REGISTER,
          key: 'register-1',
          bodyDigest: 'zBody',
        }),
      ).resolves.toEqual({ outcome: 'replay', recordId: record.id, responseBody: null });

      await prisma.libraryRecord.delete({ where: { id: record.id } });

      await expect(prisma.checkRun.count({ where: { recordId: record.id } })).resolves.toBe(0);
      await expect(prisma.externalCredential.findUnique({ where: { id: record.id } })).resolves.toBeNull();
      await expect(prisma.idempotencyKey.findUnique({ where: { id: claim.claimId } })).resolves.toBeNull();
      await expect(
        findIdempotencyKey({
          tenantId: SYSTEM_TENANT_ID,
          operation: IdempotencyOperation.LIBRARY_REGISTER,
          key: 'register-1',
          bodyDigest: 'zBody',
        }),
      ).resolves.toEqual({ outcome: 'absent' });
    });

    it('rolls the record and generation back when the callback inside the transaction fails, leaving the claim releasable', async () => {
      const claim = await claimIdempotencyKey({
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: 'register-2',
        bodyDigest: 'zBody',
      });
      if (claim.outcome !== 'claimed') throw new Error('expected a fresh claim');

      await expect(
        createExternalCredential(
          registration({
            idempotencyClaimId: claim.claimId,
            checkRun: pendingRun({
              enqueue: async () => {
                throw new Error('enqueue failed');
              },
            }),
          }),
        ),
      ).rejects.toThrow('enqueue failed');

      await expect(prisma.libraryRecord.count()).resolves.toBe(0);
      await expect(prisma.externalCredential.count()).resolves.toBe(0);
      await expect(prisma.checkRun.count()).resolves.toBe(0);
      const claimRow = await prisma.idempotencyKey.findUnique({ where: { id: claim.claimId } });
      expect(claimRow).toMatchObject({ recordId: null });
      await expect(releaseIdempotencyKey({ claimId: claim.claimId })).resolves.toEqual({ applied: true });
    });

    it('refuses a claim held for another operation, naming it, and writes nothing', async () => {
      const issue = await claimIdempotencyKey({
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.CREDENTIAL_ISSUE,
        key: 'wrong-op',
        bodyDigest: 'zBody',
      });
      if (issue.outcome !== 'claimed') throw new Error('expected a fresh claim');

      await expect(
        createExternalCredential(registration({ idempotencyClaimId: issue.claimId })),
      ).rejects.toBeInstanceOf(IdempotencyClaimOperationMismatchError);
      await expect(createExternalCredential(registration({ idempotencyClaimId: issue.claimId }))).rejects.toThrow(
        'is for CREDENTIAL_ISSUE, not LIBRARY_REGISTER',
      );
      await expect(prisma.libraryRecord.count()).resolves.toBe(0);
      await expect(prisma.idempotencyKey.findUnique({ where: { id: issue.claimId } })).resolves.toMatchObject({
        recordId: null,
      });
    });

    it('rolls back and reports a lost claim when another request already recorded a result on it', async () => {
      const claim = await claimIdempotencyKey({
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: 'register-3',
        bodyDigest: 'zBody',
      });
      if (claim.outcome !== 'claimed') throw new Error('expected a fresh claim');
      const other = await createExternalCredential(registration());
      await prisma.idempotencyKey.update({ where: { id: claim.claimId }, data: { recordId: other.record.id } });

      await expect(
        createExternalCredential(registration({ idempotencyClaimId: claim.claimId })),
      ).rejects.toBeInstanceOf(IdempotencyClaimLostError);
      await expect(prisma.libraryRecord.count()).resolves.toBe(1);
    });

    it('keeps a CREDENTIAL_ISSUE claim and a LIBRARY_REGISTER claim on the same key independent', async () => {
      const issue = await claimIdempotencyKey({
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.CREDENTIAL_ISSUE,
        key: 'shared-key',
        bodyDigest: 'zBody',
      });
      const register = await claimIdempotencyKey({
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: 'shared-key',
        bodyDigest: 'zBody',
      });
      expect([issue.outcome, register.outcome]).toEqual(['claimed', 'claimed']);
      if (register.outcome !== 'claimed') return;

      const { record } = await createExternalCredential(registration({ idempotencyClaimId: register.claimId }));
      await completeIdempotencyKey({ claimId: register.claimId, recordId: record.id, responseBody: null });

      await expect(
        findIdempotencyKey({
          tenantId: SYSTEM_TENANT_ID,
          operation: IdempotencyOperation.CREDENTIAL_ISSUE,
          key: 'shared-key',
          bodyDigest: 'zBody',
        }),
      ).resolves.toEqual({ outcome: 'in-flight' });
    });
  });

  describe('the verify job commits and rolls back with the record', () => {
    it('inserts the job through the caller transaction so it exists exactly when the record does', async () => {
      const { record, checkRun } = await createExternalCredential(registration());

      await expect(jobPayloads()).resolves.toEqual([
        { tenantId: SYSTEM_TENANT_ID, recordId: record.id, generation: 1, checkRunId: checkRun.id },
      ]);

      await expect(
        createExternalCredential(
          registration({
            checkRun: pendingRun({
              enqueue: async (sql, job) => {
                await queue.enqueueWithin(sql, JOB_NAME, job);
                throw new Error('persist failed after enqueue');
              },
            }),
          }),
        ),
      ).rejects.toThrow('persist failed after enqueue');

      await expect(countJobs()).resolves.toBe(1);
      await expect(prisma.libraryRecord.count()).resolves.toBe(1);
      expect(errors).toEqual([]);
    });
  });

  describe('settling check runs', () => {
    it('settles a PENDING generation COMPLETE with its checks once, and reports every later settle as superseded', async () => {
      const { record, checkRun } = await createExternalCredential(registration());
      const checks: CheckResults = { ...noChecksRun(), retrieval: CheckResult.PASS, proof: CheckResult.PASS };

      await expect(settleCheckRunComplete({ id: checkRun.id, tenantId: SYSTEM_TENANT_ID, checks })).resolves.toEqual({
        outcome: 'applied',
      });
      await expect(
        settleCheckRunFailed({
          id: checkRun.id,
          tenantId: SYSTEM_TENANT_ID,
          checks: noChecksRun(),
          failure: { code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE, message: 'late', retryable: true },
        }),
      ).resolves.toEqual({ outcome: 'superseded' });
      await expect(
        settleCheckRunComplete({ id: checkRun.id, tenantId: SYSTEM_TENANT_ID, checks: noChecksRun() }),
      ).resolves.toEqual({ outcome: 'superseded' });

      const stored = await prisma.checkRun.findUniqueOrThrow({ where: { id: checkRun.id } });
      expect(stored).toMatchObject({
        state: CheckRunState.COMPLETE,
        retrieval: CheckResult.PASS,
        decryption: CheckResult.NOT_RUN,
        digest: CheckResult.NOT_RUN,
        proof: CheckResult.PASS,
        status: CheckResult.NOT_RUN,
        temporal: CheckResult.NOT_RUN,
        schemaConformance: CheckResult.NOT_RUN,
        failureCode: null,
        failureMessage: null,
      });
      expect(stored.completedAt).not.toBeNull();
      // Settling a run never touches the record's last-modified time
      // (ADR-053 decision 1): verification state is projected from the run.
      await expect(prisma.libraryRecord.findUniqueOrThrow({ where: { id: record.id } })).resolves.toMatchObject({
        updatedAt: record.updatedAt,
      });
    });

    it('clears a stale failure reason when a pending run settles complete', async () => {
      const { checkRun } = await createExternalCredential(registration());
      await prisma.checkRun.update({
        where: { id: checkRun.id },
        data: {
          failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
          failureMessage: 'stale',
          failureRetryable: true,
        },
      });

      await expect(
        settleCheckRunComplete({ id: checkRun.id, tenantId: SYSTEM_TENANT_ID, checks: noChecksRun() }),
      ).resolves.toEqual({ outcome: 'applied' });

      await expect(prisma.checkRun.findUniqueOrThrow({ where: { id: checkRun.id } })).resolves.toMatchObject({
        state: CheckRunState.COMPLETE,
        failureCode: null,
        failureMessage: null,
        failureRetryable: null,
      });
    });

    it('settles a PENDING generation FAILED with the whole check set when the verifier is unavailable, keeping what registration established', async () => {
      const { checkRun } = await createExternalCredential(
        registration({
          checkRun: pendingRun({ checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS } }),
        }),
      );

      // The only pending-to-failed settlement the register contract admits:
      // the asynchronous verifier call could not run. Every check is stated,
      // so the row shows the in-request checks as they were and the
      // verifier's checks as not run, and nothing is left to a stale value.
      await expect(
        settleCheckRunFailed({
          id: checkRun.id,
          tenantId: SYSTEM_TENANT_ID,
          checks: { ...noChecksRun(), retrieval: CheckResult.PASS, digest: CheckResult.PASS },
          failure: {
            code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
            message: 'The verification service could not be reached; verify again later',
            retryable: true,
          },
        }),
      ).resolves.toEqual({ outcome: 'applied' });
      await expect(
        settleCheckRunComplete({ id: checkRun.id, tenantId: SYSTEM_TENANT_ID, checks: noChecksRun() }),
      ).resolves.toEqual({ outcome: 'superseded' });

      const stored = await prisma.checkRun.findUniqueOrThrow({ where: { id: checkRun.id } });
      expect(stored).toMatchObject({
        state: CheckRunState.FAILED,
        retrieval: CheckResult.PASS,
        decryption: CheckResult.NOT_RUN,
        digest: CheckResult.PASS,
        proof: CheckResult.NOT_RUN,
        status: CheckResult.NOT_RUN,
        temporal: CheckResult.NOT_RUN,
        schemaConformance: CheckResult.NOT_RUN,
        failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
        failureMessage: 'The verification service could not be reached; verify again later',
        failureRetryable: true,
      });
      expect(stored.completedAt).not.toBeNull();
    });

    it('settles a run registration already failed no further', async () => {
      const { checkRun } = await createExternalCredential(
        registration({
          checkRun: {
            state: CheckRunState.FAILED,
            checks: { retrieval: CheckResult.FAIL },
            failure: { code: CheckRunFailureCode.RETRIEVAL_FAILED, message: 'HTTP 404', retryable: false },
          },
        }),
      );

      await expect(
        settleCheckRunComplete({ id: checkRun.id, tenantId: SYSTEM_TENANT_ID, checks: noChecksRun() }),
      ).resolves.toEqual({ outcome: 'superseded' });
      await expect(prisma.checkRun.findUniqueOrThrow({ where: { id: checkRun.id } })).resolves.toMatchObject({
        state: CheckRunState.FAILED,
        failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
      });
    });

    it('reports a run addressed under another tenant, and a run that is gone, as missing and settles neither', async () => {
      const { checkRun } = await createExternalCredential(registration());
      await prisma.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Other' } });

      await expect(
        settleCheckRunComplete({ id: checkRun.id, tenantId: OTHER_TENANT_ID, checks: noChecksRun() }),
      ).resolves.toEqual({ outcome: 'missing' });
      await expect(prisma.checkRun.findUniqueOrThrow({ where: { id: checkRun.id } })).resolves.toMatchObject({
        state: CheckRunState.PENDING,
      });

      await prisma.checkRun.delete({ where: { id: checkRun.id } });
      await expect(
        settleCheckRunFailed({
          id: checkRun.id,
          tenantId: SYSTEM_TENANT_ID,
          checks: noChecksRun(),
          failure: { code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE, message: 'gone', retryable: true },
        }),
      ).resolves.toEqual({ outcome: 'missing' });
    });
  });
});
