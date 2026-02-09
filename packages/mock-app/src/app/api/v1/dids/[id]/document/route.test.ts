// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withOrgAuth as passthrough
jest.mock('@/lib/api/with-org-auth', () => ({
  withOrgAuth: (handler: (...args: unknown[]) => unknown) => handler,
}));

const mockResolveDidService = jest.fn();
const mockGetDidById = jest.fn();

jest.mock('@/lib/services/resolve-did-service', () => ({
  resolveDidService: (...args: unknown[]) => mockResolveDidService(...args),
}));

jest.mock('@/lib/prisma/repositories', () => ({
  getDidById: (id: string, orgId: string) => mockGetDidById(id, orgId),
}));

import { ServiceResolutionError } from '@/lib/api/errors';
import { GET } from './route';

function createContext(id: string) {
  return { organizationId: 'org-1', params: Promise.resolve({ id }) };
}

function createFakeRequest(): Request {
  return {
    method: 'GET',
    url: 'http://localhost/api/v1/dids/did-1/document',
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Request;
}

describe('GET /api/v1/dids/:id/document', () => {
  const mockDidService = { getDocument: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveDidService.mockResolvedValue({ service: mockDidService, instanceId: 'inst-1' });
  });

  it('returns the DID document', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    const document = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:web:example.com',
      verificationMethod: [],
    };
    mockDidService.getDocument.mockResolvedValue(document);

    const res = await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.document).toEqual(document);
  });

  it('returns 404 when DID not found', async () => {
    mockGetDidById.mockResolvedValue(null);

    const res = await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(404);
  });

  it('returns 500 when service fails', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    mockDidService.getDocument.mockRejectedValue(new Error('Service error'));

    const res = await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(500);
  });

  it('returns 500 when service resolution fails', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    mockResolveDidService.mockRejectedValue(new ServiceResolutionError('DID', 'org-1'));

    const res = await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('No service instance available');
  });

  it('resolves the DID service with the organisation ID', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    mockDidService.getDocument.mockResolvedValue({ id: 'did:web:example.com' });

    await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);

    expect(mockResolveDidService).toHaveBeenCalledWith('org-1', undefined);
  });

  it('resolves the DID service with the stored serviceInstanceId', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com', serviceInstanceId: 'inst-99' });
    mockDidService.getDocument.mockResolvedValue({ id: 'did:web:example.com' });

    await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);

    expect(mockResolveDidService).toHaveBeenCalledWith('org-1', 'inst-99');
  });
});
