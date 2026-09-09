import { CheckResult, CheckRunFailureCode, CheckRunState, CoreCredentialType } from '../../src/lib/prisma/generated';
import { credentialRecordSchema } from '../../src/lib/library/credential-record-projection';
import { protectDecryptionKey } from '../../src/lib/credentials/decryption-key-protection';
import { noChecksRun } from '../../src/lib/prisma/repositories/check-run.repository';
import { insertExternalCredential, insertNativeCredential } from './fixtures';
import { createRigClient, truncateApplicationTables } from './rig/db';

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.SERVICE_ENCRYPTION_KEY;

jest.mock('@/lib/api/with-tenant-auth', () => {
  const { handleRouteError } = jest.requireActual(
    '../../src/lib/api/handle-route-error',
  ) as typeof import('../../src/lib/api/handle-route-error');
  return {
    withTenantAuth:
      (handler: (request: Request, context: Record<string, unknown>) => Promise<Response>) =>
      async (request: Request, context: Record<string, unknown>) => {
        try {
          return await handler(request, {
            ...context,
            userId: 'library-batch-get-integration-user',
            authMethod: 'session',
          });
        } catch (error: unknown) {
          return handleRouteError(error);
        }
      },
  };
});

const prisma = createRigClient();
const OWNER_TENANT_ID = 'library-batch-get-owner';
const OTHER_TENANT_ID = 'library-batch-get-other';
const originalBatchLimit = process.env.API_MAX_BATCH_LIMIT;

type RouteContext = { params: Promise<Record<string, string>>; tenantId: string };

let post: (request: Request, context: RouteContext) => Promise<Response>;

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/library/batch-get', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postAsOwner(body: unknown): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await post(request(body), {
    params: Promise.resolve({}),
    tenantId: OWNER_TENANT_ID,
  });
  return { response, body: (await response.json()) as Record<string, unknown> };
}

async function appendFailedGeneration(recordId: string, generation: number): Promise<void> {
  await prisma.checkRun.create({
    data: {
      recordId,
      tenantId: OWNER_TENANT_ID,
      generation,
      state: CheckRunState.FAILED,
      ...noChecksRun(),
      retrieval: CheckResult.FAIL,
      failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
      failureMessage: 'The source could not be retrieved.',
      failureRetryable: true,
      completedAt: new Date('2026-08-02T00:00:00.000Z'),
    },
  });
}

beforeAll(async () => {
  ({ POST: post } = await import('../../src/app/api/v1/library/batch-get/route'));
});

beforeEach(async () => {
  await truncateApplicationTables(prisma);
  await prisma.tenant.create({ data: { id: OWNER_TENANT_ID, name: 'Library batch-get owner' } });
  await prisma.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Library batch-get other' } });
});

afterAll(async () => {
  await prisma.$disconnect();
  if (originalBatchLimit === undefined) delete process.env.API_MAX_BATCH_LIMIT;
  else process.env.API_MAX_BATCH_LIMIT = originalBatchLimit;
});

describe('POST /library/batch-get against migrated Postgres', () => {
  it('returns both origins in [b, missing, a, b, foreign] order while omitting duplicates, missing and foreign ids', async () => {
    const nativeId = (
      await insertNativeCredential(prisma, {
        id: 'library-batch-native',
        tenantId: OWNER_TENANT_ID,
        coreCredentialType: CoreCredentialType.DPP,
      })
    ).id;
    const externalId = await insertExternalCredential(prisma, OWNER_TENANT_ID);
    const foreignId = (await insertNativeCredential(prisma, { id: 'library-batch-foreign', tenantId: OTHER_TENANT_ID }))
      .id;

    const { response, body } = await postAsOwner({
      ids: [externalId, 'library-batch-missing', nativeId, externalId, foreignId],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((body.data as { id: string }[]).map(({ id }) => id)).toEqual([externalId, nativeId]);
  });

  it('omits a foreign id indistinguishably from a missing id and returns an all-missing empty array', async () => {
    await insertNativeCredential(prisma, { id: 'library-batch-foreign', tenantId: OTHER_TENANT_ID });

    const mixed = await postAsOwner({ ids: ['library-batch-foreign', 'library-batch-missing'] });
    expect(mixed.response.status).toBe(200);
    expect(mixed.body).toEqual({ data: [] });
    expect(mixed.response.headers.get('cache-control')).toBe('no-store');

    const empty = await postAsOwner({ ids: ['library-batch-missing-a', 'library-batch-missing-b'] });
    expect(empty.response.status).toBe(200);
    expect(empty.body).toEqual({ data: [] });
  });

  it('returns the newest failed generation after an older verified generation', async () => {
    const id = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'complete' });
    await appendFailedGeneration(id, 2);

    const { response, body } = await postAsOwner({ ids: [id] });
    const row = (body.data as Record<string, unknown>[])[0];

    expect(response.status).toBe(200);
    expect(row).toMatchObject({
      id,
      verification: { generation: 2, state: 'failed', summary: 'failed' },
    });
  });

  it('projects native records with and without runs and external records across verification states', async () => {
    const nativeWithoutRun = (
      await insertNativeCredential(prisma, {
        id: 'library-batch-native-no-run',
        tenantId: OWNER_TENANT_ID,
      })
    ).id;
    const nativeWithRun = (
      await insertNativeCredential(prisma, {
        id: 'library-batch-native-run',
        tenantId: OWNER_TENANT_ID,
        checkRun: { generation: 2, state: CheckRunState.COMPLETE, proof: CheckResult.PASS },
      })
    ).id;
    const pending = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'pending' });
    const complete = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'complete' });
    const failed = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'failed' });
    const nothingRan = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'nothingRan' });

    const expected = new Map([
      [nativeWithoutRun, { state: 'complete', generation: 1 }],
      [nativeWithRun, { state: 'complete', generation: 2 }],
      [pending, { state: 'pending', generation: 1 }],
      [complete, { state: 'complete', generation: 1 }],
      [failed, { state: 'failed', generation: 1 }],
      [nothingRan, { state: 'complete', generation: 1, summary: 'not_conformant' }],
    ]);

    for (const ids of [
      [nativeWithoutRun, nativeWithRun],
      [pending, complete],
      [failed, nothingRan],
    ]) {
      const { response, body } = await postAsOwner({ ids });
      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(2);
      for (const row of body.data as (Record<string, unknown> & { id: string })[]) {
        expect(credentialRecordSchema.safeParse(row).success).toBe(true);
        const expectation = expected.get(row.id);
        if (expectation === undefined) throw new Error(`unexpected record returned: ${row.id}`);
        expect(row.verification).toMatchObject(expectation);
      }
    }
  });

  it('returns the requested ids in order and keeps protected native and external custody keyless', async () => {
    const nativeId = (
      await insertNativeCredential(prisma, {
        id: 'library-batch-native-protected',
        tenantId: OWNER_TENANT_ID,
        decryptionKey: protectDecryptionKey('a'.repeat(64)),
      })
    ).id;
    const externalId = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      encrypted: true,
      storage: {
        uri: 'https://storage.example/library-batch-protected',
        digestMultibase: 'zLibraryBatchStoredDigest',
        serviceInstanceId: 'library-batch-storage',
        externalId: 'library-batch-protected',
        bucket: 'private',
        decryptionKey: protectDecryptionKey('c'.repeat(64)),
      },
    });

    const { response, body } = await postAsOwner({ ids: [externalId, nativeId] });

    expect(response.status).toBe(200);
    expect((body.data as { id: string }[]).map(({ id }) => id)).toEqual([externalId, nativeId]);
    for (const row of body.data as Record<string, unknown>[]) {
      expect(credentialRecordSchema.safeParse(row).success).toBe(true);
      expect(row).not.toHaveProperty('decryptionKey');
      expect(row).not.toHaveProperty('storageUri');
      expect(row).not.toHaveProperty('digestMultibase');
      expect(row).not.toHaveProperty('tenantId');
    }
  });

  it('drops a NUL-bearing id while returning a valid id', async () => {
    const id = await insertNativeCredential(prisma, {
      id: 'library-batch-nul-valid',
      tenantId: OWNER_TENANT_ID,
    });

    const { response, body } = await postAsOwner({ ids: [id.id, 'library-batch-bad\0id'] });

    expect(response.status).toBe(200);
    expect((body.data as { id: string }[]).map(({ id: returnedId }) => returnedId)).toEqual([id.id]);
  });

  it('returns all five ids in request order at the maximum and rejects six duplicate submissions before deduplication', async () => {
    const ids = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        insertNativeCredential(prisma, {
          id: `library-batch-limit-${index}`,
          tenantId: OWNER_TENANT_ID,
        }),
      ),
    ).then((records) => records.map(({ id }) => id));

    const atMaximum = await postAsOwner({ ids });
    expect(atMaximum.response.status).toBe(200);
    expect((atMaximum.body.data as { id: string }[]).map(({ id }) => id)).toEqual(ids);

    const over = await postAsOwner({ ids: Array(6).fill(ids[0]) });
    expect(over.response.status).toBe(400);
    expect(over.body).toEqual({
      error: 'ids: submit no more than 5 ids per request',
      code: 'BATCH_GET_LIMIT_EXCEEDED',
    });
  });
});
