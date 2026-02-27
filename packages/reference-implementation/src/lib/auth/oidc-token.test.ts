const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock('@uncefact/untp-ri-services/logging', () => ({
  createLogger: () => ({ child: () => mockLogger }),
}));

const mockGetOidcEndpoints = jest.fn();
jest.mock('@/lib/auth/oidc-discovery', () => ({
  getOidcEndpoints: () => mockGetOidcEndpoints(),
}));

import { refreshOidcToken, decodeAccessToken } from './oidc-token';

const originalFetch = global.fetch;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.AUTH_OIDC_CLIENT_ID = 'ri-app';
  process.env.AUTH_OIDC_CLIENT_SECRET = 'changeme';

  mockGetOidcEndpoints.mockResolvedValue({
    token_endpoint: 'http://localhost:8080/realms/test/protocol/openid-connect/token',
    jwks_uri: 'http://localhost:8080/realms/test/protocol/openid-connect/certs',
    end_session_endpoint: 'http://localhost:8080/realms/test/protocol/openid-connect/logout',
  });
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('refreshOidcToken', () => {
  it('returns fresh tokens on successful refresh', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 300,
      }),
    });

    const result = await refreshOidcToken('old-refresh');

    expect(result.access_token).toBe('new-access');
    expect(result.refresh_token).toBe('new-refresh');
    expect(result.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('throws on non-OK response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    await expect(refreshOidcToken('bad-refresh')).rejects.toThrow(/Token refresh failed/);
  });

  it('throws on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(refreshOidcToken('some-refresh')).rejects.toThrow('ECONNREFUSED');
  });

  it('uses discovered token_endpoint instead of hardcoded URL', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'x', expires_in: 300 }),
    });

    await refreshOidcToken('the-refresh-token');

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://localhost:8080/realms/test/protocol/openid-connect/token');
    expect(options.method).toBe('POST');
    const body = options.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('the-refresh-token');
    expect(body.get('client_id')).toBe('ri-app');
    expect(body.get('client_secret')).toBe('changeme');
  });
});

describe('decodeAccessToken', () => {
  it('decodes a JWT payload', () => {
    const payload = { sub: 'user-1', groups: ['/acme'] };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = `eyJhbGciOiJSUzI1NiJ9.${encoded}.fake-sig`;

    const result = decodeAccessToken(token);
    expect(result.sub).toBe('user-1');
    expect(result.groups).toEqual(['/acme']);
  });

  it('returns empty object for invalid token', () => {
    const result = decodeAccessToken('not-a-jwt');
    expect(result).toEqual({});
  });
});
