jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
}));

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
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  getLibraryRecordById: (...args: unknown[]) => mockGetLibraryRecordById(...args),
}));

const mockToCredentialRecordDetail = jest.fn();
// The route classifies its failures with the real error classes, so only the
// projection function itself is replaced here.
jest.mock('@/lib/library/credential-record-projection', () => ({
  ...jest.requireActual('@/lib/library/credential-record-projection'),
  toCredentialRecordDetail: (...args: unknown[]) => mockToCredentialRecordDetail(...args),
}));

const mockRevealDecryptionKey = jest.fn();
jest.mock('@/lib/credentials/decryption-key-protection', () => ({
  revealDecryptionKey: (...args: unknown[]) => mockRevealDecryptionKey(...args),
}));

import { LibraryRecordOrigin } from '@/lib/prisma/generated';
import { CredentialRecordProjectionError } from '@/lib/library/credential-record-projection';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { GET } from './route';

function request(): Request {
  return {
    method: 'GET',
    url: 'http://localhost/api/v1/library/record-1',
    headers: new Headers(),
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
};

const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({ id: 'record-1' }) };

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
    expect(mockToCredentialRecordDetail).toHaveBeenCalledWith(VIEW, { reveal: expect.any(Function) });
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

  it.each([
    [
      'a failed key reveal',
      () =>
        mockToCredentialRecordDetail.mockImplementation((_view: unknown, options: { reveal: (s: string) => string }) =>
          options.reveal('stored-envelope'),
        ),
      'The stored decryption key could not be revealed',
    ],
    [
      'a projection failure',
      () =>
        mockToCredentialRecordDetail.mockImplementation(() => {
          throw new CredentialRecordProjectionError('record-1', 'has an invalid stored decryption-key envelope');
        }),
      'The library record could not be projected',
    ],
    [
      'a stored shape the write paths never produce',
      () =>
        mockGetLibraryRecordById.mockRejectedValue(
          new LibraryRecordShapeError('record-1', 'is EXTERNAL but has no check run'),
        ),
      'The library record has a stored shape the write paths never produce',
    ],
    [
      'any other failure',
      () => mockGetLibraryRecordById.mockRejectedValue(new Error('row contains a secret-key-value')),
      'Library record detail read failed',
    ],
  ])('answers a sanitised 500 for %s and logs the error against the record', async (_name, arrange, message) => {
    mockRevealDecryptionKey.mockImplementation(() => {
      throw new Error('DATA_ENCRYPTION_KEY is missing');
    });
    arrange();

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'An unexpected error has occurred.' });
    expect(loggerCalls.error).toHaveBeenCalledTimes(1);
    expect(loggerCalls.error).toHaveBeenCalledWith({ err: expect.any(Error), recordId: 'record-1' }, message);
    expect(JSON.stringify(await response.json())).not.toContain('secret-key-value');
    expect(JSON.stringify(await response.json())).not.toContain('DATA_ENCRYPTION_KEY');
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
