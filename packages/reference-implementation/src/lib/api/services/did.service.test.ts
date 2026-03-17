import { listDids, getDid, createDid, updateDid, deleteDid, getDidDocument, verifyDid, ApiError } from './did.service';
import type { DidRecord, VerifyDidResponse } from './did.service';
import type { PaginatedResponse } from '@/lib/api/pagination';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockFetch = jest.fn() as jest.MockedFunction<typeof global.fetch>;
global.fetch = mockFetch;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function errorResponse(status: number, body: { error: string; code?: string }, statusText = 'Error'): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function nonJsonErrorResponse(status: number, statusText = 'Internal Server Error'): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
  } as unknown as Response;
}

const STUB_DID: DidRecord = {
  id: 'did-1',
  tenantId: 'tenant-1',
  did: 'did:web:example.com',
  type: 'MANAGED' as DidRecord['type'],
  method: 'DID_WEB' as DidRecord['method'],
  name: 'Test DID',
  description: null,
  keyId: 'key-1',
  status: 'ACTIVE' as DidRecord['status'],
  isDefault: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  serviceInstanceId: null,
};

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFetch.mockReset();
});

describe('listDids', () => {
  it('fetches with no params', async () => {
    const body: PaginatedResponse<DidRecord> = {
      data: [STUB_DID],
      pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await listDids();

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/dids');
    expect(result).toEqual(body);
  });

  it('serialises query params', async () => {
    const body: PaginatedResponse<DidRecord> = {
      data: [],
      pagination: { total: 0, limit: 10, offset: 5, hasMore: false },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await listDids({ type: 'MANAGED' as DidRecord['type'], limit: 10, offset: 5 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('type=MANAGED');
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=5');
  });

  it('omits undefined params from query string', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ data: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } }),
    );

    await listDids({ status: 'ACTIVE' as DidRecord['status'] });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('status=ACTIVE');
    expect(url).not.toContain('type=');
    expect(url).not.toContain('limit=');
  });

  it('throws ApiError on failure', async () => {
    mockFetch.mockResolvedValue(errorResponse(500, { error: 'Server error' }));

    await expect(listDids()).rejects.toThrow(ApiError);
    await expect(listDids()).rejects.toThrow('Server error');
  });
});

describe('getDid', () => {
  it('fetches a single DID by id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(STUB_DID));

    const result = await getDid('did-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/dids/did-1');
    expect(result).toEqual(STUB_DID);
  });

  it('throws ApiError with code when present', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, { error: 'Not found', code: 'NOT_FOUND' }));

    try {
      await getDid('missing');
      fail('Expected ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).code).toBe('NOT_FOUND');
      expect((err as ApiError).message).toBe('Not found');
    }
  });
});

describe('createDid', () => {
  it('posts input and returns created DID', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(STUB_DID, 201));

    const input = {
      type: 'MANAGED' as DidRecord['type'],
      method: 'DID_WEB' as DidRecord['method'],
      alias: 'example.com',
      name: 'Test DID',
    };
    const result = await createDid(input);

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/dids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(result).toEqual(STUB_DID);
  });

  it('throws ApiError on validation failure', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(422, { error: 'Invalid alias', code: 'VALIDATION_ERROR' }));

    await expect(
      createDid({
        type: 'MANAGED' as DidRecord['type'],
        method: 'DID_WEB' as DidRecord['method'],
        alias: '',
      }),
    ).rejects.toThrow(ApiError);
  });
});

describe('updateDid', () => {
  it('patches input and returns updated DID', async () => {
    const updated = { ...STUB_DID, name: 'Updated' };
    mockFetch.mockResolvedValueOnce(jsonResponse(updated));

    const input = { name: 'Updated' };
    const result = await updateDid('did-1', input);

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/dids/did-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(result).toEqual(updated);
  });

  it('throws ApiError on failure', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, { error: 'DID not found' }));

    await expect(updateDid('missing', { name: 'x' })).rejects.toThrow(ApiError);
  });
});

describe('deleteDid', () => {
  it('sends DELETE and returns void on 204', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      statusText: 'No Content',
    } as unknown as Response);

    const result = await deleteDid('did-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/dids/did-1', { method: 'DELETE' });
    expect(result).toBeUndefined();
  });

  it('throws ApiError on failure', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, { error: 'DID not found' }));

    await expect(deleteDid('missing')).rejects.toThrow(ApiError);
  });

  it('handles non-JSON error body', async () => {
    mockFetch.mockResolvedValueOnce(nonJsonErrorResponse(500));

    try {
      await deleteDid('did-1');
      fail('Expected ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).message).toBe('Internal Server Error');
    }
  });
});

describe('getDidDocument', () => {
  const mockDocument = {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: 'did:web:example.com',
    verificationMethod: [],
  };

  it('fetches DID document', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(mockDocument));

    const result = await getDidDocument('did-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/dids/did-1/document');
    expect(result).toEqual(mockDocument);
  });

  it('throws ApiError on failure', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, { error: 'DID not found' }));

    await expect(getDidDocument('missing')).rejects.toThrow(ApiError);
  });
});

describe('verifyDid', () => {
  const mockVerifyResponse: VerifyDidResponse = {
    verification: {
      verified: true,
      checks: [{ name: 'resolve' as never, passed: true }],
    },
    did: STUB_DID,
  };

  it('posts verify request and returns result', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(mockVerifyResponse));

    const result = await verifyDid('did-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/dids/did-1/verify', { method: 'POST' });
    expect(result).toEqual(mockVerifyResponse);
  });

  it('throws ApiError on failure', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, { error: 'Verification failed' }));

    await expect(verifyDid('did-1')).rejects.toThrow(ApiError);
  });
});
