import { verifyDidWeb } from './verify-did-web';
import { DidVerificationCheckName } from './types';

const C = DidVerificationCheckName;

function createMockResponse(
  data: unknown,
  ok = true,
  status = 200,
  responseUrl = 'https://example.com/.well-known/did.json',
): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    url: responseUrl,
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

const validDidDocument = {
  '@context': [
    'https://www.w3.org/ns/did/v1',
    'https://w3id.org/security/suites/ed25519-2020/v1',
    'https://w3id.org/security/suites/jws-2020/v1',
  ],
  id: 'did:web:example.com:org:abc',
  verificationMethod: [
    {
      id: 'did:web:example.com:org:abc#abc123def456',
      type: 'Ed25519VerificationKey2020',
      controller: 'did:web:example.com:org:abc',
      publicKeyMultibase: 'z6MktestPublicKeyMultibase123',
    },
    {
      id: 'did:web:example.com:org:abc#abc123def456-key-0',
      type: 'JsonWebKey2020',
      controller: 'did:web:example.com:org:abc',
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'dGVzdC1wdWJsaWMta2V5' },
    },
    {
      id: 'did:web:example.com:org:abc#abc123def456-key-1',
      type: 'JsonWebKey',
      controller: 'did:web:example.com:org:abc',
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'dGVzdC1wdWJsaWMta2V5' },
    },
  ],
  authentication: [
    'did:web:example.com:org:abc#abc123def456',
    'did:web:example.com:org:abc#abc123def456-key-0',
    'did:web:example.com:org:abc#abc123def456-key-1',
  ],
  assertionMethod: [
    'did:web:example.com:org:abc#abc123def456',
    'did:web:example.com:org:abc#abc123def456-key-0',
    'did:web:example.com:org:abc#abc123def456-key-1',
  ],
};

describe('verifyDidWeb', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves a valid did:web document', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(validDidDocument));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.document).toEqual(validDidDocument);
    const resolveCheck = result.checks.find(c => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(true);
  });

  it('returns RESOLVE failure for HTTP error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(null, false, 404));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.document).toBeNull();
    const resolveCheck = result.checks.find(c => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toContain('HTTP 404');
  });

  it('returns RESOLVE failure for network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.document).toBeNull();
    const resolveCheck = result.checks.find(c => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toContain('Resolution failed');
  });

  it('passes HTTPS check when final response URL is HTTPS', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      createMockResponse(validDidDocument, true, 200, 'https://example.com/org/abc/did.json'),
    );

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const httpsCheck = result.checks.find(c => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(true);
    expect(httpsCheck?.message).toBeUndefined();
  });

  it('fails HTTPS check when response was downgraded to HTTP', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      createMockResponse(validDidDocument, true, 200, 'http://example.com/org/abc/did.json'),
    );

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const httpsCheck = result.checks.find(c => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(false);
    expect(httpsCheck?.message).toContain('insecure connection');
  });

  it('fails HTTPS check when resolution fails (no response to verify)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('fail'));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const httpsCheck = result.checks.find(c => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(false);
    expect(httpsCheck?.message).toBe('Could not verify HTTPS (resolution failed)');
  });

  it('returns exactly two checks (RESOLVE and HTTPS)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(validDidDocument));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.checks).toHaveLength(2);
    expect(result.checks.map(c => c.name)).toEqual([C.RESOLVE, C.HTTPS]);
  });

  describe('SSRF protection', () => {
    it('blocks localhost URLs', async () => {
      const result = await verifyDidWeb('did:web:localhost');
      expect(result.document).toBeNull();
      const resolveCheck = result.checks.find(c => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
    });

    it('blocks 127.x.x.x URLs', async () => {
      const result = await verifyDidWeb('did:web:127.0.0.1');
      const resolveCheck = result.checks.find(c => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
    });

    it('blocks 10.x.x.x URLs', async () => {
      const result = await verifyDidWeb('did:web:10.0.0.1');
      const resolveCheck = result.checks.find(c => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
    });

    it('blocks 192.168.x.x URLs', async () => {
      const result = await verifyDidWeb('did:web:192.168.1.1');
      const resolveCheck = result.checks.find(c => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
    });
  });
});
