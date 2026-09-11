jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: { get: (name: string) => init?.headers?.[name] ?? null },
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/api/with-tenant-auth', () => {
  const { handleRouteError } = jest.requireActual('@/lib/api/handle-route-error');
  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (error: unknown) {
          return handleRouteError(error);
        }
      },
  };
});

jest.mock('@/lib/api/logger');
const logger = jest.requireMock('@/lib/api/logger').apiLogger as Record<string, jest.Mock>;
const mockError = logger.error;
const mockInfo = logger.info;

const mockBatchGetLibraryRecords = jest.fn();
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  batchGetLibraryRecords: (...args: unknown[]) => mockBatchGetLibraryRecords(...args),
}));

jest.mock('@/lib/api/batch-limits', () => ({ MAX_BATCH_LIMIT: 3 }));

import { CheckResult, CheckRunState, CoreCredentialType, LibraryRecordOrigin } from '@/lib/prisma/generated';
import { UNEXPECTED_ERROR_MESSAGE } from '@/lib/api/errors';
import { credentialRecordSchema } from '@/lib/library/credential-record-projection';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { LibraryRecordSelectionError } from '@/lib/library/library-read-errors';
import { libraryHydrationResult as hydrated } from '../../../../../../__tests__/route-doubles/library-hydration-result';
import { POST } from './route';

const AUTH_CONTEXT = { tenantId: 'tenant-owner', params: Promise.resolve({}) };

function request(body: unknown): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/library/batch-get',
    headers: { get: () => 'application/json' } as unknown as Headers,
    json: async () => body,
  } as unknown as Request;
}

async function post(body: unknown) {
  const response = (await POST(request(body), AUTH_CONTEXT as never)) as unknown as {
    status: number;
    headers: { get: (name: string) => string | null };
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: response.status, headers: response.headers, body: await response.json() };
}

function externalView(id: string) {
  return {
    origin: LibraryRecordOrigin.EXTERNAL,
    record: {
      id,
      tenantId: 'tenant-owner',
      origin: LibraryRecordOrigin.EXTERNAL,
      name: 'External credential',
      issuerName: 'Example issuer',
      issuerDid: 'did:web:issuer.example',
      subjectName: 'Example subject',
      subjectId: 'https://issuer.example/subject',
      validFrom: new Date('2026-07-20T10:00:00.000Z'),
      validUntil: null,
      credentialType: 'DigitalProductPassport',
      coreCredentialType: CoreCredentialType.DPP,
      coreDataModelVersion: '0.7.0',
      detailsStatus: 'EXTRACTED',
      detailsError: null,
      createdAt: new Date('2026-07-30T09:00:00.000Z'),
      updatedAt: new Date('2026-07-30T09:00:06.000Z'),
    },
    external: {
      id,
      tenantId: 'tenant-owner',
      origin: LibraryRecordOrigin.EXTERNAL,
      sourceUrl: `https://issuer.example/credentials/${id}`,
      sourceDigest: 'zQmExampleSourceDigest',
      contentDigest: null,
      duplicateOfRecordId: null,
      encrypted: false,
      contentKind: 'CREDENTIAL',
      storageUri: 'https://storage.example/objects/example',
      storageDigestMultibase: 'zQmStoredDigest',
      storageServiceInstanceId: 'storage-service',
      storageExternalId: 'object-1',
      storageBucket: 'private-data',
      decryptionKey: 'secret-key-must-not-be-returned',
      displayName: 'External credential',
      declaredCredentialType: CoreCredentialType.DPP,
      dateReceived: new Date('2026-07-30T00:00:00.000Z'),
      notes: null,
      annotationVersion: 1,
      decryptionKeyUnused: false,
      createdAt: new Date('2026-07-30T09:00:00.000Z'),
      updatedAt: new Date('2026-07-30T09:00:06.000Z'),
    },
    checkRun: {
      id: `run-${id}`,
      recordId: id,
      tenantId: 'tenant-owner',
      generation: 1,
      state: CheckRunState.COMPLETE,
      retrieval: CheckResult.PASS,
      decryption: CheckResult.NOT_RUN,
      digest: CheckResult.PASS,
      proof: CheckResult.PASS,
      status: CheckResult.PASS,
      temporal: CheckResult.PASS,
      schemaConformance: CheckResult.PASS,
      failureCode: null,
      failureMessage: null,
      failureRetryable: null,
      requestedAt: new Date('2026-07-30T09:00:00.000Z'),
      completedAt: new Date('2026-07-30T09:00:06.000Z'),
      lastEnqueuedAt: null,
      sourceChanged: null,
      lastSourceCheckAt: null,
    },
  };
}

function nativeView(id: string) {
  const view = externalView(id);
  return {
    origin: LibraryRecordOrigin.NATIVE,
    record: {
      ...view.record,
      origin: LibraryRecordOrigin.NATIVE,
      coreCredentialType: CoreCredentialType.DCC,
    },
    credential: {
      id,
      tenantId: 'tenant-owner',
      origin: LibraryRecordOrigin.NATIVE,
      storageUri: 'https://storage.example/native',
      digestMultibase: 'zQmNativeDigest',
      decryptionKey: null,
      isPublished: false,
      organisationId: null,
      facilityId: null,
      productId: null,
      createdAt: new Date('2026-07-30T09:00:00.000Z'),
      updatedAt: new Date('2026-07-30T09:00:00.000Z'),
    },
    checkRun: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchGetLibraryRecords.mockResolvedValue(hydrated([]));
});

describe('POST /library/batch-get validation', () => {
  it('returns a malformed JSON validation error without reading the repository', async () => {
    const malformedRequest = {
      method: 'POST',
      url: 'http://localhost/api/v1/library/batch-get',
      headers: { get: () => 'application/json' } as unknown as Headers,
      json: async () => {
        throw new SyntaxError('invalid JSON');
      },
    } as unknown as Request;

    const response = (await POST(malformedRequest, AUTH_CONTEXT as never)) as unknown as {
      status: number;
      json: () => Promise<Record<string, unknown>>;
    };

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid JSON body' });
    expect(mockBatchGetLibraryRecords).not.toHaveBeenCalled();
  });

  it('rejects an empty id set and names ids without reading the repository', async () => {
    const { status, body } = await post({ ids: [] });

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'ids: must contain at least one id' });
    expect(mockBatchGetLibraryRecords).not.toHaveBeenCalled();
  });

  it('accepts exactly three submitted ids and rejects a fourth with the configured limit code', async () => {
    await expect(post({ ids: ['record-a', 'record-b', 'record-c'] })).resolves.toMatchObject({ status: 200 });
    expect(mockBatchGetLibraryRecords).toHaveBeenCalledWith({
      tenantId: 'tenant-owner',
      ids: ['record-a', 'record-b', 'record-c'],
    });

    mockBatchGetLibraryRecords.mockClear();
    const { status, body } = await post({ ids: ['record-a', 'record-b', 'record-c', 'record-d'] });

    expect(status).toBe(400);
    expect(body).toEqual({
      error: 'ids: submit no more than 3 ids per request',
      code: 'BATCH_GET_LIMIT_EXCEEDED',
    });
    expect(mockBatchGetLibraryRecords).not.toHaveBeenCalled();
  });

  it('checks the submitted count before deduplication', async () => {
    const { status, body } = await post({ ids: ['record-a', 'record-a', 'record-a', 'record-a'] });

    expect(status).toBe(400);
    expect(body).toEqual({
      error: 'ids: submit no more than 3 ids per request',
      code: 'BATCH_GET_LIMIT_EXCEEDED',
    });
    expect(mockBatchGetLibraryRecords).not.toHaveBeenCalled();
  });

  it('reports an invalid element before an over-limit error and leaves the code absent', async () => {
    const { status, body } = await post({ ids: ['', 'record-a', 'record-b', 'record-c'] });

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'ids.0: must not be empty' });
    expect(mockBatchGetLibraryRecords).not.toHaveBeenCalled();
  });
});

describe('POST /library/batch-get selection and projection', () => {
  it('deduplicates exact ids, passes the tenant boundary, and preserves first-appearance order', async () => {
    mockBatchGetLibraryRecords.mockResolvedValue(hydrated([externalView('record-b'), nativeView('record-a')]));

    const { status, body, headers } = await post({ ids: ['record-b', 'record-a', 'record-b'] });

    expect(status).toBe(200);
    expect(mockBatchGetLibraryRecords).toHaveBeenCalledWith({
      tenantId: 'tenant-owner',
      ids: ['record-b', 'record-a'],
    });
    expect((body.data as { id: string }[]).map(({ id }) => id)).toEqual(['record-b', 'record-a']);
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('reports NUL-bearing ids while returning valid records', async () => {
    mockBatchGetLibraryRecords.mockResolvedValue(hydrated([nativeView('record-a')]));

    const { status, body, headers } = await post({ ids: ['record-a', 'bad\0id'] });

    expect(status).toBe(200);
    expect(mockBatchGetLibraryRecords).toHaveBeenCalledWith({ tenantId: 'tenant-owner', ids: ['record-a'] });
    expect((body.data as { id: string }[]).map(({ id }) => id)).toEqual(['record-a']);
    expect(body.failures).toEqual([{ id: 'bad\0id', code: 'NOT_FOUND', message: 'No such credential record.' }]);
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('accounts for every distinct all-NUL id without reading the repository', async () => {
    const { status, body, headers } = await post({ ids: ['bad\0id', 'another\0id'] });

    expect(status).toBe(200);
    expect(body).toEqual({
      data: [],
      failures: [
        { id: 'bad\0id', code: 'NOT_FOUND', message: 'No such credential record.' },
        { id: 'another\0id', code: 'NOT_FOUND', message: 'No such credential record.' },
      ],
    });
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(mockBatchGetLibraryRecords).not.toHaveBeenCalled();
  });

  it('returns a NOT_FOUND failure with no-store when no requested record is found', async () => {
    const { status, body, headers } = await post({ ids: ['missing'] });

    expect(status).toBe(200);
    expect(body).toEqual({
      data: [],
      failures: [{ id: 'missing', code: 'NOT_FOUND', message: 'No such credential record.' }],
    });
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('projects mixed origins in request order against the strict keyless schema', async () => {
    mockBatchGetLibraryRecords.mockResolvedValue(
      hydrated([externalView('record-external'), nativeView('record-native')]),
    );

    const { body } = await post({ ids: ['record-external', 'record-native'] });

    expect((body.data as { id: string }[]).map(({ id }) => id)).toEqual(['record-external', 'record-native']);
    for (const row of body.data as Record<string, unknown>[]) {
      expect(credentialRecordSchema.safeParse(row).success).toBe(true);
      expect(row).not.toHaveProperty('decryptionKey');
      expect(row).not.toHaveProperty('storageUri');
      expect(row).not.toHaveProperty('digestMultibase');
      expect(row).not.toHaveProperty('tenantId');
    }
    expect(body.failures).toEqual([]);
  });

  it('returns a RECORD_UNREADABLE failure when a selected record cannot be projected', async () => {
    const invalid = {
      ...externalView('record-invalid'),
      checkRun: { ...externalView('record-invalid').checkRun, state: CheckRunState.COMPLETE, completedAt: null },
    };
    mockBatchGetLibraryRecords.mockResolvedValue(hydrated([invalid]));

    const { status, body } = await post({ ids: ['record-invalid'] });

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.failures).toEqual([
      {
        id: 'record-invalid',
        code: 'RECORD_UNREADABLE',
        message: expect.stringContaining('x-correlation-id response header'),
      },
    ]);
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'record-invalid', code: 'RECORD_UNREADABLE', readStage: 'projection' }),
      'Library record read degraded',
    );
  });

  it('returns a RECORD_UNREADABLE failure when the repository reports a row it could not hydrate', async () => {
    // The repository's own failure branch, which the projection case above
    // does not reach: a selected row that never became a view at all.
    mockBatchGetLibraryRecords.mockResolvedValue(
      hydrated(
        [nativeView('record-a')],
        [{ id: 'record-damaged', error: new LibraryRecordShapeError('record-damaged', 'is EXTERNAL but has no run') }],
      ),
    );

    const { status, body } = await post({ ids: ['record-a', 'record-damaged'] });

    expect(status).toBe(200);
    expect((body.data as { id: string }[]).map(({ id }) => id)).toEqual(['record-a']);
    expect(body.failures).toEqual([
      {
        id: 'record-damaged',
        code: 'RECORD_UNREADABLE',
        message: expect.stringContaining('x-correlation-id response header'),
      },
    ]);
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'record-damaged',
        code: 'RECORD_UNREADABLE',
        readStage: 'hydration',
        reason: 'shape',
        errorCode: 'library.record-shape',
        error: expect.objectContaining({ name: 'LibraryRecordShapeError' }),
      }),
      'Library record read degraded',
    );
  });

  it('sanitises a selection-boundary failure and publishes no id from it', async () => {
    // A row outside the caller's selection cannot be attributed to any id, so
    // the whole request fails, and neither the offending id nor the caller's
    // own id may appear in the body.
    mockBatchGetLibraryRecords.mockRejectedValue(
      new LibraryRecordSelectionError('record record-foreign was returned during hydration but was not selected'),
    );

    const { status, body } = await post({ ids: ['record-a'] });

    expect(status).toBe(500);
    expect(String(body.error)).toContain(UNEXPECTED_ERROR_MESSAGE);
    expect(JSON.stringify(body)).not.toContain('record-foreign');
    expect(JSON.stringify(body)).not.toContain('record-a');
  });

  it('emits one summary line carrying the counts for the request that produced them', async () => {
    mockBatchGetLibraryRecords.mockResolvedValue(
      hydrated(
        [nativeView('record-a')],
        [{ id: 'record-damaged', error: new LibraryRecordShapeError('record-damaged', 'is EXTERNAL but has no run') }],
      ),
    );

    await post({ ids: ['record-a', 'record-damaged', 'record-missing'] });

    const summaries = mockInfo.mock.calls.filter(([, message]) => message === 'Library record read summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0][0]).toMatchObject({
      route: '/api/v1/library/batch-get',
      returned: 1,
      unreadable: 1,
      notFound: 1,
    });
  });

  it('keeps a database failure on the shared sanitised error mapping', async () => {
    mockBatchGetLibraryRecords.mockRejectedValue(
      Object.assign(new Error('relation and tenant internals'), {
        name: 'PrismaClientKnownRequestError',
        clientVersion: '6.19.2',
      }),
    );

    const { status, body } = await post({ ids: ['record-a'] });

    expect(status).toBe(500);
    expect(String(body.error)).toContain(UNEXPECTED_ERROR_MESSAGE);
    expect(String(body.error)).not.toContain('relation and tenant internals');
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      'Unhandled database error',
    );
    expect(mockError).not.toHaveBeenCalledWith(
      expect.anything(),
      'The library records could not be fetched in a batch',
    );
  });
});
