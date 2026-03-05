import { verifyCredential } from './verify-credential';

describe('verifyCredential', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = mockFetch;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('returns result when credential is verified', async () => {
    const responseBody = {
      verified: true,
      credential: { type: ['VerifiableCredential'], issuer: 'did:web:example' },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseBody,
    });

    const result = await verifyCredential({ uri: 'https://example.com/cred' });

    expect(result).toEqual(responseBody);
  });

  it('returns result including decodedCredential when present', async () => {
    const responseBody = {
      verified: true,
      credential: { type: ['VerifiableCredential'] },
      decodedCredential: { id: 'urn:uuid:123', type: ['VerifiableCredential'] },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseBody,
    });

    const result = await verifyCredential({ uri: 'https://example.com/cred' });

    expect(result).toEqual(responseBody);
    expect(result.decodedCredential).toBeDefined();
  });

  it('returns result without throwing when verified is false', async () => {
    const responseBody = {
      verified: false,
      credential: { type: ['VerifiableCredential'] },
      error: { type: 'INVALID_SIGNATURE', message: 'Signature verification failed' },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseBody,
    });

    const result = await verifyCredential({ uri: 'https://example.com/cred' });

    expect(result.verified).toBe(false);
    expect(result.error).toEqual({
      type: 'INVALID_SIGNATURE',
      message: 'Signature verification failed',
    });
  });

  it('throws on 400 validation error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'uri is required' }),
    });

    await expect(verifyCredential({ uri: '' })).rejects.toThrow('uri is required');
  });

  it('throws on 422 processing error with code', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'Credential hash does not match',
        code: 'HASH_MISMATCH',
      }),
    });

    await expect(verifyCredential({ uri: 'https://example.com/cred', hash: 'abc' })).rejects.toThrow(
      'Credential hash does not match (HASH_MISMATCH)',
    );
  });

  it('throws on 502 upstream error with code', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        error: 'Upstream service unavailable',
        code: 'UPSTREAM_ERROR',
      }),
    });

    await expect(verifyCredential({ uri: 'https://example.com/cred' })).rejects.toThrow(
      'Upstream service unavailable (UPSTREAM_ERROR)',
    );
  });

  it('throws on 500 server error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    });

    await expect(verifyCredential({ uri: 'https://example.com/cred' })).rejects.toThrow('Internal server error');
  });

  it('throws with connection message on network failure', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(verifyCredential({ uri: 'https://example.com/cred' })).rejects.toThrow(
      'Unable to connect to the verification service',
    );
  });

  it('throws meaningful error when error response is not valid JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    await expect(verifyCredential({ uri: 'https://example.com/cred' })).rejects.toThrow(
      'Verification request failed with status 502',
    );
  });

  it('sends correct request to the API', async () => {
    const params = {
      uri: 'https://example.com/cred',
      hash: 'sha256:abc123',
      decryptionKey: 'key123',
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ verified: true, credential: {} }),
    });

    await verifyCredential(params);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/credentials/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  });
});
