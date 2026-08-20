// This suite exercises the verification flow above the SSRF guard; the guard
// itself performs DNS resolution for hostnames, so it is mocked as
// always-public here. Guard behaviour is covered by verify-did-web.test.ts
// and the canonical suite in @uncefact/untp-utils.
jest.mock('@uncefact/untp-utils/node', () => ({
  ...jest.requireActual('@uncefact/untp-utils/node'),
  validatePublicUrl: jest.fn().mockResolvedValue({ address: '203.0.113.10', family: 4 }),
}));

// The pinned transport is mocked for the same reason (and because its ESM
// build cannot load under this package's CJS test runner); transport-level
// behaviour is covered by verify-did-web.test.ts and the resolver suite.
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

const { ResolverError: MockResolverError } = jest.requireMock('@uncefact/untp-utils/resolvers');

import { verifyDid } from './verify';
import { DidVerificationCheckName } from '../types';
import { DidInputError, DidMethodNotSupportedError } from '../errors';

// -- Helpers -----------------------------------------------------------------

function resolvedDoc(
  json: unknown,
  finalUrl = 'https://example.com/org/abc/did.json',
): { json: unknown; finalUrl: string } {
  return { json, finalUrl };
}

const C = DidVerificationCheckName;

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

// -- Tests -------------------------------------------------------------------

describe('verifyDid', () => {
  beforeEach(() => {
    mockResolveJsonDocument.mockReset();
  });

  it('returns verified=true for a valid DID document (all checks pass)', async () => {
    mockResolveJsonDocument.mockResolvedValueOnce(resolvedDoc(validDidDocument));

    const result = await verifyDid('did:web:example.com:org:abc', {
      providerKeys: [{ kid: 'abc123def456' }],
    });

    expect(result.verified).toBe(true);
    expect(result.checks).toHaveLength(6);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('returns structure failure when document is missing required fields', async () => {
    const badDoc = { id: 'did:web:example.com:org:abc' }; // missing @context
    mockResolveJsonDocument.mockResolvedValueOnce(resolvedDoc(badDoc));

    const result = await verifyDid('did:web:example.com:org:abc', { providerKeys: [] });

    expect(result.verified).toBe(false);
    const structureCheck = result.checks.find((c) => c.name === C.STRUCTURE);
    expect(structureCheck?.passed).toBe(false);
    expect(structureCheck?.message).toBeDefined();
  });

  it('returns identity_match failure for id mismatch', async () => {
    const mismatchDoc = { ...validDidDocument, id: 'did:web:other.com' };
    mockResolveJsonDocument.mockResolvedValueOnce(resolvedDoc(mismatchDoc));

    const result = await verifyDid('did:web:example.com:org:abc', { providerKeys: [] });

    expect(result.verified).toBe(false);
    const identityCheck = result.checks.find((c) => c.name === C.IDENTITY_MATCH);
    expect(identityCheck?.passed).toBe(false);
    expect(identityCheck?.message).toContain('does not match');
  });

  it('skips jsonld_validity check (expansion disabled)', async () => {
    mockResolveJsonDocument.mockResolvedValueOnce(resolvedDoc(validDidDocument));

    const result = await verifyDid('did:web:example.com:org:abc', { providerKeys: [] });

    const jsonldCheck = result.checks.find((c) => c.name === C.JSONLD_VALIDITY);
    expect(jsonldCheck?.passed).toBe(true);
    expect(jsonldCheck?.message).toContain('Skipped');
  });

  it('handles resolution failure gracefully', async () => {
    mockResolveJsonDocument.mockRejectedValueOnce(new MockResolverError('Network error'));

    const result = await verifyDid('did:web:example.com:org:abc', { providerKeys: [] });

    expect(result.verified).toBe(false);
    const resolveCheck = result.checks.find((c) => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toContain('Resolution failed');
  });

  it('throws DidInputError if DID string is empty', async () => {
    await expect(verifyDid('', { providerKeys: [] })).rejects.toThrow(DidInputError);
  });

  it('fails HTTPS check when resolution fails (no response to inspect)', async () => {
    mockResolveJsonDocument.mockRejectedValueOnce(new MockResolverError('Network error'));

    const result = await verifyDid('did:web:example.com:org:abc', { providerKeys: [] });

    const httpsCheck = result.checks.find((c) => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(false);
    expect(httpsCheck?.message).toBe('Could not verify HTTPS (resolution failed)');
  });

  it('passes key_material check with message when providerKeys is empty', async () => {
    mockResolveJsonDocument.mockResolvedValueOnce(resolvedDoc(validDidDocument));

    const result = await verifyDid('did:web:example.com:org:abc', {
      providerKeys: [],
    });

    const keyCheck = result.checks.find((c) => c.name === C.KEY_MATERIAL);
    expect(keyCheck).toBeDefined();
    expect(keyCheck?.passed).toBe(true);
    expect(keyCheck?.message).toBe('No provider keys to compare');
  });

  it('runs key_material check when providerKeys provided and keys match', async () => {
    mockResolveJsonDocument.mockResolvedValueOnce(resolvedDoc(validDidDocument));

    const result = await verifyDid('did:web:example.com:org:abc', {
      providerKeys: [{ kid: 'abc123def456' }],
    });

    const keyCheck = result.checks.find((c) => c.name === C.KEY_MATERIAL);
    expect(keyCheck).toBeDefined();
    expect(keyCheck?.passed).toBe(true);
  });

  it('returns key_material failure when keys do not match', async () => {
    mockResolveJsonDocument.mockResolvedValueOnce(resolvedDoc(validDidDocument));

    const result = await verifyDid('did:web:example.com:org:abc', {
      providerKeys: [{ kid: 'non-existent-key' }],
    });

    expect(result.verified).toBe(false);
    const keyCheck = result.checks.find((c) => c.name === C.KEY_MATERIAL);
    expect(keyCheck?.passed).toBe(false);
    expect(keyCheck?.message).toBe('No matching keys found in DID document');
  });

  it('throws DidMethodNotSupportedError for unsupported DID method', async () => {
    await expect(
      verifyDid('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK', { providerKeys: [] }),
    ).rejects.toThrow(DidMethodNotSupportedError);
  });
});
