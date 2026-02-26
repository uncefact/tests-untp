const mockAuth = jest.fn();
jest.mock('@/auth', () => ({
  auth: () => mockAuth(),
}));

const mockGetOidcEndpoints = jest.fn();
jest.mock('@/lib/auth/oidc-discovery', () => ({
  getOidcEndpoints: () => mockGetOidcEndpoints(),
}));

import { getLogoutUrl } from './actions';

beforeEach(() => {
  jest.resetAllMocks();
  process.env.RI_APP_URL = 'http://localhost:3003';

  mockGetOidcEndpoints.mockResolvedValue({
    end_session_endpoint: 'http://localhost:8080/realms/test/protocol/openid-connect/logout',
    jwks_uri: 'http://localhost:8080/realms/test/protocol/openid-connect/certs',
    token_endpoint: 'http://localhost:8080/realms/test/protocol/openid-connect/token',
  });
});

describe('getLogoutUrl', () => {
  it('returns logout URL with id_token_hint and post_logout_redirect_uri', async () => {
    mockAuth.mockResolvedValue({ id_token: 'test-id-token' });

    const url = await getLogoutUrl();

    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe('http://localhost:8080/realms/test/protocol/openid-connect/logout');
    expect(parsed.searchParams.get('id_token_hint')).toBe('test-id-token');
    expect(parsed.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:3003');
  });

  it('returns null when session has no id_token', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const url = await getLogoutUrl();

    expect(url).toBeNull();
  });

  it('returns null when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const url = await getLogoutUrl();

    expect(url).toBeNull();
  });

  it('uses discovered end_session_endpoint', async () => {
    mockAuth.mockResolvedValue({ id_token: 'test-id-token' });
    mockGetOidcEndpoints.mockResolvedValue({
      end_session_endpoint: 'http://zitadel.example.com/oidc/v1/end_session',
      jwks_uri: 'http://zitadel.example.com/.well-known/jwks',
      token_endpoint: 'http://zitadel.example.com/oauth/v2/token',
    });

    const url = await getLogoutUrl();

    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe('http://zitadel.example.com/oidc/v1/end_session');
  });
});
