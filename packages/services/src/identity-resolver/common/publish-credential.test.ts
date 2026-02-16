import {
  buildPublishLinks,
  publishCredential,
  type BuildPublishLinksOptions,
  type PublishCredentialOptions,
} from './publish-credential.js';
import type { StorageRecord } from '../../storage/types.js';
import type { IIdentityResolverService, LinkRegistration } from '../types.js';
import type { UNTPVerifiableCredential } from '../../verifiable-credential/types.js';

// Mock constructVerifyURL so we don't depend on window.location or URL construction details
jest.mock('../../utils/helpers.js', () => ({
  ...jest.requireActual('../../utils/helpers.js'),
  constructVerifyURL: jest.fn(({ baseUrl, uri, hash }: { baseUrl: string; uri: string; hash: string }) => {
    return `${baseUrl}/verify?q=${encodeURIComponent(JSON.stringify({ payload: { uri, hash } }))}`;
  }),
}));
import { constructVerifyURL } from '../../utils/helpers.js';
const mockConstructVerifyURL = constructVerifyURL as jest.MockedFunction<typeof constructVerifyURL>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStorage(overrides: Partial<StorageRecord> = {}): StorageRecord {
  return {
    uri: 'https://storage.example.com/cred-123.json',
    hash: 'abc123hash',
    ...overrides,
  };
}

function makeCredential(overrides: Partial<Record<string, unknown>> = {}): UNTPVerifiableCredential {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    id: 'urn:uuid:test-cred',
    issuer: {
      type: ['CredentialIssuer'],
      id: 'did:web:example.com',
      name: 'Test Issuer',
    },
    credentialSubject: {
      type: ['Product'],
      id: 'https://example.com/product/1',
      registeredId: '09520123456788',
    },
    credentialStatus: {
      id: 'https://example.com/status/1#0',
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: 0,
      statusListCredential: 'https://example.com/status/1',
    },
    ...overrides,
  } as UNTPVerifiableCredential;
}

function makeMockIdrService(): jest.Mocked<IIdentityResolverService> {
  return {
    publishLinks: jest.fn(),
    getLinkById: jest.fn(),
    updateLink: jest.fn(),
    deleteLink: jest.fn(),
    getResolverDescription: jest.fn(),
    getLinkTypes: jest.fn(),
  };
}

// ── buildPublishLinks ────────────────────────────────────────────────────────

describe('buildPublishLinks', () => {
  const storage = makeStorage();
  const linkTitle = 'Digital Product Passport';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only 1 link (storage URI) when no verification URLs are provided', () => {
    const links = buildPublishLinks(storage, linkTitle);

    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      href: storage.uri,
      rel: 'gs1:sustainabilityInfo',
      type: 'application/json',
      title: linkTitle,
    });
  });

  it('returns 2 links (machine verification + storage URI) with only machineVerificationUrl', () => {
    const options: BuildPublishLinksOptions = {
      machineVerificationUrl: 'https://vckit.example.com/verify',
    };

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({
      href: 'https://vckit.example.com/verify',
      rel: 'gs1:verificationService',
      type: 'text/plain',
      title: 'VCKit verify service',
    });
    expect(links[1]).toEqual({
      href: storage.uri,
      rel: 'gs1:sustainabilityInfo',
      type: 'application/json',
      title: linkTitle,
    });
  });

  it('returns 2 links (storage URI + human verification) with only humanVerificationUrl', () => {
    const options: BuildPublishLinksOptions = {
      humanVerificationUrl: 'https://app.example.com',
    };

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({
      href: storage.uri,
      rel: 'gs1:sustainabilityInfo',
      type: 'application/json',
      title: linkTitle,
    });
    // Second link should be the human verification link
    expect(links[1].rel).toBe('gs1:sustainabilityInfo');
    expect(links[1].type).toBe('text/html');
    expect(links[1].title).toBe(linkTitle);
    expect(mockConstructVerifyURL).toHaveBeenCalledWith({
      baseUrl: 'https://app.example.com',
      uri: storage.uri,
      hash: storage.hash,
    });
  });

  it('returns 3 links when both verification URLs are provided', () => {
    const options: BuildPublishLinksOptions = {
      machineVerificationUrl: 'https://vckit.example.com/verify',
      humanVerificationUrl: 'https://app.example.com',
    };

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(3);
    // Order: machine verification, storage URI, human verification
    expect(links[0].rel).toBe('gs1:verificationService');
    expect(links[0].type).toBe('text/plain');
    expect(links[1].rel).toBe('gs1:sustainabilityInfo');
    expect(links[1].type).toBe('application/json');
    expect(links[2].rel).toBe('gs1:sustainabilityInfo');
    expect(links[2].type).toBe('text/html');
  });

  it('uses constructVerifyURL to build the human verification link href', () => {
    const options: BuildPublishLinksOptions = {
      humanVerificationUrl: 'https://app.example.com',
    };

    buildPublishLinks(storage, linkTitle, options);

    expect(mockConstructVerifyURL).toHaveBeenCalledTimes(1);
    expect(mockConstructVerifyURL).toHaveBeenCalledWith({
      baseUrl: 'https://app.example.com',
      uri: storage.uri,
      hash: storage.hash,
    });
  });

  it('returns only 1 link when options object is provided but both URLs are undefined', () => {
    const options: BuildPublishLinksOptions = {};

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(1);
    expect(links[0].href).toBe(storage.uri);
  });
});

// ── publishCredential ────────────────────────────────────────────────────────

describe('publishCredential', () => {
  let mockIdrService: jest.Mocked<IIdentityResolverService>;

  const baseOptions: PublishCredentialOptions = {
    namespace: 'gs1',
    identifierScheme: '01',
    verificationUrls: {
      machineVerificationUrl: 'https://vckit.example.com/verify',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIdrService = makeMockIdrService();
  });

  describe('happy path', () => {
    it('resolves identifier, builds links, publishes, and returns { enabled: true, registration }', async () => {
      const storage = makeStorage();
      const credential = makeCredential();
      const expectedRegistration: LinkRegistration = {
        resolverUri: 'https://resolver.example.com/gs1/01/09520123456788',
        identifierScheme: '01',
        identifier: '09520123456788',
        links: [],
      };
      mockIdrService.publishLinks.mockResolvedValue(expectedRegistration);

      const result = await publishCredential(mockIdrService, credential, storage, baseOptions);

      expect(result.enabled).toBe(true);
      if (result.enabled) {
        expect(result.registration).toEqual(expectedRegistration);
      }
    });

    it('passes correct arguments to idrService.publishLinks', async () => {
      const storage = makeStorage();
      const credential = makeCredential();
      mockIdrService.publishLinks.mockResolvedValue({
        resolverUri: 'https://resolver.example.com/gs1/01/09520123456788',
        identifierScheme: '01',
        identifier: '09520123456788',
        links: [],
      });

      await publishCredential(mockIdrService, credential, storage, baseOptions);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockIdrService.publishLinks).toHaveBeenCalledTimes(1);
      const [identifierScheme, identifier, links, qualifierPath, options] = mockIdrService.publishLinks.mock.calls[0];

      expect(identifierScheme).toBe('01');
      expect(identifier).toBe('09520123456788');
      expect(Array.isArray(links)).toBe(true);
      expect(qualifierPath).toBe('/');
      expect(options).toEqual({
        namespace: 'gs1',
        itemDescription: 'DigitalProductPassport',
      });
    });
  });

  describe('link title extraction', () => {
    it('uses second type entry as linkTitle when available', async () => {
      const storage = makeStorage();
      const credential = makeCredential({
        type: ['VerifiableCredential', 'DigitalConformityCredential'],
      });
      mockIdrService.publishLinks.mockResolvedValue({
        resolverUri: 'https://resolver.example.com/gs1/01/09520123456788',
        identifierScheme: '01',
        identifier: '09520123456788',
        links: [],
      });

      await publishCredential(mockIdrService, credential, storage, baseOptions);

      const [, , , , options] = mockIdrService.publishLinks.mock.calls[0];
      expect(options.itemDescription).toBe('DigitalConformityCredential');
    });

    it('falls back to "Product Passport" when type array has only "VerifiableCredential"', async () => {
      const storage = makeStorage();
      const credential = makeCredential({
        type: ['VerifiableCredential'],
      });
      mockIdrService.publishLinks.mockResolvedValue({
        resolverUri: 'https://resolver.example.com/gs1/01/09520123456788',
        identifierScheme: '01',
        identifier: '09520123456788',
        links: [],
      });

      await publishCredential(mockIdrService, credential, storage, baseOptions);

      const [, , , , options] = mockIdrService.publishLinks.mock.calls[0];
      expect(options.itemDescription).toBe('Product Passport');
    });
  });

  describe('validation errors', () => {
    it('throws when storage.uri is missing', async () => {
      const storage = makeStorage({ uri: '' });
      const credential = makeCredential();

      await expect(publishCredential(mockIdrService, credential, storage, baseOptions)).rejects.toThrow(
        'Storage response missing uri',
      );
    });

    it('throws when storage.uri is undefined', async () => {
      const storage = { hash: 'abc123hash' } as unknown as StorageRecord;

      await expect(publishCredential(mockIdrService, makeCredential(), storage, baseOptions)).rejects.toThrow(
        'Storage response missing uri',
      );
    });

    it('throws when storage.hash is missing', async () => {
      const storage = makeStorage({ hash: '' });
      const credential = makeCredential();

      await expect(publishCredential(mockIdrService, credential, storage, baseOptions)).rejects.toThrow(
        'Storage response missing hash',
      );
    });

    it('throws when storage.hash is undefined', async () => {
      const storage = { uri: 'https://storage.example.com/cred.json' } as unknown as StorageRecord;

      await expect(publishCredential(mockIdrService, makeCredential(), storage, baseOptions)).rejects.toThrow(
        'Storage response missing hash',
      );
    });

    it('throws when credentialSubject.registeredId is missing', async () => {
      const storage = makeStorage();
      const credential = makeCredential();
      // Remove registeredId from credentialSubject
      (credential.credentialSubject as Record<string, unknown>).registeredId = undefined;

      await expect(publishCredential(mockIdrService, credential, storage, baseOptions)).rejects.toThrow(
        'Missing credentialSubject.registeredId',
      );
    });

    it('throws when credentialSubject is missing entirely', async () => {
      const storage = makeStorage();
      const credential = makeCredential();
      // Remove credentialSubject
      delete (credential as Record<string, unknown>).credentialSubject;

      await expect(publishCredential(mockIdrService, credential, storage, baseOptions)).rejects.toThrow(
        'Missing credentialSubject.registeredId',
      );
    });
  });
});
