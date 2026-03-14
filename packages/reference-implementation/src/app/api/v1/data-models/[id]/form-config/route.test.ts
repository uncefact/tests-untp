// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

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

const mockGetDataModelById = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getDataModelById: (id: string, tenantId: string) => mockGetDataModelById(id, tenantId),
}));

import { GET } from './route';

function createFakeRequest(): Request {
  return {
    method: 'GET',
    url: 'http://localhost/api/v1/data-models/dm-1/form-config',
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Request;
}

function createContext(id: string) {
  return { tenantId: 'tenant-1', params: Promise.resolve({ id }) };
}

describe('GET /api/v1/data-models/:id/form-config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns form config with correct sections for DigitalProductPassport', async () => {
    const dataModel = {
      id: 'dm-1',
      name: 'DPP v0.6.0',
      credentialType: 'DigitalProductPassport',
      version: '0.6.0',
      schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/',
    };
    mockGetDataModelById.mockResolvedValue(dataModel);

    const req = createFakeRequest();
    const res = await GET(req, createContext('dm-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.formConfig).toEqual({
      dataModelId: 'dm-1',
      credentialType: 'DigitalProductPassport',
      version: '0.6.0',
      schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/',
      sections: [
        { entityType: 'organisation', label: 'Organisation', endpoint: '/api/v1/organisations', required: true },
        { entityType: 'facility', label: 'Facility', endpoint: '/api/v1/facilities', required: true },
        { entityType: 'product', label: 'Product', endpoint: '/api/v1/products', required: true },
        {
          entityType: 'conformityScheme',
          label: 'Conformity Scheme',
          endpoint: '/api/v1/cvc/schemes',
          required: false,
        },
        {
          entityType: 'conformityProfile',
          label: 'Conformity Profile',
          endpoint: '/api/v1/cvc/profiles?schemeId=:conformityScheme',
          required: false,
          dependsOn: 'conformityScheme',
        },
      ],
    });
    expect(mockGetDataModelById).toHaveBeenCalledWith('dm-1', 'tenant-1');
  });

  it('returns form config with correct sections for DigitalConformityCredential', async () => {
    const dataModel = {
      id: 'dm-2',
      name: 'DCC v0.6.0',
      credentialType: 'DigitalConformityCredential',
      version: '0.6.0',
      schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dcc/0.6.0/',
    };
    mockGetDataModelById.mockResolvedValue(dataModel);

    const req = createFakeRequest();
    const res = await GET(req, createContext('dm-2') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.formConfig.sections).toHaveLength(3);
    expect(json.formConfig.sections).toEqual([
      { entityType: 'organisation', label: 'Organisation', endpoint: '/api/v1/organisations', required: true },
      { entityType: 'conformityScheme', label: 'Conformity Scheme', endpoint: '/api/v1/cvc/schemes', required: false },
      {
        entityType: 'conformityProfile',
        label: 'Conformity Profile',
        endpoint: '/api/v1/cvc/profiles?schemeId=:conformityScheme',
        required: false,
        dependsOn: 'conformityScheme',
      },
    ]);
  });

  it('returns form config with correct sections for DigitalFacilityRecord', async () => {
    const dataModel = {
      id: 'dm-3',
      name: 'DFR v0.6.0',
      credentialType: 'DigitalFacilityRecord',
      version: '0.6.0',
      schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dfr/0.6.0/',
    };
    mockGetDataModelById.mockResolvedValue(dataModel);

    const req = createFakeRequest();
    const res = await GET(req, createContext('dm-3') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.formConfig.sections).toHaveLength(4);
    expect(json.formConfig.sections).toEqual([
      { entityType: 'organisation', label: 'Organisation', endpoint: '/api/v1/organisations', required: true },
      { entityType: 'facility', label: 'Facility', endpoint: '/api/v1/facilities', required: true },
      { entityType: 'conformityScheme', label: 'Conformity Scheme', endpoint: '/api/v1/cvc/schemes', required: false },
      {
        entityType: 'conformityProfile',
        label: 'Conformity Profile',
        endpoint: '/api/v1/cvc/profiles?schemeId=:conformityScheme',
        required: false,
        dependsOn: 'conformityScheme',
      },
    ]);
  });

  it('returns form config with correct sections for DigitalIdentityAnchor', async () => {
    const dataModel = {
      id: 'dm-4',
      name: 'DIA v0.6.0',
      credentialType: 'DigitalIdentityAnchor',
      version: '0.6.0',
      schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dia/0.6.0/',
    };
    mockGetDataModelById.mockResolvedValue(dataModel);

    const req = createFakeRequest();
    const res = await GET(req, createContext('dm-4') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.formConfig.sections).toHaveLength(1);
    expect(json.formConfig.sections).toEqual([
      { entityType: 'organisation', label: 'Organisation', endpoint: '/api/v1/organisations', required: true },
    ]);
  });

  it('returns form config with correct sections for DigitalTraceabilityEvent', async () => {
    const dataModel = {
      id: 'dm-5',
      name: 'DTE v0.6.0',
      credentialType: 'DigitalTraceabilityEvent',
      version: '0.6.0',
      schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dte/0.6.0/',
    };
    mockGetDataModelById.mockResolvedValue(dataModel);

    const req = createFakeRequest();
    const res = await GET(req, createContext('dm-5') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.formConfig.sections).toHaveLength(2);
    expect(json.formConfig.sections).toEqual([
      { entityType: 'organisation', label: 'Organisation', endpoint: '/api/v1/organisations', required: true },
      { entityType: 'product', label: 'Product', endpoint: '/api/v1/products', required: true },
    ]);
  });

  it('does not include conformity sections for DigitalIdentityAnchor', async () => {
    const dataModel = {
      id: 'dm-4',
      name: 'DIA v0.6.0',
      credentialType: 'DigitalIdentityAnchor',
      version: '0.6.0',
      schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dia/0.6.0/',
    };
    mockGetDataModelById.mockResolvedValue(dataModel);

    const req = createFakeRequest();
    const res = await GET(req, createContext('dm-4') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    const entityTypes = json.formConfig.sections.map((s: { entityType: string }) => s.entityType);
    expect(entityTypes).not.toContain('conformityScheme');
    expect(entityTypes).not.toContain('conformityProfile');
  });

  it('does not include conformity sections for DigitalTraceabilityEvent', async () => {
    const dataModel = {
      id: 'dm-5',
      name: 'DTE v0.6.0',
      credentialType: 'DigitalTraceabilityEvent',
      version: '0.6.0',
      schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dte/0.6.0/',
    };
    mockGetDataModelById.mockResolvedValue(dataModel);

    const req = createFakeRequest();
    const res = await GET(req, createContext('dm-5') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    const entityTypes = json.formConfig.sections.map((s: { entityType: string }) => s.entityType);
    expect(entityTypes).not.toContain('conformityScheme');
    expect(entityTypes).not.toContain('conformityProfile');
  });

  it('conformityProfile section has dependsOn set to conformityScheme for DPP', async () => {
    const dataModel = {
      id: 'dm-1',
      name: 'DPP v0.6.0',
      credentialType: 'DigitalProductPassport',
      version: '0.6.0',
      schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/',
    };
    mockGetDataModelById.mockResolvedValue(dataModel);

    const req = createFakeRequest();
    const res = await GET(req, createContext('dm-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    const profileSection = json.formConfig.sections.find(
      (s: { entityType: string }) => s.entityType === 'conformityProfile',
    );
    expect(profileSection).toBeDefined();
    expect(profileSection.dependsOn).toBe('conformityScheme');
  });

  it('all conformity sections have required: false', async () => {
    const dataModels = [
      { id: 'dm-1', credentialType: 'DigitalProductPassport', version: '0.6.0', schemaUrl: '' },
      { id: 'dm-2', credentialType: 'DigitalConformityCredential', version: '0.6.0', schemaUrl: '' },
      { id: 'dm-3', credentialType: 'DigitalFacilityRecord', version: '0.6.0', schemaUrl: '' },
    ];

    for (const dataModel of dataModels) {
      mockGetDataModelById.mockResolvedValue(dataModel);

      const req = createFakeRequest();
      const res = await GET(req, createContext(dataModel.id) as unknown as Parameters<typeof GET>[1]);
      const json = await res.json();

      const conformitySections = json.formConfig.sections.filter((s: { entityType: string }) =>
        ['conformityScheme', 'conformityProfile'].includes(s.entityType),
      );
      expect(conformitySections.length).toBeGreaterThan(0);
      for (const section of conformitySections) {
        expect(section.required).toBe(false);
      }
    }
  });

  it('returns empty sections for unknown credential type', async () => {
    const dataModel = {
      id: 'dm-unknown',
      name: 'Unknown',
      credentialType: 'SomeUnknownType',
      version: '1.0.0',
      schemaUrl: 'https://example.com/schema',
    };
    mockGetDataModelById.mockResolvedValue(dataModel);

    const req = createFakeRequest();
    const res = await GET(req, createContext('dm-unknown') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.formConfig.sections).toEqual([]);
  });

  it('returns 404 when data model not found', async () => {
    mockGetDataModelById.mockResolvedValue(null);

    const req = createFakeRequest();
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Data model not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetDataModelById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest();
    const res = await GET(req, createContext('dm-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
