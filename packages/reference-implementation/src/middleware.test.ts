/* eslint-disable @typescript-eslint/no-explicit-any */

// Polyfill crypto.randomUUID for jsdom (not available by default)
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000000',
  });
}

// --- Mocks (must be declared before imports) ---

const mockValidateServiceAccountToken = jest.fn();
const mockExtractBearerToken = jest.fn();

jest.mock('@/lib/auth/token-validator', () => ({
  validateServiceAccountToken: (...args: unknown[]) => mockValidateServiceAccountToken(...args),
  extractBearerToken: (...args: unknown[]) => mockExtractBearerToken(...args),
}));

jest.mock('@uncefact/untp-ri-services/logging', () => ({
  runWithRequestContext: (_id: string, fn: () => unknown) => fn(),
}));

jest.mock('@/lib/auth/auth.config', () => ({
  authConfig: {},
}));

// Mock NextAuth — the middleware calls `auth(handler)` which returns a
// function.  We make `auth` simply return the handler itself so we can
// invoke it directly with a fake request.
jest.mock('next-auth', () => {
  return {
    __esModule: true,
    default: () => ({
      auth: (handler: (...args: any[]) => any) => handler,
    }),
  };
});

// Provide a minimal NextResponse mock that behaves like the real one.
const mockNextResponseNext = jest.fn();
const mockNextResponseJson = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    next: (...args: unknown[]) => mockNextResponseNext(...args),
    json: (...args: unknown[]) => mockNextResponseJson(...args),
  },
}));

// --- Imports (after mocks) ---
import middleware from './middleware';

// --- Helpers ---

/** Build a fake NextRequest-like object. */
function fakeRequest(
  pathname: string,
  options?: {
    headers?: Record<string, string>;
    auth?: { user?: Record<string, string> } | null;
  },
): any {
  const headers = new Headers(options?.headers ?? {});
  return {
    headers,
    nextUrl: { pathname },
    auth: options?.auth ?? null,
  };
}

/** Fake NextResponse returned by NextResponse.next(). */
function fakeNextResponse() {
  const responseHeaders = new Headers();
  return {
    headers: responseHeaders,
    request: {},
  };
}

// --- Tests ---

beforeEach(() => {
  jest.clearAllMocks();

  mockNextResponseNext.mockImplementation(() => fakeNextResponse());

  mockNextResponseJson.mockImplementation((body: unknown, init?: any) => ({
    status: init?.status ?? 200,
    headers: new Headers(init?.headers ?? {}),
    json: async () => body,
  }));

  mockExtractBearerToken.mockReturnValue(null);
  mockValidateServiceAccountToken.mockResolvedValue({ valid: false });
});

describe('middleware', () => {
  describe('public API routes', () => {
    it('bypasses auth and returns NextResponse.next() for /api/v1/credentials/verify', async () => {
      const req = fakeRequest('/api/v1/credentials/verify');
      await (middleware as any)(req);

      expect(mockNextResponseNext).toHaveBeenCalledTimes(1);
      // Should NOT attempt bearer token validation
      expect(mockValidateServiceAccountToken).not.toHaveBeenCalled();
    });

    it('sets x-correlation-id header on the response', async () => {
      const correlationId = 'test-correlation-id';
      const req = fakeRequest('/api/v1/credentials/verify', {
        headers: { 'x-correlation-id': correlationId },
      });

      const response = fakeNextResponse();
      mockNextResponseNext.mockReturnValueOnce(response);

      await (middleware as any)(req);

      expect(response.headers.get('x-correlation-id')).toBe(correlationId);
    });

    it('strips x-auth-* headers from the request', async () => {
      const req = fakeRequest('/api/v1/credentials/verify', {
        headers: {
          'x-auth-sub': 'spoofed-sub',
          'x-auth-azp': 'spoofed-azp',
          'content-type': 'application/json',
        },
      });

      let capturedHeaders: Headers | undefined;
      mockNextResponseNext.mockImplementationOnce((opts?: any) => {
        capturedHeaders = opts?.request?.headers;
        return fakeNextResponse();
      });

      await (middleware as any)(req);

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!.has('x-auth-sub')).toBe(false);
      expect(capturedHeaders!.has('x-auth-azp')).toBe(false);
      expect(capturedHeaders!.get('content-type')).toBe('application/json');
    });

    it('does not require session auth for public routes', async () => {
      // No session (auth = null), no bearer token — should still succeed
      const req = fakeRequest('/api/v1/credentials/verify', { auth: null });

      await (middleware as any)(req);

      expect(mockNextResponseNext).toHaveBeenCalledTimes(1);
      expect(mockNextResponseJson).not.toHaveBeenCalled();
    });
  });

  describe('non-public API routes', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const req = fakeRequest('/api/v1/dids');

      await (middleware as any)(req);

      expect(mockNextResponseJson).toHaveBeenCalledWith(
        { error: 'Unauthorized', message: 'Authentication required' },
        expect.objectContaining({ status: 401 }),
      );
    });

    it('allows session-authenticated requests through', async () => {
      const req = fakeRequest('/api/v1/dids', {
        auth: { user: { id: 'user-1' } },
      });

      await (middleware as any)(req);

      expect(mockNextResponseNext).toHaveBeenCalledTimes(1);
      expect(mockNextResponseJson).not.toHaveBeenCalled();
    });

    it('allows valid bearer token requests through', async () => {
      const req = fakeRequest('/api/v1/dids', {
        headers: { authorization: 'Bearer valid-token' },
      });

      mockExtractBearerToken.mockReturnValueOnce('valid-token');
      mockValidateServiceAccountToken.mockResolvedValueOnce({
        valid: true,
        payload: { sub: 'service-account-1', azp: 'client-id' },
      });

      await (middleware as any)(req);

      expect(mockNextResponseNext).toHaveBeenCalledTimes(1);
    });
  });

  describe('non-API routes', () => {
    it('passes through without auth checks', async () => {
      const req = fakeRequest('/dashboard');

      await (middleware as any)(req);

      expect(mockNextResponseNext).toHaveBeenCalledTimes(1);
      expect(mockValidateServiceAccountToken).not.toHaveBeenCalled();
    });
  });
});
