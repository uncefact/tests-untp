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

// The pinned transport is mocked wholesale: its own guard, pinning, redirect
// and size behaviour is covered by @uncefact/untp-utils' resolver suite, and
// its ESM build cannot be loaded by this package's CJS test runner. The
// factory's error classes stand in for the real hierarchy; production code
// resolves the same mocked module, so instanceof checks line up.
const mockResolveJsonDocument = jest.fn();
jest.mock('@uncefact/untp-utils/resolvers', () => {
  class ResolverError extends Error {}
  class ResolverHttpError extends ResolverError {
    readonly status: number;
    readonly url: string;
    constructor(url: string, status: number) {
      super(`${url} returned status ${status}.`);
      this.status = status;
      this.url = url;
    }
  }
  class ResolverInvalidJsonError extends ResolverError {
    readonly url: string;
    constructor(url: string) {
      super(`Response body for ${url} is not valid JSON.`);
      this.url = url;
    }
  }
  return {
    ResolverError,
    ResolverHttpError,
    ResolverInvalidJsonError,
    resolveJsonDocument: (...args: unknown[]) => mockResolveJsonDocument(...args),
  };
});

import { verifyDidWeb } from './verify-did-web';
import { DidVerificationCheckName } from '../types';

const { ResolverError, ResolverHttpError, ResolverInvalidJsonError } = jest.requireMock(
  '@uncefact/untp-utils/resolvers',
);

const C = DidVerificationCheckName;

function useRealGuardOnce(): void {
  mockValidatePublicUrl.mockImplementationOnce((url: string) => actualNode.validatePublicUrl(url));
}

function resolvedDoc(
  json: unknown,
  finalUrl = 'https://example.com/org/abc/did.json',
): { json: unknown; finalUrl: string } {
  return { json, finalUrl };
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
    mockResolveJsonDocument.mockReset();
    mockValidatePublicUrl.mockReset();
    mockValidatePublicUrl.mockResolvedValue({ address: '203.0.113.10', family: 4 });
  });

  it('resolves a valid did:web document over the pinned transport', async () => {
    mockResolveJsonDocument.mockResolvedValueOnce(resolvedDoc(validDidDocument));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.document).toEqual(validDidDocument);
    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(true);
    expect(mockResolveJsonDocument).toHaveBeenCalledWith('https://example.com/org/abc/did.json');
  });

  it('returns RESOLVE failure for HTTP error', async () => {
    mockResolveJsonDocument.mockRejectedValueOnce(new ResolverHttpError('https://example.com/org/abc/did.json', 404));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.document).toBeNull();
    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toContain('HTTP 404');
    // The error carries the final URL, so the HTTPS verdict is still stated.
    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(true);
    expect(httpsCheck?.message).toBeUndefined();
  });

  it('fails the HTTPS check when an HTTP error arrives over an insecure final URL', async () => {
    mockResolveJsonDocument.mockRejectedValueOnce(new ResolverHttpError('http://example.com/org/abc/did.json', 404));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(false);
    expect(httpsCheck?.message).toContain('insecure connection');
  });

  it('reports invalid JSON as a resolution failure while still judging HTTPS on the final URL', async () => {
    mockResolveJsonDocument.mockRejectedValueOnce(new ResolverInvalidJsonError('https://example.com/org/abc/did.json'));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.document).toBeNull();
    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toContain('not valid JSON');
    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(true);
  });

  it('maps a redirect-hop private rejection to the same not-permitted outcome as the pre-fetch guard', async () => {
    mockResolveJsonDocument.mockRejectedValueOnce(
      new actualNode.PrivateAddressError('internal.example.com', ['10.0.0.5']),
    );

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toBe('Private or localhost URLs are not permitted for DID resolution');
    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(false);
    expect(httpsCheck?.message).toBe('Could not verify HTTPS (resolution failed)');
  });

  it('maps a redirect-hop private-hostname rejection to the same not-permitted outcome', async () => {
    mockResolveJsonDocument.mockRejectedValueOnce(new actualNode.PrivateHostnameError('intranet.internal'));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toBe('Private or localhost URLs are not permitted for DID resolution');
  });

  it('maps a non-private redirect-hop guard rejection to a resolution failure', async () => {
    mockResolveJsonDocument.mockRejectedValueOnce(
      new actualNode.ResolutionFailedError('gone.example.com', new Error('ENOTFOUND')),
    );

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toContain('Resolution failed');
  });

  it('returns RESOLVE failure for network error', async () => {
    mockResolveJsonDocument.mockRejectedValueOnce(new ResolverError('Network error'));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    expect(result.document).toBeNull();
    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toContain('Resolution failed');
  });

  it('passes HTTPS check when final response URL is HTTPS', async () => {
    mockResolveJsonDocument.mockResolvedValueOnce(
      resolvedDoc(validDidDocument, 'https://example.com/org/abc/did.json'),
    );

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(true);
    expect(httpsCheck?.message).toBeUndefined();
  });

  it('fails HTTPS check when response was downgraded to HTTP', async () => {
    mockResolveJsonDocument.mockResolvedValueOnce(resolvedDoc(validDidDocument, 'http://example.com/org/abc/did.json'));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(false);
    expect(httpsCheck?.message).toContain('insecure connection');
  });

  it('fails HTTPS check when resolution fails (no response to verify)', async () => {
    mockResolveJsonDocument.mockRejectedValueOnce(new ResolverError('fail'));

    const result = await verifyDidWeb('did:web:example.com:org:abc');

    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(false);
    expect(httpsCheck?.message).toBe('Could not verify HTTPS (resolution failed)');
  });

  it('returns exactly two checks (RESOLVE and HTTPS)', async () => {
    mockResolveJsonDocument.mockResolvedValueOnce(resolvedDoc(validDidDocument));

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
      expect(mockResolveJsonDocument).not.toHaveBeenCalled();
    });

    it('blocks 127.x.x.x URLs', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:127.0.0.1');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(mockResolveJsonDocument).not.toHaveBeenCalled();
    });

    it('blocks 10.x.x.x URLs', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:10.0.0.1');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(mockResolveJsonDocument).not.toHaveBeenCalled();
    });

    it('blocks 192.168.x.x URLs', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:192.168.1.1');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(mockResolveJsonDocument).not.toHaveBeenCalled();
    });

    it('blocks the cloud metadata literal (missed by the previous in-package guard)', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:169.254.169.254');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(mockResolveJsonDocument).not.toHaveBeenCalled();
    });

    it('blocks an IPv6 unique-local literal (missed by the previous in-package guard)', async () => {
      useRealGuardOnce();
      const result = await verifyDidWeb('did:web:%5Bfd12%3A3456%3A789a%3A%3A1%5D');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(mockResolveJsonDocument).not.toHaveBeenCalled();
    });

    it('maps a private-hostname rejection to the not-permitted message', async () => {
      mockValidatePublicUrl.mockRejectedValueOnce(new actualNode.PrivateHostnameError('intranet.internal'));
      const result = await verifyDidWeb('did:web:intranet.internal');
      const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
      expect(resolveCheck?.passed).toBe(false);
      expect(resolveCheck?.message).toContain('not permitted');
      expect(mockResolveJsonDocument).not.toHaveBeenCalled();
    });

    it('rethrows errors outside the guard hierarchy instead of reporting a failed check', async () => {
      const bug = new TypeError('validatePublicUrl exploded');
      mockValidatePublicUrl.mockRejectedValueOnce(bug);
      await expect(verifyDidWeb('did:web:example.com')).rejects.toBe(bug);
      expect(mockResolveJsonDocument).not.toHaveBeenCalled();
    });

    it('rethrows transport errors outside the resolver hierarchy instead of reporting a failed check', async () => {
      const bug = new TypeError('resolveJsonDocument exploded');
      mockResolveJsonDocument.mockRejectedValueOnce(bug);
      await expect(verifyDidWeb('did:web:example.com')).rejects.toBe(bug);
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
      expect(mockResolveJsonDocument).not.toHaveBeenCalled();
    });
  });
});
