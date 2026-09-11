jest.mock('next/server', () => {
  const { MockNextResponse } = jest.requireActual('../../../../../../__tests__/route-doubles/next-response');
  return { NextResponse: MockNextResponse };
});

jest.mock('@/lib/api/with-tenant-auth', () => ({
  withTenantAuth: (handler: (req: unknown, context: unknown) => Promise<Response>) => handler,
}));

jest.mock('@/lib/api/logger');
const loggerCalls = jest.requireMock('@/lib/api/logger').apiLogger as Record<string, jest.Mock>;

import { GET } from './route';

function createFakeRequest(id: string): Request {
  return {
    method: 'GET',
    url: `http://localhost/api/v1/credentials/${id}`,
    headers: new Headers(),
  } as unknown as Request;
}

describe('GET /api/v1/credentials/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['cred-1', 'does-not-exist'])('returns the detail retirement body for %s', async (id) => {
    const response = await GET(createFakeRequest(id), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'This route has been retired. Use GET /api/v1/library/{id} instead.',
      code: 'ROUTE_RETIRED',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

const mockDeleteNativeCredentialAndCopy = jest.fn();
jest.mock('@/lib/credentials/delete-native-credential', () => ({
  deleteNativeCredentialAndCopy: (...args: unknown[]) => mockDeleteNativeCredentialAndCopy(...args),
}));

import { handleRouteError } from '@/lib/api/handle-route-error';
import { DELETE } from './route';

const storage = {
  storageUri: 'https://storage.example/A',
  storageServiceInstanceId: 'storage-instance-A',
  storageExternalId: 'object-A',
  storageBucket: 'bucket-A',
};

function deleteRequest(id = 'cred-1'): Request {
  return {
    method: 'DELETE',
    url: `http://localhost/api/v1/credentials/${id}`,
    headers: new Headers(),
    json: jest.fn().mockRejectedValue(new Error('DELETE must not read a body')),
  } as unknown as Request;
}

function deleteContext(id = 'cred-1') {
  return { tenantId: 'tenant-1', params: Promise.resolve({ id }) };
}

async function callDelete(id = 'cred-1'): Promise<Response> {
  try {
    return await DELETE(deleteRequest(id), deleteContext(id));
  } catch (error) {
    return handleRouteError(error);
  }
}

describe('DELETE /api/v1/credentials/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['a just-deleted credential', { outcome: 'deleted', storage, cleanup: 'deleted' }],
    [
      'a just-deleted credential whose copy could not be removed',
      { outcome: 'deleted', storage, cleanup: 'storage_delete_failed' },
    ],
    ['a missing credential', { outcome: 'missing' }],
  ])('returns an empty 204 for %s', async (_name, result) => {
    mockDeleteNativeCredentialAndCopy.mockResolvedValue(result);

    const response = await callDelete();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(mockDeleteNativeCredentialAndCopy).toHaveBeenCalledWith({ recordId: 'cred-1', tenantId: 'tenant-1' });
  });

  it('answers a NUL id as an empty 204 without touching the database', async () => {
    const response = await callDelete('cred-1\0cred-2');

    expect(response.status).toBe(204);
    expect(mockDeleteNativeCredentialAndCopy).not.toHaveBeenCalled();
  });

  it('refuses an external record with the named 403 and points at the library route', async () => {
    mockDeleteNativeCredentialAndCopy.mockResolvedValue({ outcome: 'external' });

    const response = await callDelete();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'This id is an external library record; delete it with DELETE /api/v1/library/{id}.',
      code: 'EXTERNAL_RECORD_NOT_DELETABLE_HERE',
    });
  });

  it('returns a sanitised 500 for a failure before commit', async () => {
    mockDeleteNativeCredentialAndCopy.mockRejectedValue(new Error('unexpected failed'));

    const response = await callDelete();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'An unexpected error has occurred.' });
  });

  it('leaves a database failure to the shared mapper and logs the record', async () => {
    const databaseError = Object.assign(new Error('deadlock detected'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2034',
      clientVersion: '6.19.2',
    });
    mockDeleteNativeCredentialAndCopy.mockRejectedValue(databaseError);

    let thrown: unknown;
    try {
      await DELETE(deleteRequest(), deleteContext());
    } catch (error) {
      thrown = error;
    }

    // The database error reaches the wrapper's shared mapper unchanged, and
    // the route names the record on the way past.
    expect(thrown).toBe(databaseError);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      { recordId: 'cred-1', tenantId: 'tenant-1' },
      'Credential delete hit a database error',
    );
    expect(loggerCalls.error).not.toHaveBeenCalled();
  });
});
