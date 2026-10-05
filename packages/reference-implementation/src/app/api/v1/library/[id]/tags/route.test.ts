jest.mock('next/server', () => {
  const { MockNextResponse } = jest.requireActual('../../../../../../../__tests__/route-doubles/next-response');
  return { NextResponse: MockNextResponse };
});

jest.mock('@/lib/api/with-tenant-auth', () => {
  const { handleRouteError } = jest.requireActual('@/lib/api/handle-route-error');
  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<Response>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (error) {
          return handleRouteError(error);
        }
      },
  };
});

jest.mock('@/lib/api/logger');
const loggerCalls = jest.requireMock('@/lib/api/logger').apiLogger as Record<string, jest.Mock>;

/**
 * What the route's `child({ recordId: 'record-1' })` returns. Every other
 * binding gets the shared mock, so a line asserted here was written on a
 * logger bound to this record's id, and one written without that binding
 * misses it.
 */
const recordLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };

const mockGetLibraryRecordById = jest.fn();
const mockReplaceLibraryRecordTags = jest.fn();
const mockUpdateLibraryRecordAnnotations = jest.fn();
// The route classifies a write anomaly with the real error class, so the
// module's exports are kept and only its functions are replaced. The
// annotations update is replaced too, because the parity cases below run the
// annotations PATCH beside this PUT.
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  ...jest.requireActual('@/lib/prisma/repositories/library-record.repository'),
  getLibraryRecordById: (...args: unknown[]) => mockGetLibraryRecordById(...args),
  replaceLibraryRecordTags: (...args: unknown[]) => mockReplaceLibraryRecordTags(...args),
  updateLibraryRecordAnnotations: (...args: unknown[]) => mockUpdateLibraryRecordAnnotations(...args),
}));

// Imported by the PATCH module the parity cases call; neither is reached by them.
jest.mock('@/lib/library/delete-library-record', () => ({ deleteLibraryRecordAndCopy: jest.fn() }));
jest.mock('@/lib/credentials/decryption-key-protection', () => ({ revealDecryptionKey: jest.fn() }));

const mockToCredentialRecord = jest.fn();
const mockToNativeCredentialRecord = jest.fn();
// The route classifies its failures with the real error classes, so only the
// projection functions are replaced, and the per-origin success cases put the
// real ones back.
jest.mock('@/lib/library/credential-record-projection', () => ({
  ...jest.requireActual('@/lib/library/credential-record-projection'),
  toCredentialRecord: (...args: unknown[]) => mockToCredentialRecord(...args),
  toNativeCredentialRecord: (...args: unknown[]) => mockToNativeCredentialRecord(...args),
}));

import {
  CheckResult,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsStatus,
  CredentialStatusCapture,
  LibraryRecordOrigin,
} from '@/lib/prisma/generated';
import { PayloadTooLargeError } from '@/lib/api/errors';
import { CredentialRecordProjectionError, credentialRecordSchema } from '@/lib/library/credential-record-projection';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { LibraryRecordWriteAnomalyError } from '@/lib/prisma/repositories/library-record.repository';
import { PATCH } from '../route';
import { PUT } from './route';

type RouteResponse = { status: number; json: () => Promise<unknown> };

function putRequest(body: unknown, version: string | undefined): Request {
  const headers = new Headers();
  if (version !== undefined) headers.set('If-Version', version);
  return {
    method: 'PUT',
    url: 'http://localhost/api/v1/library/record-1/tags',
    headers,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Request;
}

function patchRequest(body: unknown, version: string | undefined): Request {
  return { ...putRequest(body, version), method: 'PATCH' } as unknown as Request;
}

async function put(body: unknown, version: string | undefined, context = AUTH_CONTEXT): Promise<RouteResponse> {
  return (await PUT(putRequest(body, version), context)) as unknown as RouteResponse;
}

const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({ id: 'record-1' }) };

/** Carries only what the mocked projection needs; the real projection would refuse it. */
const VIEW = {
  origin: LibraryRecordOrigin.EXTERNAL,
  record: { id: 'record-1', tags: [], tagVersion: 1 },
  external: { storageUri: 'https://storage.example/record-1' },
  checkRun: { generation: 1 },
};

const RESPONSE = { id: 'record-1', origin: 'external', tags: ['cab-portal'], tagVersion: 2 };

/**
 * Custody values that cannot reach a projected body by coincidence, so the
 * absence assertions on the real-projection cases cannot pass for the wrong
 * reason.
 */
const CUSTODY_SENTINELS = {
  storageUri: 'https://storage.example/URI-MUST-NOT-LEAK-4b7d',
  decryptionKey: 'KEY-MUST-NOT-LEAK-4b7d',
  storageDigestMultibase: 'zDIGESTMUSTNOTLEAK4b7d',
};

const PARENT = {
  id: 'record-1',
  tenantId: 'tenant-1',
  name: 'Extracted credential name',
  issuerName: 'Supplier',
  issuerDid: 'did:web:supplier.example',
  subjectName: 'Battery pack',
  subjectId: 'https://supplier.example/battery-pack',
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  validUntil: null,
  credentialType: 'DigitalProductPassport',
  coreCredentialType: CoreCredentialType.DPP,
  coreDataModelVersion: '0.7.0',
  detailsStatus: CredentialDetailsStatus.EXTRACTED,
  detailsError: null,
  // Not alphabetical, so a projection or route that sorted the list would
  // fail the order assertions below.
  tags: ['zeta', 'alpha'],
  tagVersion: 2,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-04T00:00:00.000Z'),
};

/** A complete external view, every column the real projection reads. */
const COMPLETE_EXTERNAL_VIEW = {
  origin: LibraryRecordOrigin.EXTERNAL,
  record: { ...PARENT, origin: LibraryRecordOrigin.EXTERNAL },
  external: {
    id: 'record-1',
    tenantId: 'tenant-1',
    origin: LibraryRecordOrigin.EXTERNAL,
    sourceUrl: 'https://supplier.example/credential',
    sourceDigest: 'zSourceDigest',
    contentDigest: 'zContentDigest',
    duplicateOfRecordId: null,
    encrypted: false,
    contentKind: 'CREDENTIAL',
    storageUri: CUSTODY_SENTINELS.storageUri,
    storageDigestMultibase: CUSTODY_SENTINELS.storageDigestMultibase,
    storageServiceInstanceId: 'storage-instance-1',
    storageExternalId: 'object-1',
    storageBucket: 'bucket-1',
    decryptionKey: CUSTODY_SENTINELS.decryptionKey,
    displayName: 'Recipient label',
    declaredCredentialType: CoreCredentialType.DPP,
    dateReceived: new Date('2026-09-08T00:00:00.000Z'),
    notes: null,
    annotationVersion: 5,
    decryptionKeyUnused: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-04T00:00:00.000Z'),
  },
  checkRun: {
    id: 'run-1',
    recordId: 'record-1',
    tenantId: 'tenant-1',
    generation: 1,
    state: CheckRunState.PENDING,
    retrieval: CheckResult.NOT_RUN,
    decryption: CheckResult.NOT_RUN,
    digest: CheckResult.NOT_RUN,
    proof: CheckResult.NOT_RUN,
    status: CheckResult.NOT_RUN,
    temporal: CheckResult.NOT_RUN,
    schemaConformance: CheckResult.NOT_RUN,
    schemaConformanceMessage: null,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    requestedAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: null,
    lastEnqueuedAt: new Date('2026-01-01T00:00:00.000Z'),
    sourceChanged: null,
    lastSourceCheckAt: null,
  },
};

/** A complete native view with no stored run, so the issuance assertion is synthesised. */
const COMPLETE_NATIVE_VIEW = {
  origin: LibraryRecordOrigin.NATIVE,
  record: { ...PARENT, origin: LibraryRecordOrigin.NATIVE },
  credential: {
    id: 'record-1',
    tenantId: 'tenant-1',
    origin: LibraryRecordOrigin.NATIVE,
    storageUri: CUSTODY_SENTINELS.storageUri,
    storageServiceInstanceId: null,
    storageExternalId: null,
    storageBucket: null,
    digestMultibase: CUSTODY_SENTINELS.storageDigestMultibase,
    decryptionKey: CUSTODY_SENTINELS.decryptionKey,
    isPublished: false,
    organisationId: 'organisation-1',
    facilityId: null,
    productId: 'product-1',
    vcServiceInstanceId: null,
    vcServiceAttribution: null,
    vcServiceAttributedAt: null,
    vcServiceAttributionReason: null,
    statusCapture: CredentialStatusCapture.PENDING,
    statusCaptureError: null,
    statusCapturedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-04T00:00:00.000Z'),
  },
  checkRun: null,
};

const realProjection = jest.requireActual<{
  toCredentialRecord: (view: unknown) => unknown;
  toNativeCredentialRecord: (view: unknown) => unknown;
}>('@/lib/library/credential-record-projection');

beforeEach(() => {
  jest.clearAllMocks();
  loggerCalls.child.mockImplementation((bindings: Record<string, unknown>) =>
    bindings.recordId === 'record-1' ? recordLogger : loggerCalls,
  );
  mockGetLibraryRecordById.mockResolvedValue(VIEW);
  mockReplaceLibraryRecordTags.mockResolvedValue({ outcome: 'updated', view: VIEW });
  mockUpdateLibraryRecordAnnotations.mockResolvedValue({ outcome: 'updated', view: VIEW });
  mockToCredentialRecord.mockReturnValue(RESPONSE);
  mockToNativeCredentialRecord.mockReturnValue(RESPONSE);
});

describe('PUT /api/v1/library/:id/tags', () => {
  it.each([
    ['an external record', COMPLETE_EXTERNAL_VIEW, 'external'],
    ['a native record', COMPLETE_NATIVE_VIEW, 'native'],
  ] as const)(
    'replaces the tags on %s and answers the keyless record from that origin’s real projection',
    async (_name, view, origin) => {
      // The real projections, because which one runs is the route's decision:
      // the external projection refuses a native view and the native one an
      // external view, so a route that picked by anything but the view's
      // origin answers 500 on one of these two rows. The pre-write read holds
      // no tags at version 1 and the write returns the new list at version 2,
      // so a route that answered with the record it read first fails.
      mockGetLibraryRecordById.mockResolvedValue({ ...view, record: { ...view.record, tags: [], tagVersion: 1 } });
      mockReplaceLibraryRecordTags.mockResolvedValue({ outcome: 'updated', view });
      mockToCredentialRecord.mockImplementation(realProjection.toCredentialRecord);
      mockToNativeCredentialRecord.mockImplementation(realProjection.toNativeCredentialRecord);

      const response = await put({ tags: ['zeta', 'alpha'] }, '1');

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(credentialRecordSchema.safeParse(body).success).toBe(true);
      expect(body.origin).toBe(origin);
      expect(body.tags).toEqual(['zeta', 'alpha']);
      expect(body.tagVersion).toBe(2);
      expect((body.capabilities as { taggable: boolean }).taggable).toBe(true);
      const rendered = JSON.stringify(body);
      for (const sentinel of Object.values(CUSTODY_SENTINELS)) {
        expect(rendered).not.toContain(sentinel);
      }
      expect(mockReplaceLibraryRecordTags).toHaveBeenCalledWith({
        recordId: 'record-1',
        tenantId: 'tenant-1',
        expectedVersion: 1,
        tags: ['zeta', 'alpha'],
      });
      expect(recordLogger.info).toHaveBeenCalledWith(
        { expectedVersion: 1, tagCount: 2 },
        'Library record tag list accepted',
      );
      expect(recordLogger.info).toHaveBeenCalledWith({ tagVersion: 2, tagCount: 2 }, 'Library record tags replaced');
    },
  );

  it('forwards an empty list as the request to clear the tags', async () => {
    const response = await put({ tags: [] }, '3');

    expect(response.status).toBe(200);
    expect(mockReplaceLibraryRecordTags).toHaveBeenCalledWith({
      recordId: 'record-1',
      tenantId: 'tenant-1',
      expectedVersion: 3,
      tags: [],
    });
  });

  it('answers 404 for an id carrying NUL without reading the record', async () => {
    const response = await put({ tags: [] }, '1', {
      tenantId: 'tenant-1',
      params: Promise.resolve({ id: 'record\u00001' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
    expect(mockGetLibraryRecordById).not.toHaveBeenCalled();
  });

  it('does the tenant-scoped lookup before the header and the body', async () => {
    mockGetLibraryRecordById.mockResolvedValue(null);

    const invalid = putRequest('{not json', 'not-an-int') as unknown as { json: jest.Mock };
    const missing = (await PUT(invalid as unknown as Request, AUTH_CONTEXT)) as unknown as RouteResponse;
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
    expect(invalid.json).not.toHaveBeenCalled();

    const noHeader = await put({ tags: [] }, undefined);
    expect(noHeader.status).toBe(404);
    expect(mockGetLibraryRecordById).toHaveBeenCalledWith('record-1', 'tenant-1');
    expect(mockReplaceLibraryRecordTags).not.toHaveBeenCalled();
  });

  it('validates the header before reading the body, so an oversized body with no header is a header failure', async () => {
    const req = putRequest({}, undefined) as unknown as { json: jest.Mock };
    req.json.mockRejectedValue(new PayloadTooLargeError('too large', 'REQUEST_BODY_TOO_LARGE'));

    const response = (await PUT(req as unknown as Request, AUTH_CONTEXT)) as unknown as RouteResponse;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'If-Version header is required.', code: 'INVALID_IF_VERSION' });
    expect(req.json).not.toHaveBeenCalled();
  });

  it('passes an oversized body through as 413 once the header is valid', async () => {
    const req = putRequest({}, '1') as unknown as { json: jest.Mock };
    req.json.mockRejectedValue(new PayloadTooLargeError('too large', 'REQUEST_BODY_TOO_LARGE'));

    const response = (await PUT(req as unknown as Request, AUTH_CONTEXT)) as unknown as RouteResponse;

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'too large', code: 'REQUEST_BODY_TOO_LARGE' });
    expect(mockReplaceLibraryRecordTags).not.toHaveBeenCalled();
  });

  const RANGE_MESSAGE = 'If-Version must be an integer between 1 and 2147483647.';

  // Every row is refused before the repository, which is where the version is
  // compared: so a stale version sent with any of the invalid bodies below
  // answers this 400 and never the 409.
  it.each([
    ['no header', undefined, { tags: [] }, { error: 'If-Version header is required.', code: 'INVALID_IF_VERSION' }],
    // Both inputs invalid: only this row tells header-before-body apart from
    // body-before-header, which would answer VALIDATION_FAILED.
    ['an invalid header and an empty body', 'abc', {}, { error: RANGE_MESSAGE, code: 'INVALID_IF_VERSION' }],
    ['an empty body', '1', {}, { error: 'tags: is required', code: 'VALIDATION_FAILED' }],
    ['a string list', '1', { tags: 'a' }, { error: 'tags: must be an array', code: 'VALIDATION_FAILED' }],
    [
      'a tag outside the grammar',
      '1',
      { tags: ['ok', 'Not_Valid'] },
      {
        error: 'tags.1: must be lowercase letters and digits, with single hyphens between them',
        code: 'VALIDATION_FAILED',
      },
    ],
  ])('answers 400 for %s and never reaches the repository', async (_name, version, body, expected) => {
    const response = await put(body, version);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expected);
    expect(mockReplaceLibraryRecordTags).not.toHaveBeenCalled();
  });

  it('answers malformed JSON as VALIDATION_FAILED without reaching the repository', async () => {
    const req = putRequest({}, '1') as unknown as { json: jest.Mock };
    req.json.mockRejectedValue(new SyntaxError('Unexpected token'));

    const response = (await PUT(req as unknown as Request, AUTH_CONTEXT)) as unknown as RouteResponse;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body', code: 'VALIDATION_FAILED' });
    expect(mockReplaceLibraryRecordTags).not.toHaveBeenCalled();
  });

  it('answers a stale version as 409 and a record gone after the lock as 404, projecting nothing', async () => {
    mockReplaceLibraryRecordTags.mockResolvedValueOnce({ outcome: 'version_conflict', currentVersion: 4 });
    const stale = await put({ tags: ['a'] }, '3');
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'The supplied If-Version is stale.', code: 'VERSION_CONFLICT' });
    expect(recordLogger.info).toHaveBeenCalledWith(
      { expectedVersion: 3, currentVersion: 4 },
      'Library record tag version conflict',
    );

    mockReplaceLibraryRecordTags.mockResolvedValueOnce({ outcome: 'missing' });
    const missing = await put({ tags: ['a'] }, '3');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });

    expect(mockToCredentialRecord).not.toHaveBeenCalled();
    expect(mockToNativeCredentialRecord).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a projection failure after the replacement committed',
      () =>
        mockToCredentialRecord.mockImplementation(() => {
          throw new CredentialRecordProjectionError('record-1', 'has an invalid stored row');
        }),
      'The library record tag replacement could not be projected',
    ],
    [
      'a write anomaly that rolled the replacement back',
      () =>
        mockReplaceLibraryRecordTags.mockRejectedValue(
          new LibraryRecordWriteAnomalyError('record-1', 'was not updated despite holding its parent lock'),
        ),
      'Library record tag replacement failed and rolled back',
    ],
    [
      'a stored shape the pre-check read met before anything was attempted',
      () =>
        mockGetLibraryRecordById.mockRejectedValue(
          new LibraryRecordShapeError('record-1', 'is EXTERNAL but has no check run'),
        ),
      'The library record could not be read for a tag replacement',
    ],
    [
      "a stored shape the write transaction's own pre-write read met",
      () =>
        mockReplaceLibraryRecordTags.mockRejectedValue(
          new LibraryRecordShapeError('record-1', 'is EXTERNAL but has no check run'),
        ),
      'The library record could not be read for a tag replacement',
    ],
    [
      'an unexpected repository failure',
      () => mockReplaceLibraryRecordTags.mockRejectedValue(new Error('row contains a secret-key-value')),
      'Library record tag replacement failed',
    ],
  ])('answers a sanitised 500 for %s and logs it once against the record', async (_name, arrange, message) => {
    arrange();

    const response = await put({ tags: ['a'] }, '1');

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
    expect(JSON.stringify(body)).not.toContain('secret-key-value');
    // Name and message only, through the shared helper, on the logger that
    // carries the record id and on no other.
    expect(recordLogger.error).toHaveBeenCalledTimes(1);
    expect(recordLogger.error).toHaveBeenCalledWith(
      { error: { name: expect.any(String), message: expect.any(String) } },
      message,
    );
    expect(loggerCalls.error).not.toHaveBeenCalled();
  });

  it('names the record on a database fault before leaving it to the shared mapper', async () => {
    const databaseError = Object.assign(new Error('deadlock detected'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2034',
      clientVersion: '6.19.2',
    });
    mockReplaceLibraryRecordTags.mockRejectedValue(databaseError);

    const response = await put({ tags: ['a'] }, '1');

    expect(response.status).toBe(500);
    expect(recordLogger.warn).toHaveBeenCalledWith('Library record tag replacement hit a database error');
    expect(loggerCalls.error).toHaveBeenCalledWith({ err: databaseError }, 'Unhandled database error');
  });
});

/**
 * Every case that does not depend on the body, sent to this PUT and to the
 * recipient annotations PATCH on the same external record. A client that
 * handles one route's errors handles the other's, so each pair must answer
 * the same status and body. External only: PATCH refuses a native record with
 * a 403 that this route does not have.
 */
describe('PUT /api/v1/library/:id/tags parity with the annotations PATCH', () => {
  type Case = {
    id?: string;
    version: string | undefined;
    arrange?: () => void;
    oversized?: boolean;
    malformed?: boolean;
  };

  async function both(testCase: Case): Promise<[RouteResponse, RouteResponse]> {
    const context = { tenantId: 'tenant-1', params: Promise.resolve({ id: testCase.id ?? 'record-1' }) };
    const send = async (route: typeof PUT, req: Request): Promise<RouteResponse> => {
      jest.clearAllMocks();
      mockGetLibraryRecordById.mockResolvedValue(VIEW);
      mockReplaceLibraryRecordTags.mockResolvedValue({ outcome: 'updated', view: VIEW });
      mockUpdateLibraryRecordAnnotations.mockResolvedValue({ outcome: 'updated', view: VIEW });
      mockToCredentialRecord.mockReturnValue(RESPONSE);
      testCase.arrange?.();
      const json = (req as unknown as { json: jest.Mock }).json;
      if (testCase.oversized) json.mockRejectedValue(new PayloadTooLargeError('too large', 'REQUEST_BODY_TOO_LARGE'));
      if (testCase.malformed) json.mockRejectedValue(new SyntaxError('Unexpected token'));
      return (await route(req, context)) as unknown as RouteResponse;
    };
    const putResponse = await send(PUT, putRequest({ tags: ['a'] }, testCase.version));
    const patchResponse = await send(PATCH, patchRequest({ notes: 'ok' }, testCase.version));
    return [putResponse, patchResponse];
  }

  it.each<[string, Case, number]>([
    ['an id carrying NUL', { id: 'record\u00001', version: '1' }, 404],
    [
      'a missing id with no header',
      { version: undefined, arrange: () => mockGetLibraryRecordById.mockResolvedValue(null) },
      404,
    ],
    ['a missing header', { version: undefined }, 400],
    ['a malformed header', { version: 'abc' }, 400],
    ['an out-of-range header', { version: '2147483648' }, 400],
    ['an oversized body with no header', { version: undefined, oversized: true }, 400],
    ['an oversized body with a valid header', { version: '1', oversized: true }, 413],
    ['a malformed JSON body', { version: '1', malformed: true }, 400],
    [
      'a stale version',
      {
        version: '1',
        arrange: () => {
          mockReplaceLibraryRecordTags.mockResolvedValue({ outcome: 'version_conflict', currentVersion: 2 });
          mockUpdateLibraryRecordAnnotations.mockResolvedValue({ outcome: 'version_conflict', currentVersion: 2 });
        },
      },
      409,
    ],
    [
      'a record gone after the lock',
      {
        version: '1',
        arrange: () => {
          mockReplaceLibraryRecordTags.mockResolvedValue({ outcome: 'missing' });
          mockUpdateLibraryRecordAnnotations.mockResolvedValue({ outcome: 'missing' });
        },
      },
      404,
    ],
    [
      'an unreadable stored record',
      {
        version: '1',
        arrange: () =>
          mockGetLibraryRecordById.mockRejectedValue(new LibraryRecordShapeError('record-1', 'has no check run')),
      },
      500,
    ],
  ])('answers %s exactly as PATCH does', async (_name, testCase, status) => {
    const [putResponse, patchResponse] = await both(testCase);

    expect(putResponse.status).toBe(status);
    expect(patchResponse.status).toBe(status);
    expect(await putResponse.json()).toEqual(await patchResponse.json());
  });
});
