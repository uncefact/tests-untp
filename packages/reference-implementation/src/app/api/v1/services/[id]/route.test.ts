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
  const { NotFoundError, ConflictError, errorMessage, ServiceRegistryError } = jest.requireActual('@/lib/api/errors');
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
          if (e instanceof ConflictError) {
            return jsonResponse({ error: (e as Error).message }, { status: 409 });
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

// ---------------------------------------------------------------------------
// Mock repositories
// ---------------------------------------------------------------------------

const mockGetServiceInstanceById = jest.fn();
const mockUpdateServiceInstance = jest.fn();
const mockDeleteServiceInstance = jest.fn();
const mockCountServiceInstanceReferences = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getServiceInstanceById: (id: string, tenantId: string) => mockGetServiceInstanceById(id, tenantId),
  updateServiceInstance: (id: string, tenantId: string, input: unknown) =>
    mockUpdateServiceInstance(id, tenantId, input),
  deleteServiceInstance: (id: string, tenantId: string) => mockDeleteServiceInstance(id, tenantId),
  countServiceInstanceReferences: (id: string) => mockCountServiceInstanceReferences(id),
}));

// ---------------------------------------------------------------------------
// Mock encryption service
// ---------------------------------------------------------------------------

const mockEncrypt = jest.fn();
const mockDecrypt = jest.fn();
const mockGetEncryptionService = jest.fn();

jest.mock('@/lib/encryption/encryption', () => ({
  getEncryptionService: () => mockGetEncryptionService(),
}));

// ---------------------------------------------------------------------------
// Mock maskInstanceConfig
// ---------------------------------------------------------------------------

const mockMaskInstanceConfig = jest.fn();

jest.mock('@uncefact/untp-ri-services', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services');
  return {
    ...actual,
    maskInstanceConfig: (...args: unknown[]) => mockMaskInstanceConfig(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Import route handlers AFTER all mocks
// ---------------------------------------------------------------------------

import { GET, PATCH, DELETE } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/services/svc-123' } = options;
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

function createContext(id: string) {
  return { tenantId: 'org-1', params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_INSTANCE = {
  id: 'svc-123',
  tenantId: 'org-1',
  serviceType: 'VC',
  adapterType: 'VCKIT',
  name: 'Test VC Service',
  description: null,
  config: JSON.stringify({ cipherText: 'abc', iv: '123', tag: '456', type: 'aes-256-gcm' }),
  isPrimary: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const MOCK_MASKED = {
  ...MOCK_INSTANCE,
  config: { baseUrl: 'https://example.com', apiKey: '***' },
};

// ---------------------------------------------------------------------------
// GET /api/v1/services/:id
// ---------------------------------------------------------------------------

describe('GET /api/v1/services/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retrieves a service instance successfully', async () => {
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockMaskInstanceConfig.mockReturnValue(MOCK_MASKED);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('svc-123') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(MOCK_MASKED);
    expect(mockGetServiceInstanceById).toHaveBeenCalledWith('svc-123', 'org-1');
    expect(mockMaskInstanceConfig).toHaveBeenCalledWith(MOCK_INSTANCE, mockGetEncryptionService(), expect.anything());
  });

  it('returns 404 when instance not found', async () => {
    mockGetServiceInstanceById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Service instance not found');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/services/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/services/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Allow private URLs by default so happy-path tests don't trigger real DNS resolution
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    // Default encryption service mock
    mockGetEncryptionService.mockReturnValue({ encrypt: mockEncrypt, decrypt: mockDecrypt });
  });

  it('updates name successfully', async () => {
    const updated = { ...MOCK_INSTANCE, name: 'New Name' };
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockUpdateServiceInstance.mockResolvedValue(updated);
    mockMaskInstanceConfig.mockReturnValue({ ...MOCK_MASKED, name: 'New Name' });

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'New Name' } });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.name).toBe('New Name');
    expect(mockUpdateServiceInstance).toHaveBeenCalledWith('svc-123', 'org-1', { name: 'New Name' });
  });

  it('updates description', async () => {
    const updated = { ...MOCK_INSTANCE, description: 'New desc' };
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockUpdateServiceInstance.mockResolvedValue(updated);
    mockMaskInstanceConfig.mockReturnValue({ ...MOCK_MASKED, description: 'New desc' });

    const req = createFakeRequest({ method: 'PATCH', body: { description: 'New desc' } });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.description).toBe('New desc');
    expect(mockUpdateServiceInstance).toHaveBeenCalledWith('svc-123', 'org-1', { description: 'New desc' });
  });

  it('updates config (merges with existing, validates against schema, encrypts)', async () => {
    const existingPlainConfig = { baseUrl: 'https://old.com', apiKey: 'old-key' };
    const newConfigPatch = { baseUrl: 'https://new.com' };
    const mergedConfig = { baseUrl: 'https://new.com', apiKey: 'old-key' };
    const encryptedEnvelope = { cipherText: 'new-cipher', iv: 'new-iv', tag: 'new-tag', type: 'aes-256-gcm' };

    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockDecrypt.mockReturnValue(JSON.stringify(existingPlainConfig));
    mockEncrypt.mockReturnValue(encryptedEnvelope);

    const updated = { ...MOCK_INSTANCE, config: JSON.stringify(encryptedEnvelope) };
    mockUpdateServiceInstance.mockResolvedValue(updated);
    mockMaskInstanceConfig.mockReturnValue({ ...MOCK_MASKED, config: { baseUrl: 'https://new.com', apiKey: '***' } });

    const req = createFakeRequest({ method: 'PATCH', body: { config: newConfigPatch } });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockDecrypt).toHaveBeenCalled();
    expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(mergedConfig), 'aes-256-gcm');
    expect(mockUpdateServiceInstance).toHaveBeenCalledWith('svc-123', 'org-1', {
      config: JSON.stringify(encryptedEnvelope),
    });
    expect(json.config.baseUrl).toBe('https://new.com');
  });

  it('updates isPrimary', async () => {
    const updated = { ...MOCK_INSTANCE, isPrimary: true };
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockUpdateServiceInstance.mockResolvedValue(updated);
    mockMaskInstanceConfig.mockReturnValue({ ...MOCK_MASKED, isPrimary: true });

    const req = createFakeRequest({ method: 'PATCH', body: { isPrimary: true } });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.isPrimary).toBe(true);
    expect(mockUpdateServiceInstance).toHaveBeenCalledWith('svc-123', 'org-1', { isPrimary: true });
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createFakeRequest({ method: 'PATCH' }); // no body → json() throws SyntaxError
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when body is empty (no fields provided)', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/at least one of/i);
  });

  it('returns 400 when name is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/name/);
  });

  it('returns 400 when config is not an object', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { config: 'not-an-object' } });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/config/);
  });

  it('returns 400 when config is an array', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { config: [1, 2, 3] } });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/config/);
  });

  it('returns 400 for a JSON null body', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: null });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('body');
    expect(mockUpdateServiceInstance).not.toHaveBeenCalled();
  });

  it('returns 400 when isPrimary is not a boolean', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { isPrimary: 'yes' } });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('isPrimary');
    expect(mockUpdateServiceInstance).not.toHaveBeenCalled();
  });

  it('returns 400 when config schema validation fails after merge', async () => {
    // Existing config has valid baseUrl + apiKey
    const existingPlainConfig = { baseUrl: 'https://old.com', apiKey: 'old-key' };
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockDecrypt.mockReturnValue(JSON.stringify(existingPlainConfig));

    // Patch with invalid baseUrl URL — merged config will fail schema validation
    const req = createFakeRequest({ method: 'PATCH', body: { config: { baseUrl: 'not-a-url' } } });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid configuration/i);
  });

  it('returns 404 when instance not found', async () => {
    mockGetServiceInstanceById.mockResolvedValue(null);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'New Name' } });
    const res = await PATCH(req, createContext('nonexistent') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Service instance not found');
  });

  it('returns 400 when existing config cannot be decrypted', async () => {
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockDecrypt.mockImplementation(() => {
      throw new Error('Decryption failed');
    });

    const req = createFakeRequest({ method: 'PATCH', body: { config: { baseUrl: 'https://new.com' } } });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/cannot update configuration/i);
  });

  it('returns 400 when merged config.baseUrl points to a private address', async () => {
    delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockDecrypt.mockReturnValue(JSON.stringify({ baseUrl: 'https://old.example.com', apiKey: 'key' }));

    const req = createFakeRequest({
      method: 'PATCH',
      body: { config: { baseUrl: 'http://127.0.0.1:3332' } },
    });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/config\.baseUrl.*private or reserved/);
  });

  it('skips SSRF validation on PATCH when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockDecrypt.mockReturnValue(JSON.stringify({ baseUrl: 'https://old.example.com', apiKey: 'key' }));
    mockUpdateServiceInstance.mockResolvedValue({ ...MOCK_INSTANCE, config: 'encrypted' });
    mockMaskInstanceConfig.mockReturnValue({ id: 'svc-123', config: {} });

    const req = createFakeRequest({
      method: 'PATCH',
      body: { config: { baseUrl: 'http://127.0.0.1:3332' } },
    });
    const res = await PATCH(req, createContext('svc-123') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/services/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/services/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes successfully when no references exist', async () => {
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockCountServiceInstanceReferences.mockResolvedValue({ dids: 0, registrars: 0, schemes: 0 });
    mockDeleteServiceInstance.mockResolvedValue(undefined);

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('svc-123') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect((res as unknown as { body: unknown }).body).toBeNull();
    expect(mockGetServiceInstanceById).toHaveBeenCalledWith('svc-123', 'org-1');
    expect(mockCountServiceInstanceReferences).toHaveBeenCalledWith('svc-123');
    expect(mockDeleteServiceInstance).toHaveBeenCalledWith('svc-123', 'org-1');
  });

  it('returns 409 when references exist and force is not set', async () => {
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockCountServiceInstanceReferences.mockResolvedValue({ dids: 2, registrars: 1, schemes: 0 });

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('svc-123') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/cannot delete/i);
    expect(json.error).toMatch(/2 DID\(s\)/);
    expect(json.error).toMatch(/1 registrar\(s\)/);
    expect(mockDeleteServiceInstance).not.toHaveBeenCalled();
  });

  it('deletes with force=true even when references exist', async () => {
    mockGetServiceInstanceById.mockResolvedValue(MOCK_INSTANCE);
    mockDeleteServiceInstance.mockResolvedValue(undefined);

    const req = createFakeRequest({
      method: 'DELETE',
      url: 'http://localhost/api/v1/services/svc-123?force=true',
    });
    const res = await DELETE(req, createContext('svc-123') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    // Should not check references when force=true
    expect(mockCountServiceInstanceReferences).not.toHaveBeenCalled();
    expect(mockDeleteServiceInstance).toHaveBeenCalledWith('svc-123', 'org-1');
  });

  it('returns 404 when instance not found', async () => {
    mockGetServiceInstanceById.mockResolvedValue(null);

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Service instance not found');
  });
});
