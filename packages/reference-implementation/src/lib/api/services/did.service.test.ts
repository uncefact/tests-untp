import { listDids, getDid, createDid, updateDid, deleteDid, getDidDocument, verifyDid, ApiError } from './did.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(status: number, body?: unknown, statusText = 'Error') {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: body !== undefined ? jest.fn().mockResolvedValue(body) : jest.fn().mockRejectedValue(new Error('no body')),
  } as unknown as Response;
  (global.fetch as jest.Mock).mockResolvedValue(response);
  return response;
}

const fakeDid = {
  id: 'did-1',
  tenantId: 'tenant-1',
  did: 'did:web:example.com',
  type: 'MANAGED',
  method: 'DID_WEB',
  keyId: 'key-1',
  name: 'Test DID',
  description: null,
  status: 'ACTIVE',
  isDefault: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  serviceInstanceId: 'si-1',
};

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  global.fetch = jest.fn();
  // jsdom provides window.location.origin
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── listDids ─────────────────────────────────────────────────────────────────

describe('listDids', () => {
  const paginatedResponse = {
    data: [fakeDid],
    pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
  };

  it('fetches DIDs without params', async () => {
    mockFetch(200, paginatedResponse);

    const result = await listDids();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v1/dids');
    expect(new URL(calledUrl).searchParams.toString()).toBe('');
    expect(result).toEqual(paginatedResponse);
  });

  it('serialises all query params', async () => {
    mockFetch(200, paginatedResponse);

    await listDids({
      type: 'MANAGED' as never,
      status: 'ACTIVE' as never,
      serviceInstanceId: 'si-1',
      limit: 10,
      offset: 5,
    });

    const calledUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('type')).toBe('MANAGED');
    expect(calledUrl.searchParams.get('status')).toBe('ACTIVE');
    expect(calledUrl.searchParams.get('serviceInstanceId')).toBe('si-1');
    expect(calledUrl.searchParams.get('limit')).toBe('10');
    expect(calledUrl.searchParams.get('offset')).toBe('5');
  });

  it('serialises partial params (omits undefined)', async () => {
    mockFetch(200, paginatedResponse);

    await listDids({ type: 'MANAGED' as never });

    const calledUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('type')).toBe('MANAGED');
    expect(calledUrl.searchParams.has('status')).toBe(false);
    expect(calledUrl.searchParams.has('serviceInstanceId')).toBe(false);
    expect(calledUrl.searchParams.has('limit')).toBe(false);
    expect(calledUrl.searchParams.has('offset')).toBe(false);
  });

  it('throws ApiError on error response', async () => {
    mockFetch(500, { error: 'Internal failure' });

    await expect(listDids()).rejects.toThrow(ApiError);
    await expect(listDids()).rejects.toMatchObject({ status: 500, message: 'Internal failure' });
  });
});

// ── getDid ───────────────────────────────────────────────────────────────────

describe('getDid', () => {
  it('fetches a DID by id', async () => {
    mockFetch(200, fakeDid);

    const result = await getDid('did-1');

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids/did-1');
    expect(result).toEqual(fakeDid);
  });

  it('throws ApiError on 404', async () => {
    mockFetch(404, { error: 'DID not found' });

    await expect(getDid('missing')).rejects.toThrow(ApiError);
    await expect(getDid('missing')).rejects.toMatchObject({ status: 404, message: 'DID not found' });
  });
});

// ── createDid ────────────────────────────────────────────────────────────────

describe('createDid', () => {
  const input = {
    type: 'MANAGED' as never,
    method: 'DID_WEB' as never,
    alias: 'example.com',
    name: 'My DID',
  };

  it('posts input and returns created DID', async () => {
    mockFetch(201, fakeDid);

    const result = await createDid(input);

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(result).toEqual(fakeDid);
  });

  it('throws ApiError with code on 409 conflict', async () => {
    mockFetch(409, { error: 'DID already exists', code: 'CONFLICT' });

    await expect(createDid(input)).rejects.toThrow(ApiError);
    await expect(createDid(input)).rejects.toMatchObject({
      status: 409,
      message: 'DID already exists',
      code: 'CONFLICT',
    });
  });

  it('throws ApiError on 400 validation error', async () => {
    mockFetch(400, { error: 'type is required' });

    await expect(createDid(input)).rejects.toMatchObject({ status: 400, message: 'type is required' });
  });
});

// ── updateDid ────────────────────────────────────────────────────────────────

describe('updateDid', () => {
  const input = { name: 'Updated', isDefault: true };

  it('patches and returns updated DID', async () => {
    const updated = { ...fakeDid, name: 'Updated', isDefault: true };
    mockFetch(200, updated);

    const result = await updateDid('did-1', input);

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids/did-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(result).toEqual(updated);
  });

  it('throws ApiError on 404', async () => {
    mockFetch(404, { error: 'DID not found' });

    await expect(updateDid('missing', input)).rejects.toMatchObject({ status: 404 });
  });
});

// ── deleteDid ────────────────────────────────────────────────────────────────

describe('deleteDid', () => {
  it('sends DELETE and returns void on 204', async () => {
    mockFetch(204);

    const result = await deleteDid('did-1');

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids/did-1', { method: 'DELETE' });
    expect(result).toBeUndefined();
  });

  it('throws ApiError on 404', async () => {
    mockFetch(404, { error: 'DID not found' });

    await expect(deleteDid('missing')).rejects.toThrow(ApiError);
    await expect(deleteDid('missing')).rejects.toMatchObject({ status: 404, message: 'DID not found' });
  });

  it('throws ApiError with statusText when error body is not JSON', async () => {
    mockFetch(500, undefined, 'Internal Server Error');

    await expect(deleteDid('did-1')).rejects.toMatchObject({
      status: 500,
      message: 'Internal Server Error',
    });
  });
});

// ── getDidDocument ───────────────────────────────────────────────────────────

describe('getDidDocument', () => {
  const fakeDocument = {
    id: 'did:web:example.com',
    '@context': ['https://www.w3.org/ns/did/v1'],
    verificationMethod: [],
  };

  it('fetches DID document', async () => {
    mockFetch(200, fakeDocument);

    const result = await getDidDocument('did-1');

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids/did-1/document');
    expect(result).toEqual(fakeDocument);
  });

  it('throws ApiError on 404', async () => {
    mockFetch(404, { error: 'DID not found' });

    await expect(getDidDocument('missing')).rejects.toMatchObject({ status: 404 });
  });
});

// ── verifyDid ────────────────────────────────────────────────────────────────

describe('verifyDid', () => {
  const fakeVerifyResponse = {
    verification: {
      verified: true,
      checks: [{ name: 'resolve', passed: true }],
    },
    did: { ...fakeDid, status: 'VERIFIED' },
  };

  it('posts verify and returns result', async () => {
    mockFetch(200, fakeVerifyResponse);

    const result = await verifyDid('did-1');

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids/did-1/verify', { method: 'POST' });
    expect(result).toEqual(fakeVerifyResponse);
  });

  it('throws ApiError on 404', async () => {
    mockFetch(404, { error: 'DID not found' });

    await expect(verifyDid('missing')).rejects.toMatchObject({ status: 404 });
  });
});

// ── handleResponse edge cases ────────────────────────────────────────────────

describe('error handling edge cases', () => {
  it('uses statusText when error body is not JSON', async () => {
    mockFetch(502, undefined, 'Bad Gateway');

    await expect(getDid('x')).rejects.toMatchObject({
      status: 502,
      message: 'Bad Gateway',
      code: undefined,
    });
  });

  it('includes code when present in error response', async () => {
    mockFetch(422, { error: 'Invalid input', code: 'VALIDATION_ERROR' });

    await expect(getDid('x')).rejects.toMatchObject({
      status: 422,
      message: 'Invalid input',
      code: 'VALIDATION_ERROR',
    });
  });
});
