// `validatePublicUrl` performs DNS resolution for hostnames, which tests must
// not depend on. The default mock treats every URL as public; the SSRF cases
// call through to the real implementation, which classifies IP literals and
// known-private hostnames without touching DNS.
const actualNode = jest.requireActual('@uncefact/untp-utils/node');
const mockValidatePublicUrl = jest.fn();
jest.mock('@uncefact/untp-utils/node', () => ({
  ...jest.requireActual('@uncefact/untp-utils/node'),
  validatePublicUrl: (...args: unknown[]) => mockValidatePublicUrl(...args),
}));

import { verifyDidWeb } from './verify-did-web';
import { DidVerificationCheckName } from '../types';

function useRealGuardOnce(): void {
  mockValidatePublicUrl.mockImplementationOnce((url: string) => actualNode.validatePublicUrl(url));
}

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
    mockValidatePublicUrl.mockReset();
    mockValidatePublicUrl.mockResolvedValue({ address: '203.0.113.10', family: 4 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves a valid did:web document', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(validDidDocument));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.document).toEqual(validDidDocument);
    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(true);
  });

  it('returns RESOLVE failure for HTTP error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(null, false, 404));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.document).toBeNull();
    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toContain('HTTP 404');
  });

  it('returns RESOLVE failure for network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.document).toBeNull();
    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toContain('Resolution failed');
  });

  it('passes HTTPS check when final response URL is HTTPS', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      createMockResponse(validDidDocument, true, 200, 'https://example.com/org/abc/did.json'),
    );

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(true);
    expect(httpsCheck?.message).toBeUndefined();
  });

  it('fails HTTPS check when response was downgraded to HTTP', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      createMockResponse(validDidDocument, true, 200, 'http://example.com/org/abc/did.json'),
    );

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(false);
    expect(httpsCheck?.message).toContain('insecure connection');
  });

  it('fails HTTPS check when resolution fails (no response to verify)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('fail'));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(false);
    expect(httpsCheck?.message).toBe('Could not verify HTTPS (resolution failed)');
  });

  it('returns exactly two checks (RESOLVE and HTTPS)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(validDidDocument));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.checks).toHaveLength(2);
    expect(result.checks.map((c) => c.name)).toEqual([C.RESOLVE, C.HTTPS]);
  });

  describe('SSRF protection', () => {
    it('blocks localhost URLs', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:localhost');
      expect(result.document).toBeNull();
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks 127.x.x.x URLs', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:127.0.0.1');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks 10.x.x.x URLs', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:10.0.0.1');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks 192.168.x.x URLs', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:192.168.1.1');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks the cloud metadata literal (missed by the previous in-package guard)', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:169.254.169.254');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks an IPv6 unique-local literal (missed by the previous in-package guard)', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:%5Bfd12%3A3456%3A789a%3A%3A1%5D');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('maps a private-hostname rejection to the not-permitted message', async () => {
      mockValidatePublicUrl.mockRejectedValueOnce(new actualNode.PrivateHostnameError('intranet.internal'));
      const result = await verifyDidWeb('did:web:intranet.internal');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rethrows errors outside the guard hierarchy instead of reporting a failed check', async () => {
      const bug = new TypeError('validatePublicUrl exploded');
      mockValidatePublicUrl.mockRejectedValueOnce(bug);
      await expect(verifyDidWeb('did:web:example.com')).rejects.toBe(bug);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('surfaces a non-private guard failure with the structured error message', async () => {
      mockValidatePublicUrl.mockRejectedValueOnce(
        new actualNode.ResolutionFailedError('nonexistent.example.com', new Error('ENOTFOUND')),
      );
      const result = await verifyDidWeb('did:web:nonexistent.example.com');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('DID resolution URL rejected');
      const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
      expect(httpsCheck?.passed).toBe(false);
      expect(httpsCheck?.message).toBe('Could not verify HTTPS (resolution blocked)');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
