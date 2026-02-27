jest.mock('next-auth/providers/keycloak', () => ({
  __esModule: true,
  default: jest.fn((config: unknown) => ({ id: 'keycloak', ...(config as object) })),
}));
jest.mock('next-auth/providers/zitadel', () => ({
  __esModule: true,
  default: jest.fn((config: unknown) => ({ id: 'zitadel', ...(config as object) })),
}));

import Keycloak from 'next-auth/providers/keycloak';
import Zitadel from 'next-auth/providers/zitadel';
import { getOidcProvider } from './oidc-provider';

const keycloakMock = Keycloak as jest.MockedFunction<typeof Keycloak>;
const zitadelMock = Zitadel as jest.MockedFunction<typeof Zitadel>;

describe('getOidcProvider', () => {
  beforeEach(() => {
    process.env.AUTH_OIDC_ISSUER = 'http://localhost:8080/realms/test';
    process.env.AUTH_OIDC_CLIENT_ID = 'ri-app';
    process.env.AUTH_OIDC_CLIENT_SECRET = 'changeme';
    delete process.env.AUTH_OIDC_PROVIDER;
    delete process.env.AUTH_OIDC_AUTHORIZATION_URL;

    keycloakMock.mockClear();
    zitadelMock.mockClear();
  });

  it('defaults to Keycloak when AUTH_OIDC_PROVIDER is not set', () => {
    const result = getOidcProvider();

    expect(keycloakMock).toHaveBeenCalledWith({
      issuer: 'http://localhost:8080/realms/test',
      clientId: 'ri-app',
      clientSecret: 'changeme',
    });
    expect(result).toEqual(expect.objectContaining({ id: 'keycloak' }));
  });

  it('returns Keycloak when AUTH_OIDC_PROVIDER is explicitly "keycloak"', () => {
    process.env.AUTH_OIDC_PROVIDER = 'keycloak';

    const result = getOidcProvider();

    expect(keycloakMock).toHaveBeenCalledWith({
      issuer: 'http://localhost:8080/realms/test',
      clientId: 'ri-app',
      clientSecret: 'changeme',
    });
    expect(result).toEqual(expect.objectContaining({ id: 'keycloak' }));
  });

  it('returns Zitadel when AUTH_OIDC_PROVIDER is "zitadel"', () => {
    process.env.AUTH_OIDC_PROVIDER = 'zitadel';

    const result = getOidcProvider();

    expect(zitadelMock).toHaveBeenCalledWith({
      issuer: 'http://localhost:8080/realms/test',
      clientId: 'ri-app',
      clientSecret: 'changeme',
    });
    expect(result).toEqual(expect.objectContaining({ id: 'zitadel' }));
  });

  it('passes AUTH_OIDC_AUTHORIZATION_URL through for Keycloak', () => {
    process.env.AUTH_OIDC_PROVIDER = 'keycloak';
    process.env.AUTH_OIDC_AUTHORIZATION_URL = 'http://external:8080/realms/test/protocol/openid-connect/auth';

    getOidcProvider();

    expect(keycloakMock).toHaveBeenCalledWith({
      issuer: 'http://localhost:8080/realms/test',
      clientId: 'ri-app',
      clientSecret: 'changeme',
      authorization: { url: 'http://external:8080/realms/test/protocol/openid-connect/auth' },
    });
  });

  it('passes AUTH_OIDC_AUTHORIZATION_URL through for Zitadel', () => {
    process.env.AUTH_OIDC_PROVIDER = 'zitadel';
    process.env.AUTH_OIDC_AUTHORIZATION_URL = 'http://external:8080/authorize';

    getOidcProvider();

    expect(zitadelMock).toHaveBeenCalledWith({
      issuer: 'http://localhost:8080/realms/test',
      clientId: 'ri-app',
      clientSecret: 'changeme',
      authorization: { url: 'http://external:8080/authorize' },
    });
  });

  it('throws for unsupported provider values', () => {
    process.env.AUTH_OIDC_PROVIDER = 'okta';

    expect(() => getOidcProvider()).toThrow("Unsupported IdP provider: 'okta'");
  });

  it('throws when required env vars are missing', () => {
    delete process.env.AUTH_OIDC_ISSUER;
    delete process.env.AUTH_OIDC_CLIENT_ID;
    delete process.env.AUTH_OIDC_CLIENT_SECRET;

    expect(() => getOidcProvider()).toThrow(
      'AUTH_OIDC_ISSUER, AUTH_OIDC_CLIENT_ID, and AUTH_OIDC_CLIENT_SECRET must all be set',
    );
  });
});
