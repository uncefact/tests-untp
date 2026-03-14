// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withTenantAuth to mirror handleRouteError behaviour
jest.mock('@/lib/api/with-tenant-auth', () => {
  const { NotFoundError, errorMessage, ServiceRegistryError } = jest.requireActual('@/lib/api/errors');
  const { ValidationError } = jest.requireActual('@/lib/api/validation');
  const { ServiceError } = jest.requireActual('@uncefact/untp-ri-services');

  function jsonResponse(body: unknown, init?: { status?: number }) {
    return { status: init?.status ?? 200, json: async () => body };
  }

  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (e: unknown) {
          if (e instanceof ValidationError) {
            return jsonResponse({ error: (e as Error).message }, { status: 400 });
          }
          if (e instanceof NotFoundError) {
            return jsonResponse({ error: (e as Error).message }, { status: 404 });
          }
          if (e instanceof ServiceRegistryError) {
            return jsonResponse({ error: (e as Error).message }, { status: 500 });
          }
          if (e instanceof ServiceError) {
            const serviceErr = e as Error & { code?: string; statusCode?: number };
            return jsonResponse(
              { error: serviceErr.message, code: serviceErr.code },
              { status: serviceErr.statusCode },
            );
          }
          return jsonResponse({ error: errorMessage(e) }, { status: 500 });
        }
      },
  };
});

const mockCreateServiceInstance = jest.fn();
const mockListServiceInstances = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createServiceInstance: (input: unknown) => mockCreateServiceInstance(input),
  listServiceInstances: (tenantId: string, opts: unknown) => mockListServiceInstances(tenantId, opts),
}));

const mockEncrypt = jest.fn();
const mockGetEncryptionService = jest.fn();

jest.mock('@/lib/encryption/encryption', () => ({
  getEncryptionService: () => mockGetEncryptionService(),
}));

const mockMaskInstanceConfig = jest.fn();

jest.mock('@uncefact/untp-ri-services', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services');
  return {
    ...actual,
    maskInstanceConfig: (...args: unknown[]) => mockMaskInstanceConfig(...args),
  };
});

jest.mock('@/lib/api/logger', () => ({
  apiLogger: {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    }),
  },
}));

import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import { POST, GET } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/services' } = options;
  const bodyString = body !== undefined ? JSON.stringify(body) : undefined;
  return {
    method,
    url,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json:
      bodyString !== undefined
        ? async () => JSON.parse(bodyString)
        : async () => {
            throw new SyntaxError('Unexpected token');
          },
  } as unknown as Request;
}

function createBadJsonRequest(): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/services',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_RECORD = {
  id: 'svc-123',
  tenantId: 'org-1',
  serviceType: 'VC',
  adapterType: 'VCKIT',
  name: 'Test VC Service',
  description: null,
  config: '{"encrypted":"blob"}',
  isPrimary: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const MOCK_MASKED = {
  ...MOCK_RECORD,
  config: { baseUrl: 'https://example.com', apiKey: '***' },
};

const VALID_CONFIG = {
  baseUrl: 'https://vckit.example.com',
  apiKey: 'test-api-key',
};

const VALID_BODY = {
  serviceType: 'VC',
  adapterType: 'VCKIT',
  name: 'Test VC Service',
  config: VALID_CONFIG,
};

// ---------------------------------------------------------------------------
// POST /api/v1/services
// ---------------------------------------------------------------------------

describe('POST /api/v1/services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateServiceInstance.mockResolvedValue(MOCK_RECORD);
    mockMaskInstanceConfig.mockReturnValue(MOCK_MASKED);
    mockGetEncryptionService.mockReturnValue({
      encrypt: mockEncrypt.mockReturnValue({ cipher: 'abc', iv: '123', tag: '456' }),
    });
  });

  it('creates a service instance successfully and returns 201', async () => {
    const req = createFakeRequest({ body: VALID_BODY });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(MOCK_MASKED);
    expect(mockCreateServiceInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'Test VC Service',
      }),
    );
    expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(VALID_CONFIG), 'aes-256-gcm');
    expect(mockMaskInstanceConfig).toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when serviceType is missing', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, serviceType: undefined },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('serviceType is required');
  });

  it('returns 400 when adapterType is missing', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, adapterType: undefined },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('adapterType is required');
  });

  it('returns 400 when name is missing', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, name: undefined },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('name is required');
  });

  it('returns 400 when name is an empty string', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, name: '' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('name is required');
  });

  it('returns 400 when config is missing', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, config: undefined },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('config must be an object');
  });

  it('returns 400 when config is not an object', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, config: 'not-an-object' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('config must be an object');
  });

  it('returns 400 when config is an array', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, config: [1, 2, 3] },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('config must be an object');
  });

  it('returns 400 for invalid serviceType enum value', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, serviceType: 'INVALID' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('serviceType must be one of');
  });

  it('returns 400 for invalid adapterType enum value', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, adapterType: 'INVALID' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('adapterType must be one of');
  });

  it('returns 400 when adapter type does not match service type (registry lookup fails)', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, serviceType: 'VC', adapterType: 'PYX_IDR' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Unknown adapter type 'PYX_IDR' for service type 'VC'");
  });

  it('returns 400 for config schema validation failure', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, config: { baseUrl: 'not-a-url' } },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid config');
  });

  it('passes description and isPrimary to createServiceInstance when provided', async () => {
    const req = createFakeRequest({
      body: { ...VALID_BODY, description: 'My description', isPrimary: true },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateServiceInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'My description',
        isPrimary: true,
      }),
    );
  });

  it('encrypts the config before persisting', async () => {
    const req = createFakeRequest({ body: VALID_BODY });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(VALID_CONFIG), 'aes-256-gcm');
    expect(mockCreateServiceInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        config: JSON.stringify({ cipher: 'abc', iv: '123', tag: '456' }),
      }),
    );
  });

  it('returns 400 when config.baseUrl points to a private address', async () => {
    delete process.env.VERIFY_ALLOW_PRIVATE_URLS;

    const req = createFakeRequest({
      body: { ...VALID_BODY, config: { ...VALID_BODY.config, baseUrl: 'http://127.0.0.1:3332' } },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/config\.baseUrl.*private or reserved/);
  });

  it('skips SSRF validation when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';

    const req = createFakeRequest({
      body: { ...VALID_BODY, config: { ...VALID_BODY.config, baseUrl: 'http://127.0.0.1:3332' } },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
  });

  it('returns 500 when createServiceInstance throws', async () => {
    mockCreateServiceInstance.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ body: VALID_BODY });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Database error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/services
// ---------------------------------------------------------------------------

describe('GET /api/v1/services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListServiceInstances.mockResolvedValue({ data: [MOCK_RECORD], total: 1 });
    mockMaskInstanceConfig.mockReturnValue(MOCK_MASKED);
    mockGetEncryptionService.mockReturnValue({ encrypt: mockEncrypt });
  });

  it('lists service instances with pagination', async () => {
    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/services' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([MOCK_MASKED]);
    expect(json.pagination).toEqual({
      total: 1,
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
      hasMore: false,
    });
  });

  it('masks each service instance config in the response', async () => {
    const secondRecord = { ...MOCK_RECORD, id: 'svc-456', name: 'Second Service' };
    const secondMasked = { ...secondRecord, config: { baseUrl: 'https://other.com', apiKey: '***' } };
    mockListServiceInstances.mockResolvedValue({ data: [MOCK_RECORD, secondRecord], total: 2 });
    mockMaskInstanceConfig.mockReturnValueOnce(MOCK_MASKED).mockReturnValueOnce(secondMasked);

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/services' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(mockMaskInstanceConfig).toHaveBeenCalledTimes(2);
    expect(json.data).toEqual([MOCK_MASKED, secondMasked]);
  });

  it('passes filters to the repository', async () => {
    mockListServiceInstances.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/services?serviceType=VC&adapterType=VCKIT&limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListServiceInstances).toHaveBeenCalledWith('org-1', {
      serviceType: 'VC',
      adapterType: 'VCKIT',
      limit: 10,
      offset: 5,
    });
  });

  it('handles no query parameters', async () => {
    mockListServiceInstances.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/services' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListServiceInstances).toHaveBeenCalledWith('org-1', {
      serviceType: undefined,
      adapterType: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns hasMore: true when more results exist', async () => {
    const records = [
      { ...MOCK_RECORD, id: 'svc-1' },
      { ...MOCK_RECORD, id: 'svc-2' },
    ];
    mockListServiceInstances.mockResolvedValue({ data: records, total: 5 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/services?limit=2&offset=0',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(json.pagination).toEqual({
      total: 5,
      limit: 2,
      offset: 0,
      hasMore: true,
    });
  });

  it('returns 400 for invalid serviceType filter', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/services?serviceType=GARBAGE',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('serviceType must be one of');
  });

  it('returns 400 for invalid adapterType filter', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/services?adapterType=GARBAGE',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('adapterType must be one of');
  });

  it('returns 400 for invalid limit (non-numeric)', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/services?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for zero limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/services?limit=0',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/services?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('offset must be a non-negative integer');
  });

  it('returns 500 when listServiceInstances throws', async () => {
    mockListServiceInstances.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/services' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Database error');
  });
});
