import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import type { IStorageService, StorageRecord } from '@uncefact/untp-ri-services';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsStatus,
  ExternalContentKind,
  LibraryRecordOrigin,
} from '../../src/lib/prisma/generated';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential } from './fixtures';
import { protectDecryptionKey, revealDecryptionKey } from '../../src/lib/credentials/decryption-key-protection';
import { createExternalCredential } from '../../src/lib/prisma/repositories/external-credential.repository';
import { getLibraryRecordById } from '../../src/lib/prisma/repositories/library-record.repository';
import { LibraryRecordShapeError } from '../../src/lib/library/library-record-view';
import { toCredentialRecordDetail } from '../../src/lib/library/credential-record-projection';
import {
  registerExternalCredential,
  type RegisterExternalCredentialDependencies,
} from '../../src/lib/library/register-external-credential';
import { getEncryptionService } from '../../src/lib/encryption/encryption';

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.SERVICE_ENCRYPTION_KEY;

const OWNER_TENANT_ID = 'detail-owner-tenant';
const OTHER_TENANT_ID = 'detail-other-tenant';
const NOW = new Date('2026-09-05T00:00:00.000Z');
const SUPPLIER_KEY = 'b'.repeat(64);
const RECEIVER_KEY = 'c'.repeat(64);

const quietLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quietLogger,
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

const sourceCredential = envelopedCredential({
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/'],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  name: 'Registered detail credential',
  issuer: { id: 'did:web:supplier.example', name: 'Supplier Ltd' },
  validFrom: '2026-07-22T10:00:00Z',
  credentialSubject: { id: 'https://supplier.example/products/1', name: 'Battery pack' },
});
const encryptedSource = JSON.stringify(
  new AesGcmEncryptionAdapter(SUPPLIER_KEY, quietLogger as never).encrypt(
    JSON.stringify(sourceCredential),
    EncryptionAlgorithm.AES_256_GCM,
  ),
);

const EXTRACTED_DETAILS = {
  status: CredentialDetailsStatus.EXTRACTED,
  fields: {
    name: 'Detail credential',
    issuerName: 'Issuer',
    issuerDid: 'did:web:issuer.example',
    subjectName: 'Subject',
    subjectId: 'https://issuer.example/subject',
    validFrom: new Date('2026-07-22T10:00:00.000Z'),
    validUntil: new Date('2027-07-22T10:00:00.000Z'),
  },
  credentialType: 'DigitalProductPassport',
  coreCredentialType: CoreCredentialType.DPP,
  coreDataModelVersion: '0.6.0',
};

const FAILED_RETRIEVAL_CHECKS = { retrieval: CheckResult.FAIL };
const COMPLETE_CHECKS = {
  retrieval: CheckResult.PASS,
  decryption: CheckResult.NOT_RUN,
  digest: CheckResult.PASS,
  proof: CheckResult.PASS,
  status: CheckResult.PASS,
  temporal: CheckResult.PASS,
  schemaConformance: CheckResult.PASS,
};

type ExternalRegistrationOptions = {
  tenantId?: string;
  sourceUrl?: string;
  sourceDigest?: string;
  encrypted?: boolean | null;
  storage?: {
    uri: string;
    digestMultibase: string;
    receiverKey?: string;
  };
  detailsStatus?: CredentialDetailsStatus;
  run?: 'failed' | 'pending' | 'complete';
  failureCode?: CheckRunFailureCode;
  failureRetryable?: boolean;
};

const prisma = createRigClient();

async function registerExternal(
  options: ExternalRegistrationOptions = {},
): Promise<{ id: string; checkRunId: string }> {
  const tenantId = options.tenantId ?? OWNER_TENANT_ID;
  const run = options.run ?? 'complete';
  const created = await createExternalCredential({
    tenantId,
    sourceUrl: options.sourceUrl ?? 'https://supplier.example/credential',
    ...(options.sourceDigest === undefined ? {} : { sourceDigest: options.sourceDigest }),
    ...(options.encrypted === undefined ? { encrypted: false } : { encrypted: options.encrypted }),
    ...(options.encrypted === true
      ? { contentKind: ExternalContentKind.OPAQUE }
      : options.encrypted === false || options.encrypted === undefined
        ? { contentKind: ExternalContentKind.CREDENTIAL }
        : {}),
    ...(options.storage
      ? {
          storage: {
            uri: options.storage.uri,
            digestMultibase: options.storage.digestMultibase,
            serviceInstanceId: 'storage-test',
            externalId: `external-${options.storage.uri.split('/').at(-1)}`,
            bucket: 'private',
            ...(options.storage.receiverKey
              ? { decryptionKey: protectDecryptionKey(options.storage.receiverKey) }
              : {}),
          },
        }
      : {}),
    annotations: {
      displayName: 'Detail credential',
      declaredCredentialType: CoreCredentialType.DPP,
      dateReceived: new Date('2026-07-30T00:00:00.000Z'),
    },
    details:
      options.detailsStatus === CredentialDetailsStatus.EXTRACTION_PENDING
        ? { status: CredentialDetailsStatus.EXTRACTION_PENDING }
        : EXTRACTED_DETAILS,
    checkRun:
      run === 'failed'
        ? {
            state: CheckRunState.FAILED,
            checks: FAILED_RETRIEVAL_CHECKS,
            failure: {
              code: options.failureCode ?? CheckRunFailureCode.RETRIEVAL_FAILED,
              message: 'The source could not be retrieved; retry via re-verify.',
              retryable: options.failureRetryable ?? true,
            },
          }
        : {
            state: CheckRunState.PENDING,
            checks: COMPLETE_CHECKS,
            enqueue: async () => undefined,
          },
  });

  if (run === 'complete') {
    await prisma.checkRun.update({
      where: { id: created.checkRun.id },
      data: {
        state: CheckRunState.COMPLETE,
        ...COMPLETE_CHECKS,
        completedAt: new Date('2026-09-05T00:00:01.000Z'),
        failureCode: null,
        failureMessage: null,
        failureRetryable: null,
        lastEnqueuedAt: null,
      },
    });
  }
  return { id: created.record.id, checkRunId: created.checkRun.id };
}

async function registerEncryptedSource(): Promise<{ id: string; supplierKey: string; receiverKey: string }> {
  const stored: StorageRecord = {
    uri: 'https://storage.example/registered-receiver-copy',
    digestMultibase: 'zRegisteredReceiverDigest',
    decryptionKey: RECEIVER_KEY,
    externalId: 'registered-receiver-copy',
    bucket: 'private',
    mimeType: 'application/json',
  };
  const storage: IStorageService = {
    store: async () => stored,
    storeBinary: async () => stored,
    delete: async () => undefined,
  };
  const dependencies: RegisterExternalCredentialDependencies = {
    fetchDocument: async () => ({
      bytes: new TextEncoder().encode(encryptedSource),
      contentType: 'application/json',
      finalUrl: 'https://supplier.example/encrypted-credential',
    }),
    resolveStorage: async () => ({ service: storage, instanceId: 'storage-registration' }),
    assertEncryptionReady: () => {
      getEncryptionService();
    },
    enqueueVerification: async () => undefined,
    persist: createExternalCredential,
  };
  const registered = await registerExternalCredential(
    {
      tenantId: OWNER_TENANT_ID,
      sourceUrl: 'https://supplier.example/encrypted-credential',
      decryptionKey: SUPPLIER_KEY,
      annotations: { displayName: 'Registered detail credential', declaredCredentialType: CoreCredentialType.DPP },
    },
    dependencies,
  );
  return { id: registered.record.id, supplierKey: SUPPLIER_KEY, receiverKey: RECEIVER_KEY };
}

async function insertExternalWithoutRun(): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const record = await tx.libraryRecord.create({
      data: {
        tenantId: OWNER_TENANT_ID,
        origin: LibraryRecordOrigin.EXTERNAL,
        credentialType: 'DigitalProductPassport',
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.6.0',
        detailsStatus: CredentialDetailsStatus.EXTRACTED,
        ...EXTRACTED_DETAILS.fields,
      },
    });
    await tx.externalCredential.create({
      data: {
        id: record.id,
        tenantId: OWNER_TENANT_ID,
        sourceUrl: 'https://supplier.example/no-run',
        sourceDigest: 'zSourceDigest',
        encrypted: false,
        contentKind: ExternalContentKind.CREDENTIAL,
        storageUri: 'https://storage.example/no-run',
        storageDigestMultibase: 'zStorageDigest',
        storageServiceInstanceId: 'storage-test',
        storageExternalId: 'external-no-run',
        storageBucket: 'private',
        displayName: 'Unsettled credential',
        declaredCredentialType: CoreCredentialType.DPP,
      },
    });
    return record.id;
  });
}

async function detail(id: string, tenantId = OWNER_TENANT_ID) {
  const view = await getLibraryRecordById(id, tenantId);
  if (view === null) return null;
  return toCredentialRecordDetail(view, { now: NOW, reveal: revealDecryptionKey });
}

beforeEach(async () => {
  await truncateApplicationTables(prisma);
  await prisma.tenant.createMany({
    data: [
      { id: OWNER_TENANT_ID, name: 'Detail owner' },
      { id: OTHER_TENANT_ID, name: 'Other tenant' },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/v1/library/{id} repository and projection against Postgres', () => {
  it('returns native and external records only to their owning tenant, with identical absent and foreign misses', async () => {
    const native = await insertNativeCredential(prisma, {
      id: 'native-owner-record',
      tenantId: OWNER_TENANT_ID,
      decryptionKey: protectDecryptionKey(RECEIVER_KEY),
    });
    const external = await registerExternal({ tenantId: OWNER_TENANT_ID });

    expect((await detail(native.id))?.origin).toBe('native');
    expect((await detail(external.id))?.origin).toBe('external');
    await expect(getLibraryRecordById(native.id, OTHER_TENANT_ID)).resolves.toBeNull();
    await expect(getLibraryRecordById(external.id, OTHER_TENANT_ID)).resolves.toBeNull();
    await expect(getLibraryRecordById('record-does-not-exist', OWNER_TENANT_ID)).resolves.toBeNull();
    await expect(getLibraryRecordById('record-does-not-exist', OTHER_TENANT_ID)).resolves.toBeNull();
  });

  it('reveals a native key with the native storage coordinates', async () => {
    const native = await insertNativeCredential(prisma, {
      id: 'native-key-record',
      tenantId: OWNER_TENANT_ID,
      storageUri: 'https://storage.example/native-key-record',
      digestMultibase: 'zNativeStorageDigest',
      decryptionKey: protectDecryptionKey(RECEIVER_KEY),
    });

    await expect(detail(native.id)).resolves.toMatchObject({
      origin: 'native',
      storageUri: 'https://storage.example/native-key-record',
      digestMultibase: 'zNativeStorageDigest',
      decryptionKey: RECEIVER_KEY,
      encrypted: true,
      hasKey: true,
    });
  });

  it('returns the receiver-side key from the registration pipeline, never the supplier key', async () => {
    const registered = await registerEncryptedSource();
    const row = await prisma.externalCredential.findUnique({ where: { id: registered.id } });

    expect(row?.decryptionKey).not.toContain(registered.supplierKey);
    await expect(detail(registered.id)).resolves.toMatchObject({
      origin: 'external',
      storageUri: 'https://storage.example/registered-receiver-copy',
      digestMultibase: 'zRegisteredReceiverDigest',
      decryptionKey: registered.receiverKey,
      hasKey: true,
    });
  });

  it('returns R1 ciphertext coordinates with a null key', async () => {
    const external = await registerExternal({
      encrypted: true,
      sourceDigest: 'zCiphertextSourceDigest',
      detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
      run: 'failed',
      failureCode: CheckRunFailureCode.DECRYPTION_REQUIRED,
      storage: {
        uri: 'https://storage.example/unopened-ciphertext',
        digestMultibase: 'zCiphertextStorageDigest',
      },
    });

    await expect(detail(external.id)).resolves.toMatchObject({
      encrypted: true,
      hasKey: false,
      detailsStatus: 'EXTRACTION_PENDING',
      storageUri: 'https://storage.example/unopened-ciphertext',
      digestMultibase: 'zCiphertextStorageDigest',
      decryptionKey: null,
    });
  });

  it('returns three null custody fields after a retryable retrieval failure', async () => {
    const external = await registerExternal({
      encrypted: null,
      sourceDigest: undefined,
      run: 'failed',
      detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
      failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
      failureRetryable: true,
      sourceUrl: 'https://supplier.example/temporarily-unavailable',
    });

    await expect(detail(external.id)).resolves.toMatchObject({
      sourceUrl: 'https://supplier.example/temporarily-unavailable',
      sourceDigest: null,
      storageUri: null,
      digestMultibase: null,
      decryptionKey: null,
    });
  });

  it('selects the highest generation regardless of state or timestamps', async () => {
    const external = await registerExternal({
      storage: {
        uri: 'https://storage.example/generations',
        digestMultibase: 'zGenerations',
        receiverKey: RECEIVER_KEY,
      },
    });
    await prisma.checkRun.create({
      data: {
        recordId: external.id,
        tenantId: OWNER_TENANT_ID,
        generation: 2,
        state: CheckRunState.COMPLETE,
        ...COMPLETE_CHECKS,
        requestedAt: new Date('2099-01-01T00:00:00.000Z'),
        completedAt: new Date('2099-01-01T00:00:01.000Z'),
      },
    });
    await prisma.checkRun.create({
      data: {
        recordId: external.id,
        tenantId: OWNER_TENANT_ID,
        generation: 3,
        state: CheckRunState.PENDING,
        ...COMPLETE_CHECKS,
        requestedAt: new Date('2020-01-01T00:00:00.000Z'),
        completedAt: null,
      },
    });

    const view = await getLibraryRecordById(external.id, OWNER_TENANT_ID);
    expect(view).toMatchObject({ checkRun: { generation: 3, state: CheckRunState.PENDING } });
    await expect(detail(external.id)).resolves.toMatchObject({ verification: { generation: 3, state: 'pending' } });
  });

  it('supports pending then settled polling without writing during reads', async () => {
    const external = await registerExternal({
      run: 'pending',
      storage: { uri: 'https://storage.example/polling', digestMultibase: 'zPolling', receiverKey: RECEIVER_KEY },
    });
    const beforeRuns = await prisma.checkRun.count({ where: { recordId: external.id } });
    const beforeChild = await prisma.externalCredential.findUnique({ where: { id: external.id } });

    await expect(detail(external.id)).resolves.toMatchObject({ verification: { state: 'pending' } });
    const afterReadRuns = await prisma.checkRun.count({ where: { recordId: external.id } });
    const afterReadChild = await prisma.externalCredential.findUnique({ where: { id: external.id } });
    expect(afterReadRuns).toBe(beforeRuns);
    expect(afterReadChild).toEqual(beforeChild);

    await prisma.checkRun.update({
      where: { id: external.checkRunId },
      data: { state: CheckRunState.COMPLETE, ...COMPLETE_CHECKS, completedAt: new Date('2026-09-05T00:00:02.000Z') },
    });
    await expect(detail(external.id)).resolves.toMatchObject({ verification: { state: 'complete' } });
    expect(await prisma.checkRun.count({ where: { recordId: external.id } })).toBe(beforeRuns);
  });

  /**
   * A read that lands mid-replacement, between the two statements Prisma issues
   * for the parent and its relations, cannot be arranged deterministically from
   * here: it needs a hook that holds the reader between those statements. What
   * this case proves is the property a caller can rely on either side of that
   * window, that a custody read is all-old or all-new and never a mix of the
   * two. The repeatable-read isolation level itself is pinned by the repository
   * unit test's argument assertion.
   */
  it('serves the whole old custody triple until the replacement commits, then the whole new triple', async () => {
    const external = await registerExternal({
      storage: {
        uri: 'https://storage.example/custody-old',
        digestMultibase: 'zCustodyOld',
        receiverKey: RECEIVER_KEY,
      },
    });
    const replacementKey = 'd'.repeat(64);
    const replacementProtectedKey = protectDecryptionKey(replacementKey);
    const replacing = createRigClient();
    try {
      const beforeCommit = await replacing.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE "ExternalCredential"
          SET "storageUri" = ${'https://storage.example/custody-new'},
              "storageDigestMultibase" = ${'zCustodyNew'},
              "decryptionKey" = ${replacementProtectedKey}
          WHERE "id" = ${external.id} AND "tenantId" = ${OWNER_TENANT_ID}
        `;
        return detail(external.id);
      });
      expect(beforeCommit).toMatchObject({
        storageUri: 'https://storage.example/custody-old',
        digestMultibase: 'zCustodyOld',
        decryptionKey: RECEIVER_KEY,
      });

      await expect(detail(external.id)).resolves.toMatchObject({
        storageUri: 'https://storage.example/custody-new',
        digestMultibase: 'zCustodyNew',
        decryptionKey: replacementKey,
      });
    } finally {
      await replacing.$disconnect();
    }
  });

  it('rejects an external record with no verification run as a shape error', async () => {
    const id = await insertExternalWithoutRun();
    await expect(getLibraryRecordById(id, OWNER_TENANT_ID)).rejects.toThrow(LibraryRecordShapeError);
  });
});
