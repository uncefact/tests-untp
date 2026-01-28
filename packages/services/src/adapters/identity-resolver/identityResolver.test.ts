import { IdentityResolverAdapter, locales } from './identityResolver.adapter';
import type { Link } from '../../interfaces/identityResolverService';

describe('IdentityResolverAdapter', () => {
  const mockBaseURL = 'https://resolver.example.com';
  const mockHeaders = { Authorization: 'Bearer test-api-key' };

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
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      expect(adapter).toBeInstanceOf(IdentityResolverAdapter);
    });

    it('should throw an error when baseURL is missing', () => {
      expect(() => new IdentityResolverAdapter('', mockHeaders)).toThrow(
        'Error creating IdentityResolverAdapter. API URL is required.',
      );
    });

    it('should throw an error when Authorization header is missing', () => {
      expect(() => new IdentityResolverAdapter(mockBaseURL, {} as Record<string, string>)).toThrow(
        'Error creating IdentityResolverAdapter. Authorization header is required.',
      );
    });

    it('should throw an error when headers is undefined', () => {
      expect(
        () => new IdentityResolverAdapter(mockBaseURL, undefined as unknown as Record<string, string>),
      ).toThrow('Error creating IdentityResolverAdapter. Authorization header is required.');
    });
  });

  describe('publishLinks', () => {
    it('should successfully publish links and return registration details', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      const result = await adapter.publishLinks('abn', '51824753556', mockLinks);

      expect(result).toEqual({
        resolverUri: 'https://resolver.example.com/abn/abn/51824753556',
        identifierScheme: 'abn',
        identifier: '51824753556',
      });
    });

    it('should set authorization header', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

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
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com',
        expect.any(Object),
      );
    });

    it('should call the API with correct URL when linkRegisterPath is provided', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders, undefined, 'register');
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/register',
        expect.any(Object),
      );
    });

    it('should use identifierScheme as namespace when namespace is not provided', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.namespace).toBe('abn');
    });

    it('should use provided namespace when configured', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders, 'custom-namespace');
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.namespace).toBe('custom-namespace');
    });

    it('should construct correct payload structure', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

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
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      const singleLink: Link[] = [mockLinks[0]];
      await adapter.publishLinks('abn', '51824753556', singleLink);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      // Should have one response per locale for each link
      expect(body.responses.length).toBe(locales.length);

      const contexts = body.responses.map((r: { context: string }) => r.context);
      expect(contexts).toContain('us');
      expect(contexts).toContain('au');
    });

    it('should correctly convert link properties to response format', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      const singleLink: Link[] = [mockLinks[0]];
      await adapter.publishLinks('abn', '51824753556', singleLink);

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

      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      await adapter.publishLinks('abn', '51824753556', linkWithoutPrefix);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].linkType).toBe('abn:dpp');
    });

    it('should preserve rel when already prefixed with colon', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

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

      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      await adapter.publishLinks('abn', '51824753556', linkWithoutLang);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].ianaLanguage).toBe('en');
    });

    it('should use first hreflang when provided', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      // mockLinks[1] has hreflang: ['de']
      await adapter.publishLinks('abn', '51824753556', [mockLinks[1]]);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].ianaLanguage).toBe('de');
    });

    it('should set default flags to false when link.default is not set', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      // mockLinks[1] does not have default: true
      await adapter.publishLinks('abn', '51824753556', [mockLinks[1]]);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].defaultLinkType).toBe(false);
      expect(body.responses[0].defaultIanaLanguage).toBe(false);
      expect(body.responses[0].defaultMimeType).toBe(false);
    });

    it('should send POST request with correct headers', async () => {
      const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

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
        const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);

        await expect(adapter.publishLinks('', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to publish links: identifierScheme is required',
        );
      });

      it('should throw an error when identifier is empty', async () => {
        const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);

        await expect(adapter.publishLinks('abn', '', mockLinks)).rejects.toThrow(
          'Failed to publish links: identifier is required',
        );
      });

      it('should throw an error when links array is empty', async () => {
        const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);

        await expect(adapter.publishLinks('abn', '51824753556', [])).rejects.toThrow(
          'Failed to publish links: at least one link is required',
        );
      });

      it('should throw an error when links is null', async () => {
        const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);

        await expect(
          adapter.publishLinks('abn', '51824753556', null as unknown as Link[]),
        ).rejects.toThrow('Failed to publish links: at least one link is required');
      });

      it('should throw an error when links is undefined', async () => {
        const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);

        await expect(
          adapter.publishLinks('abn', '51824753556', undefined as unknown as Link[]),
        ).rejects.toThrow('Failed to publish links: at least one link is required');
      });
    });

    describe('API error handling', () => {
      it('should throw an error with message when fetch fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);

        await expect(adapter.publishLinks('abn', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to register links with identity resolver: Network error',
        );
      });

      it('should throw an error when response is not ok', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);

        await expect(adapter.publishLinks('abn', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to register links with identity resolver: HTTP 500: Internal Server Error',
        );
      });

      it('should handle non-Error exceptions', async () => {
        mockFetch.mockRejectedValueOnce('String error');

        const adapter = new IdentityResolverAdapter(mockBaseURL, mockHeaders);

        await expect(adapter.publishLinks('abn', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to register links with identity resolver: Unknown error',
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
