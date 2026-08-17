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
  // Real validator: the wrappers' reject-and-replace behaviour is the code under test.
  isValidCorrelationId: jest.requireActual('@uncefact/untp-ri-services/logging').isValidCorrelationId,
  amznTraceRootToken: jest.requireActual('@uncefact/untp-ri-services/logging').amznTraceRootToken,
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

    it('replaces a malformed inbound x-correlation-id with a fresh UUID', async () => {
      const req = fakeRequest('/api/v1/credentials/verify', {
        headers: { 'x-correlation-id': 'bad value; not+allowed' },
      });
      const response = fakeNextResponse();
      mockNextResponseNext.mockReturnValueOnce(response);

      await (middleware as any)(req);

      const echoed = response.headers.get('x-correlation-id');
      expect(echoed).not.toBe('bad value; not+allowed');
      expect(echoed).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('forwards the chosen correlation ID on the request headers to the route', async () => {
      // The response echo and the route must carry the same ID: without the
      // forward, a missing or malformed inbound ID splits into one ID on the
      // response and a different one in route logs and outbound calls (#654).
      const req = fakeRequest('/api/v1/credentials/verify', {
        headers: { 'x-correlation-id': 'bad value; not+allowed' },
      });
      const response = fakeNextResponse();
      mockNextResponseNext.mockReturnValueOnce(response);

      await (middleware as any)(req);

      const forwarded = (mockNextResponseNext.mock.calls[0][0] as { request: { headers: Headers } }).request.headers;
      expect(forwarded.get('x-correlation-id')).toBe(response.headers.get('x-correlation-id'));
      expect(forwarded.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('adopts the x-amzn-trace-id Root token when no correlation ID is supplied', async () => {
      const req = fakeRequest('/api/v1/credentials/verify', {
        headers: { 'x-amzn-trace-id': 'Root=1-67891233-abcdef012345678912345678;Parent=53995c3f42cd8ad8' },
      });
      const response = fakeNextResponse();
      mockNextResponseNext.mockReturnValueOnce(response);

      await (middleware as any)(req);

      expect(response.headers.get('x-correlation-id')).toBe('1-67891233-abcdef012345678912345678');
    });

    it('prefers a valid x-correlation-id over the amzn trace header', async () => {
      const req = fakeRequest('/api/v1/credentials/verify', {
        headers: {
          'x-correlation-id': 'explicit-id',
          'x-amzn-trace-id': 'Root=1-67891233-abcdef012345678912345678',
        },
      });
      const response = fakeNextResponse();
      mockNextResponseNext.mockReturnValueOnce(response);

      await (middleware as any)(req);

      expect(response.headers.get('x-correlation-id')).toBe('explicit-id');
    });

    it('mints a UUID when the amzn trace header carries no valid Root token', async () => {
      const req = fakeRequest('/api/v1/credentials/verify', {
        headers: { 'x-amzn-trace-id': 'Parent=53995c3f42cd8ad8' },
      });
      const response = fakeNextResponse();
      mockNextResponseNext.mockReturnValueOnce(response);

      await (middleware as any)(req);

      expect(response.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
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
        { error: 'Unauthorised', message: 'Authentication required' },
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
