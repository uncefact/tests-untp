import { getOidcEndpoints, clearOidcCache } from './oidc-discovery';

const originalFetch = global.fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

const mockDiscoveryResponse = {
  jwks_uri: 'http://localhost:8080/realms/test/protocol/openid-connect/certs',
  token_endpoint: 'http://localhost:8080/realms/test/protocol/openid-connect/token',
  end_session_endpoint: 'http://localhost:8080/realms/test/protocol/openid-connect/logout',
};

beforeEach(() => {
  jest.resetAllMocks();
  clearOidcCache();
  process.env.AUTH_OIDC_ISSUER = 'http://localhost:8080/realms/test';
});

describe('getOidcEndpoints', () => {
  it('fetches and returns OIDC endpoints', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDiscoveryResponse,
    });

    const endpoints = await getOidcEndpoints();

    expect(endpoints).toEqual(mockDiscoveryResponse);
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:8080/realms/test/.well-known/openid-configuration');
  });

  it('caches the result and does not fetch again on second call', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDiscoveryResponse,
    });

    const first = await getOidcEndpoints();
    const second = await getOidcEndpoints();

    expect(first).toEqual(mockDiscoveryResponse);
    expect(second).toBe(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws when AUTH_OIDC_ISSUER is not set', async () => {
    delete process.env.AUTH_OIDC_ISSUER;

    await expect(getOidcEndpoints()).rejects.toThrow('AUTH_OIDC_ISSUER environment variable is not set');
  });

  it('throws on non-OK response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(getOidcEndpoints()).rejects.toThrow(/OIDC discovery failed/);
  });

  it('normalises trailing slash on issuer', async () => {
    process.env.AUTH_OIDC_ISSUER = 'http://localhost:8080/realms/test/';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDiscoveryResponse,
    });

    await getOidcEndpoints();

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:8080/realms/test/.well-known/openid-configuration');
  });

  it('throws when discovery response is missing required fields', async () => {
    process.env.AUTH_OIDC_ISSUER = 'https://issuer.example.com';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ end_session_endpoint: 'https://issuer.example.com/logout' }),
    });

    await expect(getOidcEndpoints()).rejects.toThrow('OIDC discovery response missing required fields');
  });

  it('resets cache when clearOidcCache is called', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDiscoveryResponse,
    });

    await getOidcEndpoints();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    clearOidcCache();
    await getOidcEndpoints();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
