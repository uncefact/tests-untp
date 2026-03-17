import type { Did } from '@/lib/prisma/generated';
import { DidType, DidMethod, DidStatus } from '@uncefact/untp-ri-services';
import { ApiError } from '@/lib/api/client';
import { listDids, getDid, createDid, updateDid, deleteDid, getDidDocument, verifyDid } from './did.service';

// ── Mock data ────────────────────────────────────────────────────────────────

const mockDid: Did = {
  id: 'clx1abc000001',
  tenantId: 'tenant-001',
  did: 'did:web:example.com:org:abc',
  type: 'MANAGED' as Did['type'],
  method: 'DID_WEB' as Did['method'],
  name: 'Test DID',
  description: 'A test DID for unit tests',
  keyId: 'key-001',
  status: 'VERIFIED' as Did['status'],
  isDefault: true,
  createdAt: new Date('2026-01-15T10:00:00Z'),
  updatedAt: new Date('2026-02-20T14:30:00Z'),
  serviceInstanceId: 'svc-inst-001',
};

const mockDid2: Did = {
  id: 'clx1abc000002',
  tenantId: 'tenant-001',
  did: 'did:web:example.com:org:def',
  type: 'SELF_MANAGED' as Did['type'],
  method: 'DID_WEB' as Did['method'],
  name: 'Secondary DID',
  description: null,
  keyId: 'key-002',
  status: 'UNVERIFIED' as Did['status'],
  isDefault: false,
  createdAt: new Date('2026-02-01T08:00:00Z'),
  updatedAt: new Date('2026-02-01T08:00:00Z'),
  serviceInstanceId: null,
};

const mockDidDocument = {
  '@context': ['https://www.w3.org/ns/did/v1'],
  id: 'did:web:example.com:org:abc',
  verificationMethod: [
    {
      id: 'did:web:example.com:org:abc#key-1',
      type: 'JsonWebKey2020',
      controller: 'did:web:example.com:org:abc',
    },
  ],
  authentication: ['did:web:example.com:org:abc#key-1'],
};

const mockVerifyResponse = {
  verification: {
    verified: true,
    document: mockDidDocument,
  },
  did: mockDid,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockFetchResponse(body: unknown, init?: { status?: number; statusText?: string; ok?: boolean }) {
  const status = init?.status ?? 200;
  const ok = init?.ok ?? (status >= 200 && status < 300);
  const statusText = init?.statusText ?? 'OK';

  return jest.fn().mockResolvedValue({
    ok,
    status,
    statusText,
    json: jest.fn().mockResolvedValue(body),
  });
}

function mockFetchNoContent() {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 204,
    statusText: 'No Content',
  });
}

function mockFetchErrorNonJson(status: number, statusText: string) {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
  });
}

async function expectApiError(
  fn: () => Promise<unknown>,
  expected: { message: string; status: number; code?: string },
) {
  try {
    await fn();
    fail('Expected function to throw an ApiError');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject(expected);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DID API Service', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ── listDids ─────────────────────────────────────────────────────────────

  describe('listDids', () => {
    const paginatedResponse = {
      data: [mockDid, mockDid2],
      pagination: { total: 2, limit: 10, offset: 0, hasMore: false },
    };

    it('should call the endpoint without query string when no params are provided', async () => {
      global.fetch = mockFetchResponse(paginatedResponse);

      const result = await listDids();

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids');
      expect(result).toEqual(paginatedResponse);
    });

    it('should include only provided params in the query string', async () => {
      global.fetch = mockFetchResponse(paginatedResponse);

      await listDids({ type: DidType.MANAGED, limit: 5 });

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toBe('/api/v1/dids?type=MANAGED&limit=5');
    });

    it('should include all params in the query string when all are provided', async () => {
      global.fetch = mockFetchResponse(paginatedResponse);

      await listDids({
        type: DidType.MANAGED,
        status: DidStatus.VERIFIED,
        serviceInstanceId: 'svc-inst-001',
        limit: 20,
        offset: 10,
      });

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toBe(
        '/api/v1/dids?type=MANAGED&status=VERIFIED&serviceInstanceId=svc-inst-001&limit=20&offset=10',
      );
    });

    it('should exclude undefined values from the query string', async () => {
      global.fetch = mockFetchResponse(paginatedResponse);

      await listDids({ type: undefined, status: DidStatus.UNVERIFIED, limit: undefined });

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toBe('/api/v1/dids?status=UNVERIFIED');
    });

    it('should throw ApiError when the response is not ok', async () => {
      global.fetch = mockFetchResponse(
        { error: 'Unauthorised', code: 'UNAUTHORISED' },
        { status: 401, statusText: 'Unauthorized', ok: false },
      );

      await expectApiError(() => listDids(), {
        message: 'Unauthorised',
        status: 401,
        code: 'UNAUTHORISED',
      });
    });
  });

  // ── getDid ───────────────────────────────────────────────────────────────

  describe('getDid', () => {
    it('should fetch a single DID by id', async () => {
      global.fetch = mockFetchResponse(mockDid);

      const result = await getDid('clx1abc000001');

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids/clx1abc000001');
      expect(result).toEqual(mockDid);
    });

    it('should throw ApiError with 404 when the DID is not found', async () => {
      global.fetch = mockFetchResponse({ error: 'DID not found' }, { status: 404, statusText: 'Not Found', ok: false });

      await expectApiError(() => getDid('nonexistent'), {
        message: 'DID not found',
        status: 404,
      });
    });
  });

  // ── createDid ────────────────────────────────────────────────────────────

  describe('createDid', () => {
    const createInput = {
      type: DidType.MANAGED as const,
      method: DidMethod.DID_WEB as const,
      alias: 'my-did',
      name: 'My New DID',
      description: 'Created in tests',
      isDefault: false,
      serviceInstanceId: 'svc-inst-001',
    };

    it('should send a POST request with the correct method, headers, and body', async () => {
      global.fetch = mockFetchResponse(mockDid, { status: 201 });

      const result = await createDid(createInput);

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createInput),
      });
      expect(result).toEqual(mockDid);
    });

    it('should throw ApiError on 409 conflict', async () => {
      global.fetch = mockFetchResponse(
        { error: 'DID already exists', code: 'CONFLICT' },
        { status: 409, statusText: 'Conflict', ok: false },
      );

      await expectApiError(() => createDid(createInput), {
        message: 'DID already exists',
        status: 409,
        code: 'CONFLICT',
      });
    });
  });

  // ── updateDid ────────────────────────────────────────────────────────────

  describe('updateDid', () => {
    const updateInput = {
      name: 'Updated DID Name',
      description: 'Updated description',
      isDefault: true,
    };

    it('should send a PATCH request with the correct method, headers, and body', async () => {
      const updatedDid = { ...mockDid, ...updateInput };
      global.fetch = mockFetchResponse(updatedDid);

      const result = await updateDid('clx1abc000001', updateInput);

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids/clx1abc000001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateInput),
      });
      expect(result).toEqual(updatedDid);
    });

    it('should throw ApiError when the response is not ok', async () => {
      global.fetch = mockFetchResponse(
        { error: 'Validation failed', code: 'VALIDATION_ERROR' },
        { status: 422, statusText: 'Unprocessable Entity', ok: false },
      );

      await expectApiError(() => updateDid('clx1abc000001', updateInput), {
        message: 'Validation failed',
        status: 422,
        code: 'VALIDATION_ERROR',
      });
    });
  });

  // ── deleteDid ────────────────────────────────────────────────────────────

  describe('deleteDid', () => {
    it('should send a DELETE request and return void without parsing JSON', async () => {
      global.fetch = mockFetchNoContent();

      const result = await deleteDid('clx1abc000001');

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids/clx1abc000001', { method: 'DELETE' });
      expect(result).toBeUndefined();
    });

    it('should throw ApiError when the response is not ok', async () => {
      global.fetch = mockFetchResponse(
        { error: 'Cannot delete default DID', code: 'DELETE_FORBIDDEN' },
        { status: 403, statusText: 'Forbidden', ok: false },
      );

      await expectApiError(() => deleteDid('clx1abc000001'), {
        message: 'Cannot delete default DID',
        status: 403,
        code: 'DELETE_FORBIDDEN',
      });
    });
  });

  // ── getDidDocument ───────────────────────────────────────────────────────

  describe('getDidDocument', () => {
    it('should fetch the DID document for a given id', async () => {
      global.fetch = mockFetchResponse(mockDidDocument);

      const result = await getDidDocument('clx1abc000001');

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids/clx1abc000001/document');
      expect(result).toEqual(mockDidDocument);
    });

    it('should throw ApiError when the response is not ok', async () => {
      global.fetch = mockFetchResponse(
        { error: 'Document resolution failed' },
        { status: 502, statusText: 'Bad Gateway', ok: false },
      );

      await expectApiError(() => getDidDocument('clx1abc000001'), {
        message: 'Document resolution failed',
        status: 502,
      });
    });
  });

  // ── verifyDid ────────────────────────────────────────────────────────────

  describe('verifyDid', () => {
    it('should send a POST request and return the verification result', async () => {
      global.fetch = mockFetchResponse(mockVerifyResponse);

      const result = await verifyDid('clx1abc000001');

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/dids/clx1abc000001/verify', { method: 'POST' });
      expect(result).toEqual(mockVerifyResponse);
    });

    it('should throw ApiError when the response is not ok', async () => {
      global.fetch = mockFetchResponse(
        { error: 'Verification service unavailable' },
        { status: 503, statusText: 'Service Unavailable', ok: false },
      );

      await expectApiError(() => verifyDid('clx1abc000001'), {
        message: 'Verification service unavailable',
        status: 503,
      });
    });
  });

  // ── ApiError ─────────────────────────────────────────────────────────────

  describe('ApiError', () => {
    it('should have the correct name, message, status, and code properties', () => {
      const err = new ApiError('Something went wrong', 500, 'INTERNAL');

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.name).toBe('ApiError');
      expect(err.message).toBe('Something went wrong');
      expect(err.status).toBe(500);
      expect(err.code).toBe('INTERNAL');
    });

    it('should allow code to be undefined', () => {
      const err = new ApiError('Not found', 404);

      expect(err.code).toBeUndefined();
    });

    it('should include the error code from the response body when present', async () => {
      global.fetch = mockFetchResponse(
        { error: 'Resource locked', code: 'RESOURCE_LOCKED' },
        { status: 423, statusText: 'Locked', ok: false },
      );

      await expectApiError(() => getDid('locked-id'), {
        message: 'Resource locked',
        status: 423,
        code: 'RESOURCE_LOCKED',
      });
    });

    it('should fall back to statusText when the error response body is not valid JSON', async () => {
      global.fetch = mockFetchErrorNonJson(500, 'Internal Server Error');

      await expectApiError(() => getDid('bad-response'), {
        message: 'Internal Server Error',
        status: 500,
        code: undefined,
      });
    });

    it('should fall back to statusText for non-JSON error on deleteDid', async () => {
      global.fetch = mockFetchErrorNonJson(500, 'Internal Server Error');

      await expectApiError(() => deleteDid('bad-response'), {
        message: 'Internal Server Error',
        status: 500,
        code: undefined,
      });
    });
  });
});
