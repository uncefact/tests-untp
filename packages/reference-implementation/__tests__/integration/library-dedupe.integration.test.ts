const capturedLogLines: string[] = [];

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

import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import type { IStorageService, StorageRecord } from '@uncefact/untp-ri-services';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  CheckRunState,
  CheckRunFailureCode,
  CoreCredentialType,
  CredentialDetailsStatus,
  IdempotencyOperation,
  LibraryRecordOrigin,
} from '../../src/lib/prisma/generated';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import { seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import { fetchCredentialDocument } from '../../src/lib/credentials/fetch-credential-document';
import { getEncryptionService } from '../../src/lib/encryption/encryption';
import { claimIdempotencyKey, findIdempotencyKey } from '../../src/lib/prisma/repositories/idempotency-key.repository';
import {
  createExternalCredential,
  findExternalByContentDigest,
  promoteExternalCredentialDigest,
} from '../../src/lib/prisma/repositories/external-credential.repository';
import {
  registerExternalCredential,
  type RegisterExternalCredentialDependencies,
} from '../../src/lib/library/register-external-credential';

jest.unmock('jose');

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.SERVICE_ENCRYPTION_KEY;

const SUPPLIER_KEY = 'b'.repeat(64);
const OTHER_TENANT_ID = 'dedupe-other-tenant';

const quiet = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quiet,
};

function envelopedCredential(payload: object, idPrefix = 'data:application/vc+jwt'): Record<string, unknown> {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${b64({ alg: 'ES256', typ: 'vc+jwt' })}.${b64(payload)}.sig`;
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: `${idPrefix},${jwt}`,
  };
}

const PAYLOAD = {
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/'],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  name: 'Dedupe passport',
  issuer: { id: 'did:web:supplier.example', name: 'Supplier Ltd' },
  validFrom: '2026-07-22T10:00:00Z',
  credentialSubject: { id: 'https://supplier.example/products/1', name: 'Battery pack' },
};
const CREDENTIAL = envelopedCredential(PAYLOAD);
const CREDENTIAL_TWIN = envelopedCredential(PAYLOAD, 'data:application/vc+jwt;serialisation=twin');
const CREDENTIAL_TEXT = JSON.stringify(CREDENTIAL);
/** The segment the decoder accepts, which is what the content identity is taken over. */
const CREDENTIAL_JWT = (CREDENTIAL.id as string).split(',')[1];
const CREDENTIAL_TWIN_TEXT = JSON.stringify(CREDENTIAL_TWIN);
const ENCRYPTED_TEXT = JSON.stringify(
  new AesGcmEncryptionAdapter(SUPPLIER_KEY, quiet as never).encrypt(CREDENTIAL_TEXT, EncryptionAlgorithm.AES_256_GCM),
);

describe('external credential content deduplication', () => {
  const prisma = createRigClient();
  let fixtures: FixtureServer;
  let failNextStorage = false;
  let storageCalls = 0;

  const storage: IStorageService = {
    async store(credential, encrypt = false) {
      return this.storeBinary(JSON.stringify(credential), 'credential.json', 'application/json', encrypt);
    },
    async storeBinary(_content, _filename, contentType, encrypt = false): Promise<StorageRecord> {
      storageCalls += 1;
      if (failNextStorage) {
        failNextStorage = false;
        throw new Error('storage unavailable');
      }
      return {
        uri: `${fixtures.baseUrl}/storage/${storageCalls}`,
        digestMultibase: `zstorage-${storageCalls}`,
        externalId: `storage-${storageCalls}`,
        bucket: encrypt ? 'private' : 'public',
        mimeType: contentType,
        ...(encrypt ? { decryptionKey: 'c'.repeat(64) } : {}),
      };
    },
    async delete() {},
  };

  const dependencies: RegisterExternalCredentialDependencies = {
    fetchDocument: (href) => fetchCredentialDocument(href, { maxBytes: 1_000_000, timeoutMs: 5_000 }),
    resolveStorage: async () => ({ service: storage, instanceId: 'dedupe-storage' }),
    assertEncryptionReady: () => {
      getEncryptionService();
    },
    enqueueVerification: async () => undefined,
    persist: createExternalCredential,
    findExistingExternal: findExternalByContentDigest,
  };

  /** Releases every caller once `count` of them have arrived. */
  function barrierFor(count: number): () => Promise<void> {
    let arrived = 0;
    let release: () => void;
    const open = new Promise<void>((resolve) => {
      release = resolve;
    });
    return async () => {
      arrived += 1;
      if (arrived >= count) release();
      await open;
    };
  }

  async function claimFor(key: string, bodyDigest: string): Promise<string> {
    const claim = await claimIdempotencyKey({
      tenantId: SYSTEM_TENANT_ID,
      operation: IdempotencyOperation.LIBRARY_REGISTER,
      key,
      bodyDigest,
    });
    if (claim.outcome !== 'claimed') throw new Error(`expected a fresh claim, got ${claim.outcome}`);
    return claim.claimId;
  }

  function registerWith(deps: RegisterExternalCredentialDependencies, path: string, idempotencyClaimId: string) {
    return registerExternalCredential(
      {
        tenantId: SYSTEM_TENANT_ID,
        sourceUrl: `${fixtures.baseUrl}${path}`,
        annotations: { displayName: 'Supplier passport', declaredCredentialType: CoreCredentialType.DPP },
        idempotencyClaimId,
      },
      deps,
    );
  }

  /** An advisory row pointing at `canonicalId`, carrying no digest of its own. */
  async function advisoryPointingAt(canonicalId: string, displayName: string, createdAt: Date) {
    const created = await createExternalCredential({
      tenantId: SYSTEM_TENANT_ID,
      sourceUrl: `${fixtures.baseUrl}/two.json`,
      contentDigest: null,
      duplicateOfRecordId: canonicalId,
      annotations: { displayName, declaredCredentialType: CoreCredentialType.DPP },
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: {},
        failure: { code: CheckRunFailureCode.RETRIEVAL_FAILED, message: 'advisory', retryable: true },
      },
    });
    // Pinned rather than left to the clock, so which row is the oldest does
    // not depend on two creates landing in different milliseconds.
    await prisma.externalCredential.update({ where: { id: created.record.id }, data: { createdAt } });
    return created.record.id;
  }

  function register(path: string, tenantId = SYSTEM_TENANT_ID, decryptionKey?: string, idempotencyClaimId?: string) {
    return registerExternalCredential(
      {
        tenantId,
        sourceUrl: `${fixtures.baseUrl}${path}`,
        annotations: { displayName: 'Supplier passport', declaredCredentialType: CoreCredentialType.DPP },
        ...(decryptionKey === undefined ? {} : { decryptionKey }),
        ...(idempotencyClaimId === undefined ? {} : { idempotencyClaimId }),
      },
      dependencies,
    );
  }

  beforeAll(async () => {
    fixtures = await startFixtureServer();
  });

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await seedSystemTenant(prisma);
    await prisma.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Other dedupe tenant' } });
    failNextStorage = false;
    storageCalls = 0;
    capturedLogLines.length = 0;
    fixtures.set('/one.json', { body: CREDENTIAL_TEXT });
    fixtures.set('/two.json', { body: CREDENTIAL_TWIN_TEXT });
    fixtures.set('/encrypted.json', { body: ENCRYPTED_TEXT });
    fixtures.set('/page.html', { body: '<html>same bytes</html>', contentType: 'text/html' });
  });

  afterAll(async () => {
    await fixtures.close();
    await prisma.$disconnect();
  });

  it('rejects a second URL and wrapper serialisation without writing a second record', async () => {
    const first = await register('/one.json');

    await expect(register('/two.json')).rejects.toEqual(expect.objectContaining({ existingRecordId: first.record.id }));
    expect(await prisma.externalCredential.count({ where: { tenantId: SYSTEM_TENANT_ID } })).toBe(1);
    expect(storageCalls).toBe(1);
  });

  it('rejects a plaintext then encrypted twin while never persisting the supplier key', async () => {
    const first = await register('/one.json');

    await expect(register('/encrypted.json', SYSTEM_TENANT_ID, SUPPLIER_KEY)).rejects.toEqual(
      expect.objectContaining({ name: 'DuplicateCredentialError', existingRecordId: first.record.id }),
    );
    expect(JSON.stringify(await prisma.externalCredential.findMany())).not.toContain(SUPPLIER_KEY);
  });

  it('keeps exactly one record when two different URLs race to register one signed credential', async () => {
    // Both requests are held until both have run the content lookup, so
    // neither can see the other's row and the database index is what rejects
    // the loser. Holding them any earlier leaves a window in which the first
    // request commits before the second one looks, and the test then passes
    // through the lookup with the index unexercised.
    const lookups: (string | null)[] = [];
    const barrier = barrierFor(2);
    const raced: RegisterExternalCredentialDependencies = {
      ...dependencies,
      findExistingExternal: async (...args) => {
        const found = await findExternalByContentDigest(...args);
        lookups.push(found);
        await barrier();
        return found;
      },
    };
    const claims = await Promise.all([claimFor('race-a', 'body-a'), claimFor('race-b', 'body-b')]);

    const results = await Promise.allSettled([
      registerWith(raced, '/one.json', claims[0]),
      registerWith(raced, '/two.json', claims[1]),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof register>>> => result.status === 'fulfilled',
    );
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const winnerId = fulfilled[0].value.record.id;
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({ name: 'DuplicateCredentialError', existingRecordId: winnerId }),
    });

    // Both lookups missed, so the rejection came from the unique index.
    expect(lookups).toEqual([null, null]);

    expect(await prisma.libraryRecord.count({ where: { tenantId: SYSTEM_TENANT_ID } })).toBe(1);
    expect(await prisma.externalCredential.count({ where: { tenantId: SYSTEM_TENANT_ID } })).toBe(1);
    expect(await prisma.checkRun.count({ where: { tenantId: SYSTEM_TENANT_ID } })).toBe(1);

    // The winner's claim links to its record. The loser's is left unlinked,
    // with a null recordId, which is the state the register route's catch
    // then releases so the same key can register afresh. This suite drives
    // the pipeline directly, so the release itself is not exercised here.
    const linked = await prisma.idempotencyKey.findMany({
      where: { tenantId: SYSTEM_TENANT_ID },
      select: { id: true, recordId: true },
      orderBy: { id: 'asc' },
    });
    expect(linked.filter((claim) => claim.recordId === winnerId)).toHaveLength(1);
    expect(linked.filter((claim) => claim.recordId === null)).toHaveLength(1);

    // Both requests stored a copy. The loser's is referenced by nothing, and
    // its coordinates are the only record of where it went.
    expect(storageCalls).toBe(2);
    const orphan = capturedLogLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'Registration failed after the durable copy was stored; the copy is orphaned');
    expect(orphan).toMatchObject({ tenantId: SYSTEM_TENANT_ID, storageUri: expect.any(String) });
  });

  it('enforces the database digest index when the service precheck is bypassed', async () => {
    const first = await register('/one.json');
    expect(first.external.contentDigest).not.toBeNull();
    const contentDigest = first.external.contentDigest as string;

    await expect(
      createExternalCredential({
        tenantId: SYSTEM_TENANT_ID,
        sourceUrl: `${fixtures.baseUrl}/two.json`,
        contentDigest,
        annotations: { displayName: 'Bypassed precheck', declaredCredentialType: CoreCredentialType.DPP },
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: {
          state: CheckRunState.FAILED,
          checks: {},
          failure: {
            code: CheckRunFailureCode.RETRIEVAL_FAILED,
            message: 'precheck bypass',
            retryable: true,
          },
        },
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'DuplicateCredentialError', existingRecordId: first.record.id }));
    expect(await prisma.externalCredential.count({ where: { tenantId: SYSTEM_TENANT_ID } })).toBe(1);
  });

  it('keeps a storage-failed credential digest-bearing so a later registration still conflicts', async () => {
    failNextStorage = true;
    const failed = await register('/one.json');

    expect(failed.checkRun.state).toBe(CheckRunState.FAILED);
    expect(failed.external.contentDigest).not.toBeNull();
    await expect(register('/two.json')).rejects.toEqual(
      expect.objectContaining({ existingRecordId: failed.record.id }),
    );
    expect(await prisma.externalCredential.count({ where: { tenantId: SYSTEM_TENANT_ID } })).toBe(1);
  });

  it('allows identical non-credential bodies because they have no signed content identity', async () => {
    const first = await register('/page.html');
    const second = await register('/page.html');

    expect(second.record.id).not.toBe(first.record.id);
    expect(first.external.contentDigest).toBeNull();
    expect(second.external.contentDigest).toBeNull();
  });

  it('keeps the same signed credential independent across tenants', async () => {
    const first = await register('/one.json');
    const second = await register('/two.json', OTHER_TENANT_ID);

    expect(second.record.id).not.toBe(first.record.id);
    expect(await prisma.externalCredential.count({ where: { contentDigest: { not: null } } })).toBe(2);
  });

  it('does not consider a native record during external content lookup', async () => {
    const nativeId = 'dedupe-native-record';
    // The native record holds the same signed artefact at its own copy, so
    // the two records are indistinguishable by content and only the table the
    // lookup reads keeps them apart. The two digests differ by design: a
    // storage digest covers the bytes served at the copy's URI, which here is
    // the envelope JSON, and a content identity covers the signed JWT inside
    // it.
    const contentIdentity = (
      await MultibaseDigest.fromText(CREDENTIAL_JWT, { algorithm: 'sha2-256', base: 'base58btc' })
    ).toString();
    const nativeStorageDigest = (
      await MultibaseDigest.fromText(CREDENTIAL_TEXT, { algorithm: 'sha2-256', base: 'base58btc' })
    ).toString();
    fixtures.set('/native-copy.json', { body: CREDENTIAL_TEXT });
    await prisma.$transaction(async (tx) => {
      await tx.libraryRecord.create({
        data: {
          id: nativeId,
          tenantId: SYSTEM_TENANT_ID,
          origin: LibraryRecordOrigin.NATIVE,
          detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await tx.credential.create({
        data: {
          id: nativeId,
          tenantId: SYSTEM_TENANT_ID,
          origin: LibraryRecordOrigin.NATIVE,
          storageUri: `${fixtures.baseUrl}/native-copy.json`,
          digestMultibase: nativeStorageDigest,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });

    // The lookup reads ExternalCredential only, so a native record cannot be
    // returned by it whatever it holds. Fails if the lookup is ever widened
    // to the parent table or to a storage digest, both of which now match.
    const external = await register('/one.json');

    expect(external.external.contentDigest).toBe(contentIdentity);
    expect(external.record.id).not.toBe(nativeId);
    expect(await findExternalByContentDigest(SYSTEM_TENANT_ID, contentIdentity, external.record.id)).toBeNull();
    expect(await prisma.credential.findUnique({ where: { id: nativeId } })).toMatchObject({
      tenantId: SYSTEM_TENANT_ID,
      digestMultibase: nativeStorageDigest,
    });
    expect(nativeStorageDigest).not.toBe(contentIdentity);
    expect(await prisma.libraryRecord.count({ where: { tenantId: SYSTEM_TENANT_ID } })).toBe(2);
  });

  it('classifies a changed body under a used key as a mismatch, against a real registration', async () => {
    // What this pins is the repository classification, with a real record and
    // a real linked claim behind the key rather than a hand-built row. The
    // 422 the route answers to that classification, and the fact that it
    // answers before any fetch, are pinned at the route in
    // `src/app/api/v1/library/route.test.ts`.
    const first = await register('/one.json', SYSTEM_TENANT_ID, undefined, await claimFor('changed-bytes', 'body-1'));
    await prisma.idempotencyKey.updateMany({
      where: { tenantId: SYSTEM_TENANT_ID, key: 'changed-bytes' },
      data: { recordId: first.record.id },
    });

    await expect(
      findIdempotencyKey({
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: 'changed-bytes',
        bodyDigest: 'body-2',
      }),
    ).resolves.toEqual({ outcome: 'mismatch' });
    expect(await prisma.externalCredential.count({ where: { tenantId: SYSTEM_TENANT_ID } })).toBe(1);
  });

  it('leaves a surviving advisory row in place when its canonical record is deleted', async () => {
    // No promotion here, so the foreign key is what runs. Its SET NULL names
    // duplicateOfRecordId alone, and the unqualified form would try to null
    // tenantId too, so the delete would fail on the NOT NULL column.
    const canonical = await register('/one.json');
    const advisory = await createExternalCredential({
      tenantId: SYSTEM_TENANT_ID,
      sourceUrl: `${fixtures.baseUrl}/two.json`,
      contentDigest: null,
      duplicateOfRecordId: canonical.record.id,
      annotations: { displayName: 'Advisory passport', declaredCredentialType: CoreCredentialType.DPP },
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: {},
        failure: { code: CheckRunFailureCode.RETRIEVAL_FAILED, message: 'advisory', retryable: true },
      },
    });

    await prisma.libraryRecord.delete({ where: { id: canonical.record.id } });

    const survivor = await prisma.externalCredential.findUnique({ where: { id: advisory.record.id } });
    expect(survivor).toMatchObject({
      id: advisory.record.id,
      tenantId: SYSTEM_TENANT_ID,
      duplicateOfRecordId: null,
      contentDigest: null,
    });
  });

  it('refuses a row that is both canonical and advisory', async () => {
    // The two are exclusive. A row holding both would be invisible to the
    // advisory lookup, which selects on a null digest, so a promotion would
    // silently skip it.
    const canonical = await register('/one.json');

    await expect(
      prisma.externalCredential.update({
        where: { id: canonical.record.id },
        data: { duplicateOfRecordId: canonical.record.id },
      }),
    ).rejects.toThrow(/ExternalCredential_content_identity_exclusive_check/);
  });

  it('releases a deleted record claim so the same key can register an unrelated record', async () => {
    const firstClaim = await claimIdempotencyKey({
      tenantId: SYSTEM_TENANT_ID,
      operation: IdempotencyOperation.LIBRARY_REGISTER,
      key: 'delete-and-reuse',
      bodyDigest: 'body-1',
    });
    if (firstClaim.outcome !== 'claimed') throw new Error(`expected a fresh claim, got ${firstClaim.outcome}`);
    const first = await register('/one.json', SYSTEM_TENANT_ID, undefined, firstClaim.claimId);
    await prisma.idempotencyKey.update({ where: { id: firstClaim.claimId }, data: { recordId: first.record.id } });
    await prisma.libraryRecord.delete({ where: { id: first.record.id } });

    expect(
      await findIdempotencyKey({
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: 'delete-and-reuse',
        bodyDigest: 'body-1',
      }),
    ).toEqual({ outcome: 'absent' });
    const secondClaim = await claimIdempotencyKey({
      tenantId: SYSTEM_TENANT_ID,
      operation: IdempotencyOperation.LIBRARY_REGISTER,
      key: 'delete-and-reuse',
      bodyDigest: 'body-1',
    });
    if (secondClaim.outcome !== 'claimed') throw new Error(`expected a new claim, got ${secondClaim.outcome}`);
    const second = await register('/two.json', SYSTEM_TENANT_ID, undefined, secondClaim.claimId);
    expect(second.record.id).not.toBe(first.record.id);
  });

  it('promotes the oldest advisory row before deleting its canonical record', async () => {
    const canonical = await register('/one.json');
    const advisoryId = await advisoryPointingAt(canonical.record.id, 'Advisory passport', new Date('2026-01-01'));

    await prisma.$transaction(async (tx) => {
      await expect(
        promoteExternalCredentialDigest(tx, {
          tenantId: SYSTEM_TENANT_ID,
          recordId: canonical.record.id,
          contentDigest: canonical.external.contentDigest as string,
        }),
      ).resolves.toEqual({ outcome: 'promoted', recordId: advisoryId, repointed: 0 });
      await tx.libraryRecord.delete({ where: { id: canonical.record.id } });
    });

    const promoted = await prisma.externalCredential.findUnique({ where: { id: advisoryId } });
    expect(promoted?.contentDigest).toBe(canonical.external.contentDigest);
    expect(promoted?.duplicateOfRecordId).toBeNull();
  });

  it('carries a second advisory row across to the promoted row when the former owner is deleted', async () => {
    // A holds the identity, B and C point at A. Once B takes the identity, C
    // must follow it. Left pointing at A, C loses its pointer to the foreign
    // key when A is deleted and ends up attached to nothing.
    const a = await register('/one.json');
    const digest = a.external.contentDigest as string;
    const b = await advisoryPointingAt(a.record.id, 'Advisory B', new Date('2026-01-01'));
    const c = await advisoryPointingAt(a.record.id, 'Advisory C', new Date('2026-01-02'));

    await prisma.$transaction(async (tx) => {
      await expect(
        promoteExternalCredentialDigest(tx, {
          tenantId: SYSTEM_TENANT_ID,
          recordId: a.record.id,
          contentDigest: digest,
        }),
      ).resolves.toEqual({ outcome: 'promoted', recordId: b, repointed: 1 });
      await tx.libraryRecord.delete({ where: { id: a.record.id } });
    });

    expect(await prisma.externalCredential.findUnique({ where: { id: c } })).toMatchObject({
      duplicateOfRecordId: b,
      contentDigest: null,
    });
    await expect(register('/two.json')).rejects.toEqual(expect.objectContaining({ existingRecordId: b }));
  });

  it('does not hand a second advisory row a later, unrelated digest of the former owner', async () => {
    // A holds X, B and C point at A. B takes X and C follows it. A is then
    // given Y and relinquishes it. C holds content X, so it must not receive
    // Y, and it only escapes because it no longer points at A.
    const a = await register('/one.json');
    const digestX = a.external.contentDigest as string;
    const b = await advisoryPointingAt(a.record.id, 'Advisory B', new Date('2026-01-01'));
    const c = await advisoryPointingAt(a.record.id, 'Advisory C', new Date('2026-01-02'));

    await prisma.$transaction(async (tx) =>
      promoteExternalCredentialDigest(tx, {
        tenantId: SYSTEM_TENANT_ID,
        recordId: a.record.id,
        contentDigest: digestX,
      }),
    );

    // The caller's contract is one transaction per change, so the release of
    // Y and the assignment of the next value happen together rather than in
    // two commits a reader could observe between.
    const digestY = 'zINTEGunrelatedcontentidentity';
    const digestZ = 'zINTEGthirdcontentidentity';
    await prisma.$transaction(async (tx) => {
      await tx.externalCredential.update({ where: { id: a.record.id }, data: { contentDigest: digestY } });
      await expect(
        promoteExternalCredentialDigest(tx, {
          tenantId: SYSTEM_TENANT_ID,
          recordId: a.record.id,
          contentDigest: digestY,
        }),
      ).resolves.toEqual({ outcome: 'none' });
      await tx.externalCredential.update({ where: { id: a.record.id }, data: { contentDigest: digestZ } });
    });

    expect(await prisma.externalCredential.findUnique({ where: { id: c } })).toMatchObject({
      duplicateOfRecordId: b,
      contentDigest: null,
    });
    expect(await prisma.externalCredential.findUnique({ where: { id: b } })).toMatchObject({ contentDigest: digestX });
    expect(await prisma.externalCredential.findUnique({ where: { id: a.record.id } })).toMatchObject({
      contentDigest: digestZ,
    });
  });
});
