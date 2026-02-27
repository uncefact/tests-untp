const mockGetOidcEndpoints = jest.fn();
jest.mock('@/lib/auth/oidc-discovery', () => ({
  getOidcEndpoints: () => mockGetOidcEndpoints(),
}));

import * as jose from 'jose';
import { validateServiceAccountToken, extractBearerToken } from './token-validator';

const mockJwtVerify = jose.jwtVerify as jest.Mock;
const mockCreateRemoteJWKSet = jose.createRemoteJWKSet as jest.Mock;

const mockJwksGetter = jest.fn();
const mockOidcEndpoints = {
  jwks_uri: 'https://issuer.example.com/protocol/openid-connect/certs',
  token_endpoint: 'https://issuer.example.com/protocol/openid-connect/token',
  end_session_endpoint: 'https://issuer.example.com/protocol/openid-connect/logout',
};

let savedIssuer: string | undefined;
let savedAudience: string | undefined;

beforeEach(() => {
  jest.resetAllMocks();

  savedIssuer = process.env.AUTH_OIDC_ISSUER;
  savedAudience = process.env.AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE;

  process.env.AUTH_OIDC_ISSUER = 'https://issuer.example.com';
  process.env.AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE = 'ri-api';

  mockGetOidcEndpoints.mockResolvedValue(mockOidcEndpoints);
  mockCreateRemoteJWKSet.mockReturnValue(mockJwksGetter);
});

afterEach(() => {
  if (savedIssuer !== undefined) {
    process.env.AUTH_OIDC_ISSUER = savedIssuer;
  } else {
    delete process.env.AUTH_OIDC_ISSUER;
  }

  if (savedAudience !== undefined) {
    process.env.AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE = savedAudience;
  } else {
    delete process.env.AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE;
  }
});

describe('extractBearerToken', () => {
  it('returns the token from a valid "Bearer xxx" header', () => {
    expect(extractBearerToken('Bearer my-token-123')).toBe('my-token-123');
  });

  it('returns null for a null header', () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it('returns null when the "Bearer" prefix is missing', () => {
    expect(extractBearerToken('Token my-token-123')).toBeNull();
  });

  it('returns null when the header has extra parts', () => {
    expect(extractBearerToken('Bearer my-token extra-part')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractBearerToken('')).toBeNull();
  });

  it('handles case-insensitive "bearer" prefix', () => {
    expect(extractBearerToken('bearer my-token')).toBe('my-token');
    expect(extractBearerToken('BEARER my-token')).toBe('my-token');
    expect(extractBearerToken('BeArEr my-token')).toBe('my-token');
  });
});

describe('validateServiceAccountToken', () => {
  const validPayload = {
    sub: 'service-account-client',
    iss: 'https://issuer.example.com',
    aud: 'ri-api',
    exp: Math.floor(Date.now() / 1000) + 300,
  };

  it('returns valid with payload when the token verifies successfully', async () => {
    mockJwtVerify.mockResolvedValue({ payload: validPayload });

    const result = await validateServiceAccountToken('valid-jwt-token');

    expect(result).toEqual({ valid: true, payload: validPayload });
    expect(mockGetOidcEndpoints).toHaveBeenCalled();
    expect(mockCreateRemoteJWKSet).toHaveBeenCalled();
    expect(mockJwtVerify).toHaveBeenCalledWith('valid-jwt-token', mockJwksGetter, {
      issuer: 'https://issuer.example.com',
      audience: 'ri-api',
    });
  });

  it('returns an error when the issuer is not configured', async () => {
    delete process.env.AUTH_OIDC_ISSUER;

    const result = await validateServiceAccountToken('some-token');

    expect(result).toEqual({ valid: false, error: 'IdP issuer not configured' });
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it('returns "Token has expired" for ERR_JWT_EXPIRED', async () => {
    mockJwtVerify.mockRejectedValue(new jose.errors.JWTExpired('token expired', {}));

    const result = await validateServiceAccountToken('expired-token');

    expect(result).toEqual({ valid: false, error: 'Token has expired' });
  });

  it('returns claim validation error for ERR_JWT_CLAIM_VALIDATION_FAILED', async () => {
    mockJwtVerify.mockRejectedValue(new jose.errors.JWTClaimValidationFailed('unexpected "iss" claim value', {}));

    const result = await validateServiceAccountToken('bad-claims-token');

    expect(result).toEqual({
      valid: false,
      error: 'Token claim validation failed: unexpected "iss" claim value',
    });
  });

  it('returns signature error for ERR_JWS_SIGNATURE_VERIFICATION_FAILED', async () => {
    mockJwtVerify.mockRejectedValue(new jose.errors.JWSSignatureVerificationFailed());

    const result = await validateServiceAccountToken('tampered-token');

    expect(result).toEqual({ valid: false, error: 'Token signature verification failed' });
  });

  it('returns JWKS error for ERR_JWKS_NO_MATCHING_KEY', async () => {
    mockJwtVerify.mockRejectedValue(new jose.errors.JWKSNoMatchingKey());

    const result = await validateServiceAccountToken('unknown-key-token');

    expect(result).toEqual({ valid: false, error: 'No matching key found in JWKS' });
  });

  it('returns a generic error for unknown errors', async () => {
    mockJwtVerify.mockRejectedValue(new Error('network failure'));

    const result = await validateServiceAccountToken('some-token');

    expect(result).toEqual({ valid: false, error: 'network failure' });
  });

  it('returns fallback message for non-Error thrown values', async () => {
    mockJwtVerify.mockRejectedValue('something went wrong');

    const result = await validateServiceAccountToken('some-token');

    expect(result).toEqual({ valid: false, error: 'Token validation failed' });
  });

  it('uses options.issuer over the environment variable when provided', async () => {
    mockJwtVerify.mockResolvedValue({ payload: validPayload });

    await validateServiceAccountToken('valid-token', {
      issuer: 'https://custom-issuer.example.com',
    });

    expect(mockJwtVerify).toHaveBeenCalledWith('valid-token', mockJwksGetter, {
      issuer: 'https://custom-issuer.example.com',
      audience: 'ri-api',
    });
  });

  it('uses options.audience over the environment variable when provided', async () => {
    process.env.AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE = 'env-audience';
    mockJwtVerify.mockResolvedValue({ payload: validPayload });

    await validateServiceAccountToken('valid-token', { audience: 'custom-audience' });

    expect(mockJwtVerify).toHaveBeenCalledWith('valid-token', mockJwksGetter, {
      issuer: 'https://issuer.example.com',
      audience: 'custom-audience',
    });
  });

  it('returns error when audience is not configured', async () => {
    delete process.env.AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE;

    const result = await validateServiceAccountToken('valid-token');

    expect(result).toEqual({
      valid: false,
      error: 'Service account audience not configured (AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE)',
    });
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it('includes audience in verify options when configured via env', async () => {
    process.env.AUTH_OIDC_SERVICE_ACCOUNT_AUDIENCE = 'ri-api';
    mockJwtVerify.mockResolvedValue({ payload: validPayload });

    await validateServiceAccountToken('valid-token');

    expect(mockJwtVerify).toHaveBeenCalledWith('valid-token', mockJwksGetter, {
      issuer: 'https://issuer.example.com',
      audience: 'ri-api',
    });
  });

  it('falls back to env issuer when options.issuer is undefined', async () => {
    mockJwtVerify.mockResolvedValue({ payload: validPayload });

    await validateServiceAccountToken('valid-token', { issuer: undefined });

    expect(mockJwtVerify).toHaveBeenCalledWith('valid-token', mockJwksGetter, {
      issuer: 'https://issuer.example.com',
      audience: 'ri-api',
    });
  });
});
