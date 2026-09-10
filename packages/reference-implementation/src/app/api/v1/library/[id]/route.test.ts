jest.mock('next/server', () => {
  const { MockNextResponse } = jest.requireActual('../../../../../../__tests__/route-doubles/next-response');
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

const loggerCalls = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('@/lib/api/logger', () => ({
  apiLogger: {
    child: () => loggerCalls,
  },
}));

const mockGetLibraryRecordById = jest.fn();
const mockUpdateLibraryRecordAnnotations = jest.fn();
// The route classifies a write anomaly with the real error class, so the
// module's exports are kept and only its two functions are replaced.
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  ...jest.requireActual('@/lib/prisma/repositories/library-record.repository'),
  getLibraryRecordById: (...args: unknown[]) => mockGetLibraryRecordById(...args),
  updateLibraryRecordAnnotations: (...args: unknown[]) => mockUpdateLibraryRecordAnnotations(...args),
}));

// The delete use case, including its post-commit durable-copy cleanup, lives in
// the library module; `delete-library-record.test.ts` covers that behaviour and
// these tests cover only what the route decides on top of it.
const mockDeleteLibraryRecordAndCopy = jest.fn();
jest.mock('@/lib/library/delete-library-record', () => ({
  deleteLibraryRecordAndCopy: (...args: unknown[]) => mockDeleteLibraryRecordAndCopy(...args),
}));

const mockToCredentialRecordDetail = jest.fn();
const mockToCredentialRecord = jest.fn();
// The route classifies its failures with the real error classes, so only the
// projection function itself is replaced here.
jest.mock('@/lib/library/credential-record-projection', () => ({
  ...jest.requireActual('@/lib/library/credential-record-projection'),
  toCredentialRecordDetail: (...args: unknown[]) => mockToCredentialRecordDetail(...args),
  toCredentialRecord: (...args: unknown[]) => mockToCredentialRecord(...args),
}));

const mockRevealDecryptionKey = jest.fn();
jest.mock('@/lib/credentials/decryption-key-protection', () => ({
  revealDecryptionKey: (...args: unknown[]) => mockRevealDecryptionKey(...args),
}));

import {
  CheckResult,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsStatus,
  LibraryRecordOrigin,
} from '@/lib/prisma/generated';
import { PayloadTooLargeError } from '@/lib/api/errors';
import { CredentialRecordProjectionError, credentialRecordSchema } from '@/lib/library/credential-record-projection';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { LibraryRecordWriteAnomalyError } from '@/lib/prisma/repositories/library-record.repository';
import { GET, PATCH, DELETE } from './route';

function request(): Request {
  return {
    method: 'GET',
    url: 'http://localhost/api/v1/library/record-1',
    headers: new Headers(),
  } as unknown as Request;
}

function patchRequest(body: unknown, version: string | undefined): Request {
  const headers = new Headers();
  if (version !== undefined) headers.set('If-Version', version);
  return {
    method: 'PATCH',
    url: 'http://localhost/api/v1/library/record-1',
    headers,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Request;
}

const VIEW = {
  origin: LibraryRecordOrigin.EXTERNAL,
  record: { id: 'record-1' },
  external: { storageUri: 'https://storage.example/record-1', decryptionKey: 'stored-key' },
  checkRun: { generation: 1 },
};

const RESPONSE = {
  id: 'record-1',
  origin: 'external',
  hasKey: true,
  storageUri: 'https://storage.example/record-1',
  digestMultibase: 'zDigest',
  decryptionKey: 'plain-key',
  warnings: [],
};

/**
 * Custody values that cannot reach a projected body by coincidence, so the
 * absence assertions on the keyless case below cannot pass for the wrong
 * reason.
 */
const CUSTODY_SENTINELS = {
  storageUri: 'https://storage.example/URI-MUST-NOT-LEAK-9c21',
  decryptionKey: 'KEY-MUST-NOT-LEAK-9c21',
  storageDigestMultibase: 'zDIGESTMUSTNOTLEAK9c21',
};

/**
 * A complete external view, every column the real projection reads, for the
 * one case that runs `toCredentialRecord` for real. The stub `VIEW` above
 * carries only what the mocked projection needs, so the real one would refuse
 * it; the two are kept apart rather than merged.
 */
const COMPLETE_VIEW = {
  origin: LibraryRecordOrigin.EXTERNAL,
  record: {
    id: 'record-1',
    tenantId: 'tenant-1',
    origin: LibraryRecordOrigin.EXTERNAL,
    name: 'Extracted credential name',
    issuerName: 'Supplier',
    issuerDid: 'did:web:supplier.example',
    subjectName: 'Battery pack',
    subjectId: 'https://supplier.example/battery-pack',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    credentialType: 'DigitalProductPassport',
    coreCredentialType: CoreCredentialType.DPP,
    coreDataModelVersion: '0.6.0',
    detailsStatus: CredentialDetailsStatus.EXTRACTED,
    detailsError: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-04T00:00:00.000Z'),
  },
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
    displayName: 'Corrected label',
    declaredCredentialType: CoreCredentialType.DPP,
    dateReceived: new Date('2026-09-08T00:00:00.000Z'),
    notes: null,
    annotationVersion: 2,
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

/**
 * The unmocked projection, reached through the module's real exports rather
 * than by unmocking for the whole file: every other case depends on the stub
 * view, which the real projection would refuse.
 */
const { toCredentialRecord: realToCredentialRecord } = jest.requireActual<{
  toCredentialRecord: (view: unknown) => unknown;
}>('@/lib/library/credential-record-projection');

const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({ id: 'record-1' }) };

/**
 * The warn and error arguments rendered the way pino renders them: an Error is
 * replaced by its enumerable-looking fields and its cause chain is followed, so
 * a value that reached a message is visible to a `not.toContain` assertion.
 * `JSON.stringify` on the raw arguments cannot see any of that, because
 * `message`, `stack` and `cause` are all non-enumerable.
 */
function renderedLogArguments(): string {
  const render = (value: unknown): unknown => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack, cause: render(value.cause) };
    }
    if (Array.isArray(value)) return value.map(render);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, render(entry)]));
    }
    return value;
  };
  return JSON.stringify(
    render([...loggerCalls.info.mock.calls, ...loggerCalls.warn.mock.calls, ...loggerCalls.error.mock.calls]),
  );
}

async function get(
  context = AUTH_CONTEXT,
): Promise<{ status: number; headers: Headers; json: () => Promise<unknown> }> {
  return (await GET(request(), context)) as unknown as {
    status: number;
    headers: Headers;
    json: () => Promise<unknown>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLibraryRecordById.mockResolvedValue(VIEW);
  mockToCredentialRecordDetail.mockReturnValue(RESPONSE);
  mockToCredentialRecord.mockReturnValue(RESPONSE);
  mockUpdateLibraryRecordAnnotations.mockResolvedValue({ outcome: 'updated', view: VIEW });
  mockDeleteLibraryRecordAndCopy.mockResolvedValue({
    outcome: 'deleted',
    storage: {
      storageUri: 'https://storage.example/A',
      storageServiceInstanceId: 'storage-instance-A',
      storageExternalId: 'object-A',
      storageBucket: 'bucket-A',
    },
    cleanup: 'deleted',
  });
});

describe('GET /api/v1/library/:id', () => {
  it('reads the opaque id under the authenticated tenant and returns the detail response uncached', async () => {
    const response = (await GET(request(), AUTH_CONTEXT)) as unknown as {
      status: number;
      headers: Headers;
      json: () => Promise<unknown>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual(RESPONSE);
    expect(mockGetLibraryRecordById).toHaveBeenCalledWith('record-1', 'tenant-1');
    expect(mockToCredentialRecordDetail).toHaveBeenCalledWith(VIEW, {
      reveal: expect.any(Function),
      onKeyUnavailable: expect.any(Function),
    });
  });

  it('logs the lookup on entry and the retrieval on completion, with the custody state but no key', async () => {
    await get();

    expect(loggerCalls.info).toHaveBeenCalledTimes(2);
    expect(loggerCalls.info).toHaveBeenNthCalledWith(1, { recordId: 'record-1' }, 'Looking up library record');
    expect(loggerCalls.info).toHaveBeenCalledWith(
      { recordId: 'record-1', origin: 'external', hasKey: true, copyPresent: true },
      'Library record retrieved',
    );
    expect(JSON.stringify(loggerCalls.info.mock.calls)).not.toContain(RESPONSE.decryptionKey);
    expect(loggerCalls.error).not.toHaveBeenCalled();
  });

  it('reports no durable copy in the read log when the projection has none', async () => {
    mockToCredentialRecordDetail.mockReturnValue({
      ...RESPONSE,
      hasKey: false,
      storageUri: null,
      digestMultibase: null,
      decryptionKey: null,
    });

    await get();

    expect(loggerCalls.info).toHaveBeenCalledWith(
      { recordId: 'record-1', origin: 'external', hasKey: false, copyPresent: false },
      'Library record retrieved',
    );
  });

  it('passes an opaque id through without validation', async () => {
    const context = { tenantId: 'tenant-1', params: Promise.resolve({ id: 'opaque/id?with=characters' }) };

    await GET(request(), context);

    expect(mockGetLibraryRecordById).toHaveBeenCalledWith('opaque/id?with=characters', 'tenant-1');
  });

  it('answers an id carrying a NUL byte as not found without reading the database', async () => {
    const context = { tenantId: 'tenant-1', params: Promise.resolve({ id: 'cmtoxbm7f0015pg01fx4wkfc4\0' }) };
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
    expect(mockGetLibraryRecordById).not.toHaveBeenCalled();
  });

  it('returns the coded not-found body for both a repository miss and a tenant-scoped miss', async () => {
    mockGetLibraryRecordById.mockResolvedValue(null);

    const response = (await GET(request(), AUTH_CONTEXT)) as unknown as {
      status: number;
      json: () => Promise<unknown>;
    };

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
  });

  it('returns RECORD_UNREADABLE for a projection failure and logs only its safe classification', async () => {
    mockToCredentialRecordDetail.mockImplementation(() => {
      throw new CredentialRecordProjectionError('record-1', 'has an invalid stored state');
    });
    const response = await get();

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: expect.stringContaining('x-correlation-id response header'),
      code: 'RECORD_UNREADABLE',
      id: 'record-1',
    });
    expect(loggerCalls.error).toHaveBeenCalledTimes(1);
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'record-1',
        code: 'RECORD_UNREADABLE',
        readStage: 'projection',
        reason: 'projection',
        errorCode: 'library.record-projection',
        // The caller's body says only that the record could not be read, so
        // this is the operator's only account of which invariant broke. The
        // class builds its message from a record id and schema-constraint
        // text, so it can hold no stored value.
        error: {
          name: 'CredentialRecordProjectionError',
          message: 'Library record record-1 cannot be projected: has an invalid stored state',
        },
      }),
      'Library record read degraded',
    );
  });

  it('returns RECORD_UNREADABLE for an unclassified throw while building the record', async () => {
    // The same rule the collections apply to a row-local throw they cannot
    // classify: the record is what could not be built, so the caller gets the
    // coded body naming their own id, and the operator gets the cause.
    mockToCredentialRecordDetail.mockImplementation(() => {
      throw new RangeError('Invalid time value');
    });

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: expect.stringContaining('record id "record-1"'),
      code: 'RECORD_UNREADABLE',
      id: 'record-1',
    });
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'record-1',
        readStage: 'projection',
        reason: 'unclassified',
        error: { name: 'RangeError', message: 'Invalid time value' },
      }),
      'Library record read degraded',
    );
  });

  it('reports a key the projector could not return, with the cause that separates the repairs', async () => {
    mockToCredentialRecordDetail.mockImplementation((_view: unknown, options: unknown) => {
      (options as { onKeyUnavailable: (cause: unknown) => void }).onKeyUnavailable({
        reason: 'key-configuration',
        error: new Error('Missing required DATA_ENCRYPTION_KEY environment variable.'),
      });
      return {
        ...RESPONSE,
        decryptionKey: null,
        warnings: [{ code: 'DECRYPTION_KEY_UNAVAILABLE', message: 'The stored key could not be returned.' }],
      };
    });

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ hasKey: true, decryptionKey: null });
    expect(loggerCalls.error).toHaveBeenCalledTimes(1);
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'record-1',
        code: 'DECRYPTION_KEY_UNAVAILABLE',
        readStage: 'detail',
        reason: 'key-configuration',
        error: {
          name: 'Error',
          message: 'Missing required DATA_ENCRYPTION_KEY environment variable.',
        },
      }),
      'Library record read degraded',
    );
  });

  it('returns RECORD_UNREADABLE for a stored shape failure with the URL id', async () => {
    mockGetLibraryRecordById.mockRejectedValue(
      new LibraryRecordShapeError('record-1', 'is EXTERNAL but has no check run'),
    );

    const response = await get();

    expect(response.status).toBe(500);
    // This body names a record id belonging to the caller's tenant, so a
    // shared cache must not keep it, as with the 200.
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: expect.stringContaining('record id "record-1"'),
      code: 'RECORD_UNREADABLE',
      id: 'record-1',
    });
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'record-1', code: 'RECORD_UNREADABLE', readStage: 'hydration' }),
      'Library record read degraded',
    );
  });

  it('keeps an unexpected repository failure as a sanitised whole-request error', async () => {
    mockGetLibraryRecordById.mockRejectedValue(new Error('row contains a secret-key-value'));

    const response = await get();

    expect(response.status).toBe(500);
    // The sanitised body names nothing tenant-specific, so it does not take
    // the header the coded body needs.
    expect(response.headers.get('Cache-Control')).toBeNull();
    expect(await response.json()).toEqual({ error: 'An unexpected error has occurred.' });
    expect(loggerCalls.error).toHaveBeenCalledWith(
      { error: { name: expect.any(String), message: expect.any(String) }, recordId: 'record-1' },
      'Library record detail read failed',
    );
    expect(JSON.stringify(await response.json())).not.toContain('secret-key-value');
  });

  it('leaves a database fault to the shared mapper, which owns its distinct log', async () => {
    const databaseError = Object.assign(new Error('Timed out fetching a connection from the pool'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2024',
      clientVersion: '6.19.2',
    });
    mockGetLibraryRecordById.mockRejectedValue(databaseError);

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'An unexpected error has occurred.' });
    expect(loggerCalls.error).toHaveBeenCalledWith({ err: databaseError }, 'Unhandled database error');
    expect(loggerCalls.error).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/v1/library/:id', () => {
  it('forwards the tenant, strict version and converted annotation fields, returning the keyless projection', async () => {
    // The real projection over a view whose custody columns carry sentinels,
    // because the handler's own return value is what the contract promises to
    // keep them out of. With the projection mocked, appending a custody field
    // to the returned body passes every other case in this file.
    mockGetLibraryRecordById.mockResolvedValue(COMPLETE_VIEW);
    mockUpdateLibraryRecordAnnotations.mockResolvedValue({ outcome: 'updated', view: COMPLETE_VIEW });
    mockToCredentialRecord.mockImplementation(realToCredentialRecord);

    const response = await PATCH(
      patchRequest(
        {
          displayName: 'Corrected label',
          declaredCredentialType: 'DCC',
          dateReceived: '2026-09-08',
          notes: null,
        },
        '1',
      ),
      AUTH_CONTEXT,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(credentialRecordSchema.safeParse(body).success).toBe(true);
    expect((body as { hasKey: boolean }).hasKey).toBe(true);
    const rendered = JSON.stringify(body);
    for (const sentinel of Object.values(CUSTODY_SENTINELS)) {
      expect(rendered).not.toContain(sentinel);
    }
    expect(mockUpdateLibraryRecordAnnotations).toHaveBeenCalledWith({
      recordId: 'record-1',
      tenantId: 'tenant-1',
      expectedVersion: 1,
      changes: {
        displayName: 'Corrected label',
        declaredCredentialType: 'DCC',
        dateReceived: new Date('2026-09-08T00:00:00.000Z'),
        notes: null,
      },
    });
    expect(mockToCredentialRecord).toHaveBeenCalledWith(COMPLETE_VIEW);
    expect(JSON.stringify(loggerCalls.info.mock.calls)).not.toContain('Corrected label');
  });

  // The two nullable columns are the ones a converter can drop silently: an
  // explicit null is a request to clear the column, and an omitted field must
  // not reach the repository at all. A condition rejecting both `undefined`
  // and `null` passes every other case in this file.
  it('forwards an explicit null date as a clear and leaves an omitted date out of the changes', async () => {
    await PATCH(patchRequest({ dateReceived: null }, '1'), AUTH_CONTEXT);

    expect(mockUpdateLibraryRecordAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { dateReceived: null } }),
    );
    const [cleared] = mockUpdateLibraryRecordAnnotations.mock.calls[0] as [{ changes: Record<string, unknown> }];
    expect(cleared.changes.dateReceived).toBeNull();

    mockUpdateLibraryRecordAnnotations.mockClear();
    await PATCH(patchRequest({ notes: 'only notes' }, '1'), AUTH_CONTEXT);

    const [omitted] = mockUpdateLibraryRecordAnnotations.mock.calls[0] as [{ changes: Record<string, unknown> }];
    expect(Object.keys(omitted.changes)).toEqual(['notes']);
    expect('dateReceived' in omitted.changes).toBe(false);
  });

  it('does the tenant-scoped lookup before every later validation step', async () => {
    mockGetLibraryRecordById.mockResolvedValue(null);
    const missing = await PATCH(patchRequest('{not json', 'not-an-int'), AUTH_CONTEXT);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });

    mockGetLibraryRecordById.mockResolvedValue({
      ...VIEW,
      origin: LibraryRecordOrigin.NATIVE,
    });
    const nativeRequest = patchRequest({}, undefined) as unknown as { json: jest.Mock };
    const native = await PATCH(nativeRequest as unknown as Request, AUTH_CONTEXT);
    expect(native.status).toBe(403);
    expect(await native.json()).toEqual({
      error: 'This is a native credential record; it has no recipient annotations to update.',
      code: 'NATIVE_CREDENTIAL_NOT_ANNOTATABLE',
    });
    expect(nativeRequest.json).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, { notes: 'ok' }, 400, { error: 'If-Version header is required.', code: 'INVALID_IF_VERSION' }],
    [
      '1.0',
      { notes: 'ok' },
      400,
      { error: 'If-Version must be an integer between 1 and 2147483647.', code: 'INVALID_IF_VERSION' },
    ],
    [
      '2147483648',
      { notes: 'ok' },
      400,
      { error: 'If-Version must be an integer between 1 and 2147483647.', code: 'INVALID_IF_VERSION' },
    ],
    // Exponential and hexadecimal forms are the coercions a `Number(header)`
    // parser would silently accept; zero and a negative are inside the integer
    // grammar but outside the column's range.
    [
      '1e0',
      { notes: 'ok' },
      400,
      { error: 'If-Version must be an integer between 1 and 2147483647.', code: 'INVALID_IF_VERSION' },
    ],
    [
      '0',
      { notes: 'ok' },
      400,
      { error: 'If-Version must be an integer between 1 and 2147483647.', code: 'INVALID_IF_VERSION' },
    ],
    [
      '-1',
      { notes: 'ok' },
      400,
      { error: 'If-Version must be an integer between 1 and 2147483647.', code: 'INVALID_IF_VERSION' },
    ],
    [
      'abc',
      { notes: 'ok' },
      400,
      { error: 'If-Version must be an integer between 1 and 2147483647.', code: 'INVALID_IF_VERSION' },
    ],
    [
      '0x1',
      { notes: 'ok' },
      400,
      { error: 'If-Version must be an integer between 1 and 2147483647.', code: 'INVALID_IF_VERSION' },
    ],
    // Inside the digit grammar and far outside the column: a 400-digit string
    // overflows to Infinity, which a bare range check accepts.
    [
      '9'.repeat(400),
      { notes: 'ok' },
      400,
      { error: 'If-Version must be an integer between 1 and 2147483647.', code: 'INVALID_IF_VERSION' },
    ],
    // The one form that discriminates the safe-integer refinement from the
    // range check: Number rounds it to a different integer than the client
    // sent, so a parser without that refinement compares the wrong value.
    [
      '9007199254740993',
      { notes: 'ok' },
      400,
      { error: 'If-Version must be an integer between 1 and 2147483647.', code: 'INVALID_IF_VERSION' },
    ],
    [
      '1',
      {},
      400,
      {
        error: 'body: At least one of displayName, declaredCredentialType, dateReceived, or notes is required',
        code: 'VALIDATION_FAILED',
      },
    ],
    // Both inputs invalid: the header is validated first, so this row is the
    // only one that can tell header-before-body from body-before-header. With
    // the body parsed first it would answer VALIDATION_FAILED.
    ['abc', {}, 400, { error: 'If-Version must be an integer between 1 and 2147483647.', code: 'INVALID_IF_VERSION' }],
  ])(
    'names a missing/malformed version or empty body as a validation failure (%s)',
    async (version, body, status, expected) => {
      const response = await PATCH(patchRequest(body, version), AUTH_CONTEXT);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(expected);
      expect(mockUpdateLibraryRecordAnnotations).not.toHaveBeenCalled();
    },
  );

  // A leading `+` and leading zeroes are inside the shared integer grammar, so
  // they must reach the repository as the number they name; a parser that
  // rejected the sign, or that compared the raw header text against the stored
  // token, would answer 400 here. The padded form reaches the schema already
  // stripped, because the Headers implementation normalises surrounding
  // whitespace, so this row cannot fail on the schema's own trim.
  it.each([
    [' 01 ', 1],
    ['+2', 2],
  ])('accepts the shared integer grammar and forwards %s as %i', async (header, expectedVersion) => {
    const response = await PATCH(patchRequest({ notes: 'ok' }, header), AUTH_CONTEXT);

    expect(response.status).toBe(200);
    expect(mockUpdateLibraryRecordAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion, tenantId: 'tenant-1', recordId: 'record-1' }),
    );
  });

  it('maps stale and vanished-after-lock outcomes without projecting a different row', async () => {
    mockUpdateLibraryRecordAnnotations.mockResolvedValueOnce({ outcome: 'version_conflict', currentVersion: 2 });
    const stale = await PATCH(patchRequest({ notes: 'ignored' }, '1'), AUTH_CONTEXT);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'The supplied If-Version is stale.', code: 'VERSION_CONFLICT' });

    mockUpdateLibraryRecordAnnotations.mockResolvedValueOnce({ outcome: 'missing' });
    const missing = await PATCH(patchRequest({ notes: 'ignored' }, '1'), AUTH_CONTEXT);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
    expect(mockToCredentialRecord).not.toHaveBeenCalled();
  });

  it('passes an oversized body through as 413 after the target has passed the origin check', async () => {
    const req = patchRequest({}, '1') as unknown as { json: jest.Mock };
    req.json.mockRejectedValue(new PayloadTooLargeError('too large', 'REQUEST_BODY_TOO_LARGE'));

    const response = await PATCH(req as unknown as Request, AUTH_CONTEXT);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'too large', code: 'REQUEST_BODY_TOO_LARGE' });
  });

  it('keeps submitted values out of the validation log line and the 400 body, including a rejected enum value', async () => {
    const sentinel = 'sentinel-annotation-value';
    const response = await PATCH(
      patchRequest({ displayName: sentinel, declaredCredentialType: sentinel, notes: sentinel }, '1'),
      AUTH_CONTEXT,
    );

    expect(response.status).toBe(400);
    // An Error's own message, stack and cause are non-enumerable, so a bare
    // JSON.stringify of the log arguments renders `{}` and can never see a
    // leaked value. This walks what pino's `err` serialiser renders instead.
    expect(renderedLogArguments()).not.toContain(sentinel);
    // The body is the more direct leak, and the one an enum message reaches
    // first: zod's default native-enum message quotes the submitted value.
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
  });

  it.each([
    [
      'a projection failure after the update committed',
      () =>
        mockToCredentialRecord.mockImplementation(() => {
          throw new CredentialRecordProjectionError('record-1', 'has an invalid stored annotation row');
        }),
      'The library record annotation update could not be projected',
    ],
    [
      'a write anomaly that rolled the update back',
      () =>
        mockUpdateLibraryRecordAnnotations.mockRejectedValue(
          new LibraryRecordWriteAnomalyError('record-1', 'was not updated despite holding its parent lock'),
        ),
      'Library record annotation update failed and rolled back',
    ],
    [
      'a stored shape the pre-check read met before anything was attempted',
      () =>
        mockGetLibraryRecordById.mockRejectedValue(
          new LibraryRecordShapeError('record-1', 'is EXTERNAL but has no check run'),
        ),
      'The library record could not be read for an annotation update',
    ],
    [
      "a stored shape the write transaction's own pre-write read met",
      () =>
        mockUpdateLibraryRecordAnnotations.mockRejectedValue(
          new LibraryRecordShapeError('record-1', 'is EXTERNAL but has no check run'),
        ),
      'The library record could not be read for an annotation update',
    ],
    [
      'an unexpected repository failure',
      () => mockUpdateLibraryRecordAnnotations.mockRejectedValue(new Error('row contains a secret-key-value')),
      'Library record annotation update failed',
    ],
  ])('answers a sanitised 500 for %s and logs it once against the record', async (_name, arrange, message) => {
    arrange();

    const response = await PATCH(patchRequest({ notes: 'ok' }, '1'), AUTH_CONTEXT);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'An unexpected error has occurred.' });
    expect(JSON.stringify(await response.json())).not.toContain('secret-key-value');
    expect(JSON.stringify(await response.json())).not.toContain('invalid stored annotation row');
    expect(loggerCalls.error).toHaveBeenCalledTimes(1);
    // Name and message only. Logging the error object itself would render its
    // whole cause chain, which is the one place a stored value could reach a
    // log line from a path that never intended to publish one.
    expect(loggerCalls.error).toHaveBeenCalledWith(
      { error: { name: expect.any(String), message: expect.any(String) }, recordId: 'record-1' },
      message,
    );
  });

  it('answers the named refusal when the repository reports a native record it could not annotate', async () => {
    mockUpdateLibraryRecordAnnotations.mockResolvedValue({ outcome: 'native' });

    const response = await PATCH(patchRequest({ notes: 'ok' }, '1'), AUTH_CONTEXT);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'This is a native credential record; it has no recipient annotations to update.',
      code: 'NATIVE_CREDENTIAL_NOT_ANNOTATABLE',
    });
    expect(mockToCredentialRecord).not.toHaveBeenCalled();
  });

  it('names the record on a database fault before leaving it to the shared mapper', async () => {
    const databaseError = Object.assign(new Error('deadlock detected'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2034',
      clientVersion: '6.19.2',
    });
    mockUpdateLibraryRecordAnnotations.mockRejectedValue(databaseError);

    const response = await PATCH(patchRequest({ notes: 'ok' }, '1'), AUTH_CONTEXT);

    expect(response.status).toBe(500);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      { recordId: 'record-1' },
      'Library record annotation update hit a database error',
    );
    expect(loggerCalls.error).toHaveBeenCalledWith({ err: databaseError }, 'Unhandled database error');
  });
});

describe('DELETE /api/v1/library/:id', () => {
  const storageA = {
    storageUri: 'https://storage.example/A',
    storageServiceInstanceId: 'storage-instance-A',
    storageExternalId: 'object-A',
    storageBucket: 'bucket-A',
  };

  function deleteRequest(id = 'record-1'): Request & { json: jest.Mock; text: jest.Mock } {
    return {
      method: 'DELETE',
      url: `http://localhost/api/v1/library/${id}`,
      headers: new Headers({ 'If-Version': 'must-not-be-read' }),
      json: jest.fn().mockRejectedValue(new Error('DELETE must not read a body')),
      text: jest.fn().mockRejectedValue(new Error('DELETE must not read a body')),
    } as unknown as Request & { json: jest.Mock; text: jest.Mock };
  }

  function deleteContext(id = 'record-1') {
    return { tenantId: 'tenant-1', params: Promise.resolve({ id }) };
  }

  it.each([
    ['a just-deleted record', { outcome: 'deleted', storage: storageA, cleanup: 'deleted' }],
    [
      'a just-deleted record whose cleanup failed',
      { outcome: 'deleted', storage: storageA, cleanup: 'storage_delete_failed' },
    ],
    ['a missing record', { outcome: 'missing' }],
  ])('returns an empty 204 for %s', async (_name, result) => {
    mockDeleteLibraryRecordAndCopy.mockResolvedValue(result);

    const response = await DELETE(deleteRequest(), deleteContext());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(mockDeleteLibraryRecordAndCopy).toHaveBeenCalledWith({ recordId: 'record-1', tenantId: 'tenant-1' });
  });

  it('answers a NUL id as an empty 204 without touching the database or storage', async () => {
    const response = await DELETE(deleteRequest('record-%00'), deleteContext('record-1\0record-2'));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(mockDeleteLibraryRecordAndCopy).not.toHaveBeenCalled();
    expect(renderedLogArguments()).not.toContain('record-1\\u0000record-2');
  });

  it('returns the named native-record 403 without cleanup', async () => {
    mockDeleteLibraryRecordAndCopy.mockResolvedValue({ outcome: 'native' });

    const response = await DELETE(deleteRequest(), deleteContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'This is a native credential record; it cannot be removed from the library.',
      code: 'NATIVE_CREDENTIAL_NOT_DELETABLE',
    });
    expect(mockDeleteLibraryRecordAndCopy).toHaveBeenCalledWith({ recordId: 'record-1', tenantId: 'tenant-1' });
  });

  it.each([
    ['shape', new LibraryRecordShapeError('record-1', 'has a broken shape')],
    ['promotion', new Error('promotion failed')],
    ['unexpected', new Error('unexpected failed')],
  ])('returns a sanitised 500 for a %s failure before commit, with no audit line', async (_name, error) => {
    mockDeleteLibraryRecordAndCopy.mockRejectedValue(error);

    const response = await DELETE(deleteRequest(), deleteContext());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'An unexpected error has occurred.' });
    expect(loggerCalls.info.mock.calls.some((call) => call[1] === 'Library record deleted from database')).toBe(false);
  });

  it('sanitises database failures and logs the record', async () => {
    const databaseError = Object.assign(new Error('deadlock detected'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2034',
      clientVersion: '6.19.2',
    });
    mockDeleteLibraryRecordAndCopy.mockRejectedValue(databaseError);

    const response = await DELETE(deleteRequest(), deleteContext());

    expect(response.status).toBe(500);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      { recordId: 'record-1', tenantId: 'tenant-1' },
      'Library record delete hit a database error',
    );
    expect(loggerCalls.info.mock.calls.some((call) => call[1] === 'Library record deleted from database')).toBe(false);
  });

  it('does not read a DELETE body or If-Version header', async () => {
    const req = deleteRequest();
    const headerRead = jest.spyOn(req.headers, 'get');

    const response = await DELETE(req, deleteContext());

    expect(response.status).toBe(204);
    expect(req.json).not.toHaveBeenCalled();
    expect(req.text).not.toHaveBeenCalled();
    // The header is present on the request; a handler that parsed it would
    // answer 400 and would have read it.
    expect(headerRead.mock.calls.map(([name]) => String(name).toLowerCase())).not.toContain('if-version');
  });
});
