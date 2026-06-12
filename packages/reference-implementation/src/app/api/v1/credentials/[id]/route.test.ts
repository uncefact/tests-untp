// Mock next/server before importing route handlers (jsdom lacks Request/Response)
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withTenantAuth — mirrors handleRouteError behaviour inline to avoid
// import issues with mocked modules
jest.mock('@/lib/api/with-tenant-auth', () => {
  const { NotFoundError, errorMessage } = jest.requireActual('@/lib/api/errors');
  const { ValidationError } = jest.requireActual('@/lib/api/validation');

  function jsonResponse(body: unknown, init?: { status?: number }) {
    return { status: init?.status ?? 200, json: async () => body };
  }

  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (e: unknown) {
          if (e instanceof ValidationError) return jsonResponse({ error: (e as Error).message }, { status: 400 });
          if (e instanceof NotFoundError) return jsonResponse({ error: (e as Error).message }, { status: 404 });
          return jsonResponse({ error: errorMessage(e) }, { status: 500 });
        }
      },
  };
});

// Suppress logger output in tests
jest.mock('@/lib/api/logger', () => ({
  apiLogger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// Mock repository
const mockGetCredentialById = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  getCredentialById: (...args: unknown[]) => mockGetCredentialById(...args),
}));

// Pass stored keys through by default; individual tests override per call
const mockRevealDecryptionKey = jest.fn((...args: unknown[]) => args[0]);
jest.mock('@/lib/credentials/decryption-key-protection', () => ({
  revealDecryptionKey: (...args: unknown[]) => mockRevealDecryptionKey(...args),
}));

// Import handler after mocks are in place
import { GET } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeRequest(): Request {
  return {
    method: 'GET',
    url: 'http://localhost/api/v1/credentials/cred-1',
    headers: new Headers(),
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({ id: 'cred-1' }) };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/credentials/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Happy path -----------------------------------------------------------

  it('returns 200 with the credential object directly', async () => {
    const credential = {
      id: 'cred-1',
      type: 'DigitalProductPassport',
      vcData: { some: 'data' },
      organisationId: 'tenant-1',
    };
    mockGetCredentialById.mockResolvedValue(credential);

    const res = (await GET(createFakeRequest(), AUTH_CONTEXT)) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(credential);
  });

  it('reveals the stored decryption key before returning the credential', async () => {
    mockGetCredentialById.mockResolvedValue({ id: 'cred-1', decryptionKey: 'stored-envelope' });
    mockRevealDecryptionKey.mockReturnValueOnce('plain-key');

    const res = (await GET(createFakeRequest(), AUTH_CONTEXT)) as { status: number; json: () => Promise<unknown> };
    const body = (await res.json()) as { decryptionKey?: string };

    expect(mockRevealDecryptionKey).toHaveBeenCalledWith('stored-envelope');
    expect(body.decryptionKey).toBe('plain-key');
  });

  it('calls getCredentialById with correct id and tenantId', async () => {
    mockGetCredentialById.mockResolvedValue({ id: 'cred-1' });

    await GET(createFakeRequest(), AUTH_CONTEXT);

    expect(mockGetCredentialById).toHaveBeenCalledTimes(1);
    expect(mockGetCredentialById).toHaveBeenCalledWith('cred-1', 'tenant-1');
  });

  // --- Error paths ----------------------------------------------------------

  it('returns 404 when getCredentialById returns null', async () => {
    mockGetCredentialById.mockResolvedValue(null);

    const res = (await GET(createFakeRequest(), AUTH_CONTEXT)) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Credential not found' });
  });

  it('returns 500 when the stored decryption key cannot be decrypted', async () => {
    mockGetCredentialById.mockResolvedValue({ id: 'cred-1', decryptionKey: 'stored-envelope' });
    mockRevealDecryptionKey.mockImplementationOnce(() => {
      throw new Error('Failed to decrypt the stored credential decryption key.');
    });

    const res = (await GET(createFakeRequest(), AUTH_CONTEXT)) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(500);
  });

  it('returns 500 when repository throws', async () => {
    mockGetCredentialById.mockRejectedValue(new Error('DB connection lost'));

    const res = (await GET(createFakeRequest(), AUTH_CONTEXT)) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'DB connection lost' });
  });

  // --- Tenant isolation -----------------------------------------------------

  it('passes tenantId from context to repository for tenant isolation', async () => {
    const ctx = { tenantId: 'other-tenant', params: Promise.resolve({ id: 'cred-99' }) };
    mockGetCredentialById.mockResolvedValue({ id: 'cred-99' });

    await GET(createFakeRequest(), ctx);

    expect(mockGetCredentialById).toHaveBeenCalledWith('cred-99', 'other-tenant');
  });
});
