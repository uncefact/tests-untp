import { VCKitDidAdapter, vckitDidRegistryEntry } from './vckit-did.adapter';
import { vckitDidConfigSchema } from './vckit-did.schema';
import { DidMethod, DidType } from '../../types';
import { verifyDid } from '../../verify';
import type { LoggerService } from '../../../logging/types';

jest.mock('../../verify.js', () => ({
  verifyDid: jest.fn(),
}));

// -- Helpers -----------------------------------------------------------------

function createMockResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

const BASE_URL = 'http://localhost:3332';
const HEADERS = { Authorization: 'Bearer test-token' };

const mockLogger: LoggerService = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

// -- Tests -------------------------------------------------------------------

describe('VCKitDidAdapter', () => {
  let service: VCKitDidAdapter;

  beforeEach(() => {
    service = new VCKitDidAdapter(BASE_URL, HEADERS);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Constructor tests
  describe('constructor', () => {
    it('creates instance with valid parameters', () => {
      expect(service.baseURL).toBe(BASE_URL);
      expect(service.headers).toEqual(HEADERS);
      expect(service.keyType).toBe('Ed25519');
    });

    it('throws if baseURL is empty', () => {
      expect(() => new VCKitDidAdapter('', HEADERS)).toThrow('API URL is required');
    });

    it('throws if Authorization header is missing', () => {
      expect(() => new VCKitDidAdapter(BASE_URL, {})).toThrow('Authorization header is required');
    });
  });

  // create() tests
  describe('create', () => {
    const vckitCreateResponse = {
      did: 'did:web:example.com:org:123',
      alias: 'test-alias',
      controllerKeyId: 'key-1',
    };

    const didDocument = {
      '@context': [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/suites/ed25519-2020/v1',
        'https://w3id.org/security/suites/jws-2020/v1',
      ],
      id: 'did:web:example.com:org:123',
      verificationMethod: [
        {
          id: 'did:web:example.com:org:123#key-1',
          type: 'Ed25519VerificationKey2020',
          controller: 'did:web:example.com:org:123',
          publicKeyMultibase: 'z6MktestPublicKeyMultibase123',
        },
      ],
    };

    function mockCreateAndResolve() {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(createMockResponse(vckitCreateResponse))
        .mockResolvedValueOnce(createMockResponse({ didDocument }));
    }

    it('sends correct payload and returns DidRecord with document', async () => {
      mockCreateAndResolve();

      const result = await service.create({
        type: DidType.MANAGED,
        method: DidMethod.DID_WEB,
        alias: 'test-org',
        name: 'test-alias',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/agent/didManagerCreate`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: expect.stringContaining('"provider":"did:web"'),
        }),
      );

      expect(result.did).toBe('did:web:example.com:org:123');
      expect(result.keyId).toBe('key-1');
      expect(result.document).toEqual(didDocument);
    });

    it('uses keyType from config', async () => {
      mockCreateAndResolve();

      await service.create({ type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test-org' });

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.options.keyType).toBe('Ed25519');
    });

    it('throws for DID_WEB_VH method', async () => {
      await expect(
        service.create({ type: DidType.MANAGED, method: DidMethod.DID_WEB_VH, alias: 'test-org' }),
      ).rejects.toThrow('not yet supported');
    });

    it('handles HTTP errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(createMockResponse({}, false, 500));

      await expect(
        service.create({ type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test-org' }),
      ).rejects.toThrow('Failed to create DID');
    });

    it('handles network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(
        service.create({ type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test-org' }),
      ).rejects.toThrow('Failed to create DID: Network error');
    });

    it('passes the alias through to the payload as-is', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(createMockResponse({ did: 'did:web:example.com:my-org', controllerKeyId: 'key-1' }))
        .mockResolvedValueOnce(
          createMockResponse({
            didDocument: {
              '@context': [
                'https://www.w3.org/ns/did/v1',
                'https://w3id.org/security/suites/ed25519-2020/v1',
                'https://w3id.org/security/suites/jws-2020/v1',
              ],
              id: 'did:web:example.com:my-org',
              verificationMethod: [],
            },
          }),
        );

      await service.create({
        type: DidType.MANAGED,
        method: DidMethod.DID_WEB,
        alias: 'my-org',
      });

      const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(payload.alias).toBe('my-org');
    });
  });

  // getDocument() tests
  describe('getDocument', () => {
    const didDocument = {
      '@context': [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/suites/ed25519-2020/v1',
        'https://w3id.org/security/suites/jws-2020/v1',
      ],
      id: 'did:web:example.com:org:abc',
      verificationMethod: [
        {
          id: 'did:web:example.com:org:abc#key-1',
          type: 'Ed25519VerificationKey2020',
          controller: 'did:web:example.com:org:abc',
          publicKeyMultibase: 'z6MktestPublicKeyMultibase123',
        },
      ],
    };

    it('sets Host header from DID domain', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(createMockResponse({ didDocument }));

      await service.getDocument('did:web:example.com:org:abc');

      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/agent/resolveDid`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Host: 'example.com',
            Origin: 'https://example.com',
          }),
        }),
      );
    });

    it('returns the DID document', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(createMockResponse({ didDocument }));

      const result = await service.getDocument('did:web:example.com:org:abc');
      expect(result).toEqual(didDocument);
    });

    it('throws if DID string is empty', async () => {
      await expect(service.getDocument('')).rejects.toThrow('DID string is required');
    });
  });

  // verify() delegation test
  describe('verify', () => {
    it('delegates to verifyDid with provider keys from VCKit', async () => {
      const mockResult = { verified: true, checks: [], errors: undefined };
      (verifyDid as jest.Mock).mockResolvedValue(mockResult);
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createMockResponse({ keys: [{ kid: 'key-1' }, { kid: 'key-2' }] }),
      );

      const result = await service.verify('did:web:example.com');

      // Should have fetched keys from VCKit
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/agent/didManagerGet`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ did: 'did:web:example.com' }),
        }),
      );

      // Should delegate to verifyDid with the DID and provider keys
      expect(verifyDid).toHaveBeenCalledWith('did:web:example.com', {
        providerKeys: [{ kid: 'key-1' }, { kid: 'key-2' }],
      });

      expect(result).toEqual(mockResult);
    });

    it('throws if DID string is empty', async () => {
      await expect(service.verify('')).rejects.toThrow('DID string is required for verification');
    });

    it('passes empty providerKeys when VCKit key fetch fails', async () => {
      const mockResult = { verified: true, checks: [], errors: undefined };
      (verifyDid as jest.Mock).mockResolvedValue(mockResult);
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await service.verify('did:web:example.com');

      expect(verifyDid).toHaveBeenCalledWith('did:web:example.com', {
        providerKeys: [],
      });
    });
  });

  describe('normaliseAlias', () => {
    it('normalises a did:web alias', () => {
      expect(service.normaliseAlias('My Org', DidMethod.DID_WEB)).toBe('my-org');
    });

    it('throws for invalid alias that normalises to empty', () => {
      expect(() => service.normaliseAlias('!!!', DidMethod.DID_WEB)).toThrow('empty identifier');
    });

    it('throws for did:webvh (not yet supported)', () => {
      expect(() => service.normaliseAlias('test', DidMethod.DID_WEB_VH)).toThrow('not yet supported');
    });
  });

  describe('getSupportedTypes', () => {
    it('returns MANAGED and SELF_MANAGED', () => {
      expect(service.getSupportedTypes()).toEqual(['MANAGED', 'SELF_MANAGED']);
    });
  });

  describe('getSupportedMethods', () => {
    it('returns DID_WEB', () => {
      expect(service.getSupportedMethods()).toEqual(['DID_WEB']);
    });
  });

  describe('getSupportedKeyTypes', () => {
    it('returns supported key types', () => {
      expect(service.getSupportedKeyTypes()).toEqual(['Ed25519']);
    });
  });

  describe('vckitDidConfigSchema', () => {
    it('defaults apiVersion to 1.1.0', () => {
      const result = vckitDidConfigSchema.parse({
        endpoint: 'https://vckit.example.com',
        authToken: 'token',
      });
      expect(result.apiVersion).toBe('1.1.0');
    });
  });

  describe('vckitDidRegistryEntry', () => {
    it('factory creates an adapter using Logger', () => {
      const config = vckitDidConfigSchema.parse({
        endpoint: 'https://vckit.example.com',
        authToken: 'my-token',
      });
      const adapter = vckitDidRegistryEntry.factory(config, mockLogger);
      expect(adapter).toBeInstanceOf(VCKitDidAdapter);
    });
  });
});
