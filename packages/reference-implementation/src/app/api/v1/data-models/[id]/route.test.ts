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
  apiLogger: {
    child: jest.fn().mockReturnValue(mockLogger),
  },
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

const mockValidatePublicUrl = jest.fn();
jest.mock('@uncefact/untp-ri-services/server', () => ({
  validatePublicUrl: (...args: unknown[]) => mockValidatePublicUrl(...args),
}));

const mockGetDataModelById = jest.fn();
const mockUpdateDataModel = jest.fn();
const mockDeleteDataModel = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getDataModelById: (id: string, tenantId: string) => mockGetDataModelById(id, tenantId),
  updateDataModel: (id: string, tenantId: string, input: unknown) => mockUpdateDataModel(id, tenantId, input),
  deleteDataModel: (id: string, tenantId: string) => mockDeleteDataModel(id, tenantId),
}));

import { NotFoundError } from '@/lib/api/errors';
import { GET, PATCH, DELETE } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/data-models/dm-1' } = options;
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

describe('GET /api/v1/data-models/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the data model', async () => {
    const dataModel = {
      id: 'dm-1',
      name: 'DPP v0.6.0',
      credentialType: 'DigitalProductPassport',
    };
    mockGetDataModelById.mockResolvedValue(dataModel);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('dm-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(dataModel);
    expect(mockGetDataModelById).toHaveBeenCalledWith('dm-1', 'tenant-1');
  });

  it('returns 404 when data model not found', async () => {
    mockGetDataModelById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Data model not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetDataModelById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await GET(req, createContext('dm-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('PATCH /api/v1/data-models/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates the data model', async () => {
    const updated = {
      id: 'dm-1',
      name: 'Updated Extension',
      schemaUrl: 'https://example.com/schema.json',
    };
    mockUpdateDataModel.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Extension' } });
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(updated);
    expect(mockUpdateDataModel).toHaveBeenCalledWith('dm-1', 'tenant-1', {
      name: 'Updated Extension',
    });
  });

  it('passes only provided fields to the repository', async () => {
    mockUpdateDataModel.mockResolvedValue({ id: 'dm-1' });

    const req = createFakeRequest({
      method: 'PATCH',
      body: { schemaUrl: 'https://example.com/new-schema.json', websiteUrl: 'https://example.com' },
    });
    await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(mockUpdateDataModel).toHaveBeenCalledWith('dm-1', 'tenant-1', {
      schemaUrl: 'https://example.com/new-schema.json',
      websiteUrl: 'https://example.com',
    });
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one updatable field must be provided');
  });

  it('returns 400 when name is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name must be a non-empty string');
  });

  it('returns 400 when schemaUrl is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { schemaUrl: '' } });
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('schemaUrl must be a non-empty string');
  });

  it('returns 400 when contextUrl is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { contextUrl: '' } });
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('contextUrl must be a non-empty string');
  });

  it('returns 400 when websiteUrl is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { websiteUrl: '' } });
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('websiteUrl must be a non-empty string');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      method: 'PATCH',
      url: 'http://localhost/api/v1/data-models/dm-1',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Request;
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockUpdateDataModel.mockRejectedValue(new NotFoundError('Data model not found or access denied'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Data model not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateDataModel.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });

  it('returns 400 when schemaUrl points to a private address', async () => {
    mockValidatePublicUrl.mockRejectedValueOnce(
      new Error('uri must not point to a private or reserved network address'),
    );

    const req = createFakeRequest({ method: 'PATCH', body: { schemaUrl: 'http://127.0.0.1/schema.json' } });
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/schemaUrl.*private or reserved/);
  });

  it('returns 400 when schemaUrl is not a valid URL', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { schemaUrl: 'not-a-url' } });
    const res = await PATCH(req, createContext('dm-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/schemaUrl.*valid URL/);
  });
});

describe('DELETE /api/v1/data-models/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the data model and returns 204', async () => {
    mockDeleteDataModel.mockResolvedValue(undefined);

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('dm-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect(mockDeleteDataModel).toHaveBeenCalledWith('dm-1', 'tenant-1');
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockDeleteDataModel.mockRejectedValue(new NotFoundError('Data model not found or access denied'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Data model not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockDeleteDataModel.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('dm-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
