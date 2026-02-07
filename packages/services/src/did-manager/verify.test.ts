import { verifyDid } from './verify';
import { DidVerificationCheckName } from './types';
import * as jsonld from 'jsonld';

jest.mock('jsonld', () => ({
  toRDF: jest.fn(),
}));

// -- Helpers -----------------------------------------------------------------

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
    global.fetch = jest.fn();
    (jsonld.toRDF as jest.Mock).mockResolvedValue([{}]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns verified=true for a valid DID document (all checks pass)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(validDidDocument));

    const result = await verifyDid('did:web:example.com:org:abc', {
      providerKeys: [{ kid: 'abc123def456' }],
    });

    expect(result.verified).toBe(true);
    expect(result.checks).toHaveLength(6);
    expect(result.checks.every(c => c.passed)).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('returns structure failure when document is missing required fields', async () => {
    const badDoc = { id: 'did:web:example.com:org:abc' }; // missing @context
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(badDoc));

    const result = await verifyDid('did:web:example.com:org:abc', { providerKeys: [] });

    expect(result.verified).toBe(false);
    const structureCheck = result.checks.find(c => c.name === C.STRUCTURE);
    expect(structureCheck?.passed).toBe(false);
    expect(structureCheck?.message).toBeDefined();
  });

  it('returns identity_match failure for id mismatch', async () => {
    const mismatchDoc = { ...validDidDocument, id: 'did:web:other.com' };
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(mismatchDoc));

    const result = await verifyDid('did:web:example.com:org:abc', { providerKeys: [] });

    expect(result.verified).toBe(false);
    const identityCheck = result.checks.find(c => c.name === C.IDENTITY_MATCH);
    expect(identityCheck?.passed).toBe(false);
    expect(identityCheck?.message).toContain('does not match');
  });

  it('returns jsonld_validity failure when expansion fails', async () => {
    (jsonld.toRDF as jest.Mock).mockRejectedValueOnce(
      new Error('Dereferencing a URL did not result in a valid JSON-LD context'),
    );
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(validDidDocument));

    const result = await verifyDid('did:web:example.com:org:abc', { providerKeys: [] });

    expect(result.verified).toBe(false);
    const jsonldCheck = result.checks.find(c => c.name === C.JSONLD_VALIDITY);
    expect(jsonldCheck?.passed).toBe(false);
    expect(jsonldCheck?.message).toContain('JSON-LD');
  });

  it('handles resolution failure gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await verifyDid('did:web:example.com:org:abc', { providerKeys: [] });

    expect(result.verified).toBe(false);
    const resolveCheck = result.checks.find(c => c.name === C.RESOLVE);
    expect(resolveCheck?.passed).toBe(false);
    expect(resolveCheck?.message).toContain('Resolution failed');
  });

  it('throws if DID string is empty', async () => {
    await expect(verifyDid('', { providerKeys: [] })).rejects.toThrow('DID string is required');
  });

  it('fails HTTPS check when resolution fails (no response to inspect)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await verifyDid('did:web:example.com:org:abc', { providerKeys: [] });

    const httpsCheck = result.checks.find(c => c.name === C.HTTPS);
    expect(httpsCheck?.passed).toBe(false);
    expect(httpsCheck?.message).toBe('Could not verify HTTPS (resolution failed)');
  });

  it('passes key_material check with message when providerKeys is empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(validDidDocument));

    const result = await verifyDid('did:web:example.com:org:abc', {
      providerKeys: [],
    });

    const keyCheck = result.checks.find(c => c.name === C.KEY_MATERIAL);
    expect(keyCheck).toBeDefined();
    expect(keyCheck?.passed).toBe(true);
    expect(keyCheck?.message).toBe('No provider keys to compare');
  });

  it('runs key_material check when providerKeys provided and keys match', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(validDidDocument));

    const result = await verifyDid('did:web:example.com:org:abc', {
      providerKeys: [{ kid: 'abc123def456' }],
    });

    const keyCheck = result.checks.find(c => c.name === C.KEY_MATERIAL);
    expect(keyCheck).toBeDefined();
    expect(keyCheck?.passed).toBe(true);
  });

  it('returns key_material failure when keys do not match', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createMockResponse(validDidDocument));

    const result = await verifyDid('did:web:example.com:org:abc', {
      providerKeys: [{ kid: 'non-existent-key' }],
    });

    expect(result.verified).toBe(false);
    const keyCheck = result.checks.find(c => c.name === C.KEY_MATERIAL);
    expect(keyCheck?.passed).toBe(false);
    expect(keyCheck?.message).toBe('No matching keys found in DID document');
  });

  it('throws for unsupported DID method', async () => {
    await expect(
      verifyDid('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK', { providerKeys: [] }),
    ).rejects.toThrow('Unsupported DID method: key');
  });
});
