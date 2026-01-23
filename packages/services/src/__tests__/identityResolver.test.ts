import { IdentityResolverService, IdentityResolverConfig, locales } from '../identityResolver';
import { privateAPI } from '../utils/httpService';
import type { Link } from '../interfaces/identityResolverService';

jest.mock('../utils/httpService', () => ({
  privateAPI: {
    post: jest.fn(),
    setBearerTokenAuthorizationHeaders: jest.fn(),
  },
}));

describe('IdentityResolverService', () => {
  const mockConfig: IdentityResolverConfig = {
    apiUrl: 'https://resolver.example.com',
    apiKey: 'test-api-key',
  };

  const mockLinks: Link[] = [
    {
      href: 'https://storage.example.com/dpp-123.json',
      rel: 'untp:dpp',
      type: 'application/ld+json',
      title: 'Digital Product Passport',
      hreflang: ['en'],
      default: true,
    },
    {
      href: 'https://storage.example.com/dcc-456.json',
      rel: 'untp:dcc',
      type: 'application/ld+json',
      title: 'Conformity Certificate',
      hreflang: ['de'],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance with valid configuration', () => {
      const service = new IdentityResolverService(mockConfig);
      expect(service).toBeInstanceOf(IdentityResolverService);
    });

    it('should throw an error when apiUrl is missing', () => {
      const invalidConfig = { apiKey: 'test-key' } as IdentityResolverConfig;
      expect(() => new IdentityResolverService(invalidConfig)).toThrow(
        'IdentityResolverService requires apiUrl and apiKey in configuration',
      );
    });

    it('should throw an error when apiKey is missing', () => {
      const invalidConfig = { apiUrl: 'https://resolver.example.com' } as IdentityResolverConfig;
      expect(() => new IdentityResolverService(invalidConfig)).toThrow(
        'IdentityResolverService requires apiUrl and apiKey in configuration',
      );
    });

    it('should throw an error when both apiUrl and apiKey are missing', () => {
      const invalidConfig = {} as IdentityResolverConfig;
      expect(() => new IdentityResolverService(invalidConfig)).toThrow(
        'IdentityResolverService requires apiUrl and apiKey in configuration',
      );
    });
  });

  describe('publishLinks', () => {
    it('should successfully publish links and return registration details', async () => {
      jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({});

      const service = new IdentityResolverService(mockConfig);
      const result = await service.publishLinks('abn', '51824753556', mockLinks);

      expect(result).toEqual({
        resolverUri: 'https://resolver.example.com/abn/abn/51824753556',
        identifierScheme: 'abn',
        identifier: '51824753556',
      });
    });

    it('should set bearer token authorization header', async () => {
      jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({});

      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      expect(privateAPI.setBearerTokenAuthorizationHeaders).toHaveBeenCalledWith('test-api-key');
    });

    it('should call the API with correct URL when no linkRegisterPath is provided', async () => {
      jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({});

      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      expect(privateAPI.post).toHaveBeenCalledWith(
        'https://resolver.example.com',
        expect.any(Object),
      );
    });

    it('should call the API with correct URL when linkRegisterPath is provided', async () => {
      jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({});

      const configWithPath: IdentityResolverConfig = {
        ...mockConfig,
        linkRegisterPath: 'register',
      };
      const service = new IdentityResolverService(configWithPath);
      await service.publishLinks('abn', '51824753556', mockLinks);

      expect(privateAPI.post).toHaveBeenCalledWith(
        'https://resolver.example.com/register',
        expect.any(Object),
      );
    });

    it('should use identifierScheme as namespace when namespace is not provided', async () => {
      let capturedPayload: any;
      jest.spyOn(privateAPI, 'post').mockImplementation((url, payload) => {
        capturedPayload = payload;
        return Promise.resolve({});
      });

      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      expect(capturedPayload.namespace).toBe('abn');
    });

    it('should use provided namespace when configured', async () => {
      let capturedPayload: any;
      jest.spyOn(privateAPI, 'post').mockImplementation((url, payload) => {
        capturedPayload = payload;
        return Promise.resolve({});
      });

      const configWithNamespace: IdentityResolverConfig = {
        ...mockConfig,
        namespace: 'custom-namespace',
      };
      const service = new IdentityResolverService(configWithNamespace);
      await service.publishLinks('abn', '51824753556', mockLinks);

      expect(capturedPayload.namespace).toBe('custom-namespace');
    });

    it('should construct correct payload structure', async () => {
      let capturedPayload: any;
      jest.spyOn(privateAPI, 'post').mockImplementation((url, payload) => {
        capturedPayload = payload;
        return Promise.resolve({});
      });

      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      expect(capturedPayload).toMatchObject({
        namespace: 'abn',
        identificationKey: '51824753556',
        identificationKeyType: 'abn',
        itemDescription: 'Digital Product Passport',
        qualifierPath: '/',
        active: true,
      });
      expect(capturedPayload.responses).toBeDefined();
      expect(Array.isArray(capturedPayload.responses)).toBe(true);
    });

    it('should create responses for each locale', async () => {
      let capturedPayload: any;
      jest.spyOn(privateAPI, 'post').mockImplementation((url, payload) => {
        capturedPayload = payload;
        return Promise.resolve({});
      });

      const service = new IdentityResolverService(mockConfig);
      const singleLink: Link[] = [mockLinks[0]];
      await service.publishLinks('abn', '51824753556', singleLink);

      // Should have one response per locale for each link
      expect(capturedPayload.responses.length).toBe(locales.length);

      const contexts = capturedPayload.responses.map((r: any) => r.context);
      expect(contexts).toContain('us');
      expect(contexts).toContain('au');
    });

    it('should correctly convert link properties to response format', async () => {
      let capturedPayload: any;
      jest.spyOn(privateAPI, 'post').mockImplementation((url, payload) => {
        capturedPayload = payload;
        return Promise.resolve({});
      });

      const service = new IdentityResolverService(mockConfig);
      const singleLink: Link[] = [mockLinks[0]];
      await service.publishLinks('abn', '51824753556', singleLink);

      const firstResponse = capturedPayload.responses[0];
      expect(firstResponse).toMatchObject({
        linkType: 'untp:dpp',
        linkTitle: 'Digital Product Passport',
        targetUrl: 'https://storage.example.com/dpp-123.json',
        mimeType: 'application/ld+json',
        title: 'Digital Product Passport',
        ianaLanguage: 'en',
        active: true,
        defaultLinkType: true,
        defaultIanaLanguage: true,
        defaultContext: false,
        defaultMimeType: true,
        fwqs: false,
      });
    });

    it('should add namespace prefix to rel when not already prefixed', async () => {
      let capturedPayload: any;
      jest.spyOn(privateAPI, 'post').mockImplementation((url, payload) => {
        capturedPayload = payload;
        return Promise.resolve({});
      });

      const linkWithoutPrefix: Link[] = [
        {
          href: 'https://example.com/resource',
          rel: 'dpp',
          type: 'application/json',
          title: 'Test Link',
        },
      ];

      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', linkWithoutPrefix);

      expect(capturedPayload.responses[0].linkType).toBe('abn:dpp');
    });

    it('should preserve rel when already prefixed with colon', async () => {
      let capturedPayload: any;
      jest.spyOn(privateAPI, 'post').mockImplementation((url, payload) => {
        capturedPayload = payload;
        return Promise.resolve({});
      });

      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      // untp:dpp already has a colon, should be preserved
      expect(capturedPayload.responses[0].linkType).toBe('untp:dpp');
    });

    it('should use default language "en" when hreflang is not provided', async () => {
      let capturedPayload: any;
      jest.spyOn(privateAPI, 'post').mockImplementation((url, payload) => {
        capturedPayload = payload;
        return Promise.resolve({});
      });

      const linkWithoutLang: Link[] = [
        {
          href: 'https://example.com/resource',
          rel: 'untp:dpp',
          type: 'application/json',
          title: 'Test Link',
        },
      ];

      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', linkWithoutLang);

      expect(capturedPayload.responses[0].ianaLanguage).toBe('en');
    });

    it('should use first hreflang when provided', async () => {
      let capturedPayload: any;
      jest.spyOn(privateAPI, 'post').mockImplementation((url, payload) => {
        capturedPayload = payload;
        return Promise.resolve({});
      });

      const service = new IdentityResolverService(mockConfig);
      // mockLinks[1] has hreflang: ['de']
      await service.publishLinks('abn', '51824753556', [mockLinks[1]]);

      expect(capturedPayload.responses[0].ianaLanguage).toBe('de');
    });

    it('should set default flags to false when link.default is not set', async () => {
      let capturedPayload: any;
      jest.spyOn(privateAPI, 'post').mockImplementation((url, payload) => {
        capturedPayload = payload;
        return Promise.resolve({});
      });

      const service = new IdentityResolverService(mockConfig);
      // mockLinks[1] does not have default: true
      await service.publishLinks('abn', '51824753556', [mockLinks[1]]);

      expect(capturedPayload.responses[0].defaultLinkType).toBe(false);
      expect(capturedPayload.responses[0].defaultIanaLanguage).toBe(false);
      expect(capturedPayload.responses[0].defaultMimeType).toBe(false);
    });

    describe('validation errors', () => {
      it('should throw an error when identifierScheme is empty', async () => {
        const service = new IdentityResolverService(mockConfig);

        await expect(service.publishLinks('', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to publish links: identifierScheme is required',
        );
      });

      it('should throw an error when identifier is empty', async () => {
        const service = new IdentityResolverService(mockConfig);

        await expect(service.publishLinks('abn', '', mockLinks)).rejects.toThrow(
          'Failed to publish links: identifier is required',
        );
      });

      it('should throw an error when links array is empty', async () => {
        const service = new IdentityResolverService(mockConfig);

        await expect(service.publishLinks('abn', '51824753556', [])).rejects.toThrow(
          'Failed to publish links: at least one link is required',
        );
      });

      it('should throw an error when links is null', async () => {
        const service = new IdentityResolverService(mockConfig);

        await expect(
          service.publishLinks('abn', '51824753556', null as unknown as Link[]),
        ).rejects.toThrow('Failed to publish links: at least one link is required');
      });

      it('should throw an error when links is undefined', async () => {
        const service = new IdentityResolverService(mockConfig);

        await expect(
          service.publishLinks('abn', '51824753556', undefined as unknown as Link[]),
        ).rejects.toThrow('Failed to publish links: at least one link is required');
      });
    });

    describe('API error handling', () => {
      it('should throw an error with message when API call fails', async () => {
        const apiError = new Error('Network error');
        jest.spyOn(privateAPI, 'post').mockRejectedValueOnce(apiError);

        const service = new IdentityResolverService(mockConfig);

        await expect(service.publishLinks('abn', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to register links with identity resolver for identifier 51824753556: Network error',
        );
      });

      it('should handle non-Error exceptions', async () => {
        jest.spyOn(privateAPI, 'post').mockRejectedValueOnce('String error');

        const service = new IdentityResolverService(mockConfig);

        await expect(service.publishLinks('abn', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to register links with identity resolver for identifier 51824753556: Unknown error',
        );
      });
    });
  });

  describe('locales', () => {
    it('should export locales array with expected values', () => {
      expect(locales).toEqual(['us', 'au']);
    });
  });
});
