import { IdentityResolverService, IdentityResolverConfig, locales } from './identityResolver.adapter';
import type { Link } from '../../interfaces/identityResolverService';

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

  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      const service = new IdentityResolverService(mockConfig);
      const result = await service.publishLinks('abn', '51824753556', mockLinks);

      expect(result).toEqual({
        resolverUri: 'https://resolver.example.com/abn/abn/51824753556',
        identifierScheme: 'abn',
        identifier: '51824753556',
      });
    });

    it('should set bearer token authorization header', async () => {
      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should call the API with correct URL when no linkRegisterPath is provided', async () => {
      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com',
        expect.any(Object),
      );
    });

    it('should call the API with correct URL when linkRegisterPath is provided', async () => {
      const configWithPath: IdentityResolverConfig = {
        ...mockConfig,
        linkRegisterPath: 'register',
      };
      const service = new IdentityResolverService(configWithPath);
      await service.publishLinks('abn', '51824753556', mockLinks);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/register',
        expect.any(Object),
      );
    });

    it('should use identifierScheme as namespace when namespace is not provided', async () => {
      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.namespace).toBe('abn');
    });

    it('should use provided namespace when configured', async () => {
      const configWithNamespace: IdentityResolverConfig = {
        ...mockConfig,
        namespace: 'custom-namespace',
      };
      const service = new IdentityResolverService(configWithNamespace);
      await service.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.namespace).toBe('custom-namespace');
    });

    it('should construct correct payload structure', async () => {
      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({
        namespace: 'abn',
        identificationKey: '51824753556',
        identificationKeyType: 'abn',
        itemDescription: 'Digital Product Passport',
        qualifierPath: '/',
        active: true,
      });
      expect(body.responses).toBeDefined();
      expect(Array.isArray(body.responses)).toBe(true);
    });

    it('should create responses for each locale', async () => {
      const service = new IdentityResolverService(mockConfig);
      const singleLink: Link[] = [mockLinks[0]];
      await service.publishLinks('abn', '51824753556', singleLink);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      // Should have one response per locale for each link
      expect(body.responses.length).toBe(locales.length);

      const contexts = body.responses.map((r: { context: string }) => r.context);
      expect(contexts).toContain('us');
      expect(contexts).toContain('au');
    });

    it('should correctly convert link properties to response format', async () => {
      const service = new IdentityResolverService(mockConfig);
      const singleLink: Link[] = [mockLinks[0]];
      await service.publishLinks('abn', '51824753556', singleLink);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const firstResponse = body.responses[0];
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

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].linkType).toBe('abn:dpp');
    });

    it('should preserve rel when already prefixed with colon', async () => {
      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      // untp:dpp already has a colon, should be preserved
      expect(body.responses[0].linkType).toBe('untp:dpp');
    });

    it('should use default language "en" when hreflang is not provided', async () => {
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

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].ianaLanguage).toBe('en');
    });

    it('should use first hreflang when provided', async () => {
      const service = new IdentityResolverService(mockConfig);
      // mockLinks[1] has hreflang: ['de']
      await service.publishLinks('abn', '51824753556', [mockLinks[1]]);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].ianaLanguage).toBe('de');
    });

    it('should set default flags to false when link.default is not set', async () => {
      const service = new IdentityResolverService(mockConfig);
      // mockLinks[1] does not have default: true
      await service.publishLinks('abn', '51824753556', [mockLinks[1]]);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].defaultLinkType).toBe(false);
      expect(body.responses[0].defaultIanaLanguage).toBe(false);
      expect(body.responses[0].defaultMimeType).toBe(false);
    });

    it('should send POST request with correct headers', async () => {
      const service = new IdentityResolverService(mockConfig);
      await service.publishLinks('abn', '51824753556', mockLinks);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          },
        }),
      );
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
      it('should throw an error with message when fetch fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const service = new IdentityResolverService(mockConfig);

        await expect(service.publishLinks('abn', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to register links with identity resolver for identifier 51824753556: Network error',
        );
      });

      it('should throw an error when response is not ok', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        const service = new IdentityResolverService(mockConfig);

        await expect(service.publishLinks('abn', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to register links with identity resolver for identifier 51824753556: HTTP 500: Internal Server Error',
        );
      });

      it('should handle non-Error exceptions', async () => {
        mockFetch.mockRejectedValueOnce('String error');

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
