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
  const { NotFoundError, UnprocessableError, errorMessage, ServiceRegistryError } =
    jest.requireActual('@/lib/api/errors');
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
            return jsonResponse({ ok: false, error: (e as Error).message }, { status: 400 });
          }
          if (e instanceof NotFoundError) {
            return jsonResponse({ ok: false, error: (e as Error).message }, { status: 404 });
          }
          if (e instanceof UnprocessableError) {
            return jsonResponse({ ok: false, error: (e as Error).message }, { status: 422 });
          }
          if (e instanceof ServiceRegistryError) {
            return jsonResponse({ ok: false, error: (e as Error).message }, { status: 500 });
          }
          if (e instanceof ServiceError) {
            const serviceErr = e as Error & { code?: string; statusCode?: number };
            return jsonResponse(
              { ok: false, error: serviceErr.message, code: serviceErr.code },
              { status: serviceErr.statusCode },
            );
          }
          return jsonResponse({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
  };
});

const mockGetDidByDid = jest.fn();
const mockCreateCredential = jest.fn();
const mockResolveVcService = jest.fn();
const mockResolveStorageService = jest.fn();
const mockResolveIdrService = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getDidByDid: (did: string, tenantId: string) => mockGetDidByDid(did, tenantId),
  createCredential: (input: unknown) => mockCreateCredential(input),
}));

jest.mock('@/lib/services/resolve-vc-service', () => ({
  resolveVcService: (...args: unknown[]) => mockResolveVcService(...args),
}));

jest.mock('@/lib/services/resolve-storage-service', () => ({
  resolveStorageService: (...args: unknown[]) => mockResolveStorageService(...args),
}));

jest.mock('@/lib/services/resolve-idr-service', () => ({
  resolveIdrService: (...args: unknown[]) => mockResolveIdrService(...args),
}));

import { POST } from './route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeRequest(body: unknown): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/credentials',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

const validPayload = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential'],
  issuer: { type: ['Organization'], id: 'did:web:example.com', name: 'Test' },
  credentialSubject: { id: 'subject-1' },
};

const signedCredential = { ...validPayload, proof: { type: 'Ed25519Signature2020' } };

const storageResponse = {
  uri: 'https://storage.example.com/creds/abc123',
  hash: 'sha256-abc123',
  decryptionKey: 'dec-key-1',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/credentials', () => {
  const mockVcService = { sign: jest.fn() };
  const mockStorageService = { store: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();

    mockResolveVcService.mockResolvedValue({ service: mockVcService, instanceId: 'vc-inst-1' });
    mockResolveStorageService.mockResolvedValue({ service: mockStorageService, instanceId: 'storage-inst-1' });
    mockResolveIdrService.mockResolvedValue({ service: {}, instanceId: 'idr-inst-1' });

    mockVcService.sign.mockResolvedValue(signedCredential);
    mockStorageService.store.mockResolvedValue(storageResponse);
    mockCreateCredential.mockResolvedValue({ id: 'cred-1' });
  });

  // ── Validation: missing issuer.id ────────────────────────────────────────

  it('returns 400 when credentialPayload.issuer.id is missing', async () => {
    const body = {
      credentialPayload: {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: { type: ['Organization'], name: 'No ID Issuer' },
        credentialSubject: { id: 'subject-1' },
      },
    };

    const res = await POST(fakeRequest(body), AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('credentialPayload.issuer.id is required');
  });

  // ── DID not registered ───────────────────────────────────────────────────

  it('returns 422 when issuer DID is not registered for the tenant', async () => {
    mockGetDidByDid.mockResolvedValue(null);

    const res = await POST(
      fakeRequest({ credentialPayload: validPayload }),
      AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('Issuer DID is not registered for this tenant');
    expect(mockGetDidByDid).toHaveBeenCalledWith('did:web:example.com', 'org-1');
  });

  // ── Non-issuable DID statuses ────────────────────────────────────────────

  it('returns 422 when issuer DID status is VERIFICATION_FAILED', async () => {
    mockGetDidByDid.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com', status: 'VERIFICATION_FAILED' });

    const res = await POST(
      fakeRequest({ credentialPayload: validPayload }),
      AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.ok).toBe(false);
    expect(json.error).toContain('VERIFICATION_FAILED');
    expect(json.error).toContain('not eligible for credential issuance');
  });

  it('returns 422 when issuer DID status is UNVERIFIED', async () => {
    mockGetDidByDid.mockResolvedValue({ id: 'did-2', did: 'did:web:example.com', status: 'UNVERIFIED' });

    const res = await POST(
      fakeRequest({ credentialPayload: validPayload }),
      AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.ok).toBe(false);
    expect(json.error).toContain('UNVERIFIED');
    expect(json.error).toContain('not eligible for credential issuance');
  });

  it('returns 422 when issuer DID status is INACTIVE', async () => {
    mockGetDidByDid.mockResolvedValue({ id: 'did-3', did: 'did:web:example.com', status: 'INACTIVE' });

    const res = await POST(
      fakeRequest({ credentialPayload: validPayload }),
      AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.ok).toBe(false);
    expect(json.error).toContain('INACTIVE');
    expect(json.error).toContain('not eligible for credential issuance');
  });

  // ── Issuable DID statuses (happy paths) ──────────────────────────────────

  it('returns 201 when issuer DID status is ACTIVE', async () => {
    mockGetDidByDid.mockResolvedValue({ id: 'did-4', did: 'did:web:example.com', status: 'ACTIVE' });

    const res = await POST(
      fakeRequest({ credentialPayload: validPayload }),
      AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.credentialId).toBe('cred-1');

    // Verify the full happy path was executed
    expect(mockVcService.sign).toHaveBeenCalledWith(validPayload);
    expect(mockStorageService.store).toHaveBeenCalledWith(signedCredential, true);
    expect(mockCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        storageUri: storageResponse.uri,
        hash: storageResponse.hash,
        decryptionKey: storageResponse.decryptionKey,
        credentialType: 'VerifiableCredential',
        isPublished: false,
      }),
    );
  });

  it('returns 201 when issuer DID status is VERIFIED', async () => {
    mockGetDidByDid.mockResolvedValue({ id: 'did-5', did: 'did:web:example.com', status: 'VERIFIED' });

    const res = await POST(
      fakeRequest({ credentialPayload: validPayload }),
      AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.credentialId).toBe('cred-1');

    // Verify the full happy path was executed
    expect(mockVcService.sign).toHaveBeenCalledWith(validPayload);
    expect(mockStorageService.store).toHaveBeenCalledWith(signedCredential, true);
    expect(mockCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        storageUri: storageResponse.uri,
        hash: storageResponse.hash,
        decryptionKey: storageResponse.decryptionKey,
        credentialType: 'VerifiableCredential',
        isPublished: false,
      }),
    );
  });
});
