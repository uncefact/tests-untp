// Mock next/server before importing route handlers
jest.mock('next/server', () => {
  class MockNextResponse {
    status: number;
    body: unknown;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    async json() {
      return this.body;
    }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

// Mock logger to prevent real logging during tests
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
};
jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: jest.fn().mockReturnValue(mockLogger) },
}));

// Mock withTenantAuth — skips auth but preserves error handling via handleRouteError
jest.mock('@/lib/api/with-tenant-auth', () => {
  const { handleRouteError } = jest.requireActual('@/lib/api/handle-route-error');
  return {
    withTenantAuth:
      (handler: (...args: unknown[]) => unknown) =>
      async (...args: unknown[]) => {
        try {
          return await handler(...args);
        } catch (e) {
          return handleRouteError(e);
        }
      },
  };
});

const mockGetRenderTemplateById = jest.fn();
const mockDeleteRenderTemplate = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getRenderTemplateById: (id: string, tenantId: string) => mockGetRenderTemplateById(id, tenantId),
  deleteRenderTemplate: (id: string, tenantId: string) => mockDeleteRenderTemplate(id, tenantId),
}));

const mockUpdateRenderTemplate = jest.fn();
jest.mock('@/lib/render-templates/update-render-template', () => ({
  updateRenderTemplate: (...args: unknown[]) => mockUpdateRenderTemplate(...args),
}));

const mockResolveStorageService = jest.fn();
jest.mock('@/lib/services/resolve-storage-service', () => ({
  resolveStorageService: (...args: unknown[]) => mockResolveStorageService(...args),
}));

import { NotFoundError } from '@/lib/api/errors';
import { GET, PATCH, DELETE } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/render-templates/rt-1' } = options;
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
  return { tenantId: 'tenant-1', params: Promise.resolve({ id }) };
}

describe('GET /api/v1/render-templates/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the render template by id', async () => {
    const renderTemplate = {
      id: 'rt-1',
      name: 'DPP Default Template',
      storageUrl: 'https://storage.example.com/templates/dpp.html',
      digestMultibase: 'zTESTabc123',
      isDefault: true,
      dataModel: { id: 'dm-1', name: 'DPP v0.6.0' },
    };
    mockGetRenderTemplateById.mockResolvedValue(renderTemplate);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('rt-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(renderTemplate);
    expect(mockGetRenderTemplateById).toHaveBeenCalledWith('rt-1', 'tenant-1');
  });

  it('returns 404 when render template not found', async () => {
    mockGetRenderTemplateById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Render template not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetRenderTemplateById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await GET(req, createContext('rt-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('PATCH /api/v1/render-templates/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates metadata fields via orchestrator', async () => {
    const updated = {
      id: 'rt-1',
      name: 'Updated Template',
      storageUrl: 'https://storage.example.com/templates/dpp.html',
      digestMultibase: 'zTESTabc123',
      isDefault: false,
      dataModel: { id: 'dm-1', name: 'DPP v0.6.0' },
    };
    mockUpdateRenderTemplate.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Template' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(updated);
    expect(mockUpdateRenderTemplate).toHaveBeenCalledWith({
      id: 'rt-1',
      tenantId: 'tenant-1',
      name: 'Updated Template',
      template: undefined,
      storageService: undefined,
      isDefault: undefined,
      inline: undefined,
      mediaType: undefined,
      mediaQuery: undefined,
    });
    expect(mockResolveStorageService).not.toHaveBeenCalled();
  });

  it('re-uploads template when template field is provided', async () => {
    const mockStorageService = {
      service: { storeBinary: jest.fn(), delete: jest.fn() },
      instanceId: 'storage-instance-1',
    };
    mockResolveStorageService.mockResolvedValue(mockStorageService);

    const updated = {
      id: 'rt-1',
      name: 'DPP Template',
      storageUrl: 'https://storage.example.com/templates/new.html',
      digestMultibase: 'zTESTnew',
      isDefault: false,
      dataModel: { id: 'dm-1', name: 'DPP v0.6.0' },
    };
    mockUpdateRenderTemplate.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { template: '<div>new</div>' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(updated);
    expect(mockResolveStorageService).toHaveBeenCalledWith('tenant-1', undefined);
    expect(mockUpdateRenderTemplate).toHaveBeenCalledWith({
      id: 'rt-1',
      tenantId: 'tenant-1',
      name: undefined,
      template: '<div>new</div>',
      storageService: mockStorageService,
      isDefault: undefined,
      inline: undefined,
      mediaType: undefined,
      mediaQuery: undefined,
    });
  });

  it('passes storageOptions.serviceInstanceId when resolving storage service', async () => {
    const mockStorageService = {
      service: { storeBinary: jest.fn(), delete: jest.fn() },
      instanceId: 'si-1',
    };
    mockResolveStorageService.mockResolvedValue(mockStorageService);
    mockUpdateRenderTemplate.mockResolvedValue({ id: 'rt-1' });

    const req = createFakeRequest({
      method: 'PATCH',
      body: { template: '<div>updated</div>', storageOptions: { serviceInstanceId: 'si-1' } },
    });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockResolveStorageService).toHaveBeenCalledWith('tenant-1', 'si-1');
  });

  it('returns 400 when name is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name must be a non-empty string');
  });

  it('rejects storageUrl in body', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { storageUrl: 'https://evil.com' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('storageUrl cannot be set directly');
  });

  it('rejects digestMultibase in body', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { digestMultibase: 'zTESTabc123' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('digestMultibase cannot be set directly');
  });

  it('rejects renderMethodType in body', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { renderMethodType: 'WebRenderingTemplate2022' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('renderMethodType cannot be set directly');
  });

  it('returns 400 when no patchable field provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one updatable field must be provided');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      method: 'PATCH',
      url: 'http://localhost/api/v1/render-templates/rt-1',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Request;
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 404 when orchestrator throws NotFoundError', async () => {
    mockUpdateRenderTemplate.mockRejectedValue(new NotFoundError('Render template not found'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Render template not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateRenderTemplate.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('DELETE /api/v1/render-templates/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes template and attempts storage deletion', async () => {
    const mockStorageDelete = jest.fn().mockResolvedValue(undefined);
    mockResolveStorageService.mockResolvedValue({
      service: { delete: mockStorageDelete },
      instanceId: 'storage-instance-1',
    });
    mockDeleteRenderTemplate.mockResolvedValue({
      id: 'rt-1',
      storageExternalId: 'ext-1',
      storageBucket: 'public',
      storageServiceInstanceId: 'si-1',
    });

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('rt-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect(mockDeleteRenderTemplate).toHaveBeenCalledWith('rt-1', 'tenant-1');
    expect(mockResolveStorageService).toHaveBeenCalledWith('tenant-1', 'si-1');
    expect(mockStorageDelete).toHaveBeenCalledWith('ext-1', 'public');
  });

  it('skips storage deletion when storageExternalId is null', async () => {
    mockDeleteRenderTemplate.mockResolvedValue({
      id: 'rt-1',
      storageExternalId: null,
      storageBucket: null,
      storageServiceInstanceId: null,
    });

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('rt-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect(mockDeleteRenderTemplate).toHaveBeenCalledWith('rt-1', 'tenant-1');
    expect(mockResolveStorageService).not.toHaveBeenCalled();
  });

  it('returns 204 even when storage deletion fails', async () => {
    const mockStorageDelete = jest.fn().mockRejectedValue(new Error('Storage unavailable'));
    mockResolveStorageService.mockResolvedValue({
      service: { delete: mockStorageDelete },
      instanceId: 'storage-instance-1',
    });
    mockDeleteRenderTemplate.mockResolvedValue({
      id: 'rt-1',
      storageExternalId: 'ext-1',
      storageBucket: 'public',
      storageServiceInstanceId: 'si-1',
    });

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('rt-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect(mockStorageDelete).toHaveBeenCalledWith('ext-1', 'public');
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockDeleteRenderTemplate.mockRejectedValue(new NotFoundError('Render template not found'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Render template not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockDeleteRenderTemplate.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('rt-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
