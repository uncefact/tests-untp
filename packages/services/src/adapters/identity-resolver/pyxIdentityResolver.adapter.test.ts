import { PyxIdentityResolverAdapter } from './pyxIdentityResolver.adapter';
import type { Link } from '../../interfaces/identityResolverService';

describe('PyxIdentityResolverAdapter', () => {
  const mockBaseURL = 'https://resolver.example.com';
  const mockHeaders = { Authorization: 'Bearer test-api-key' };
  const mockNamespace = 'untp';

  const mockLinks: Link[] = [
    {
      href: 'https://storage.example.com/dpp-123.json',
      rel: 'untp:dpp',
      type: 'application/json',
      title: 'Digital Product Passport',
      hreflang: ['en'],
      default: true,
    },
    {
      href: 'https://storage.example.com/dcc-456.json',
      rel: 'untp:dcc',
      type: 'application/json',
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
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      expect(adapter).toBeInstanceOf(PyxIdentityResolverAdapter);
    });

    it('should throw an error when baseURL is missing', () => {
      expect(() => new PyxIdentityResolverAdapter('', mockHeaders, mockNamespace)).toThrow(
        'Error creating PyxIdentityResolverAdapter. API URL is required.',
      );
    });

    it('should throw an error when namespace is missing', () => {
      expect(() => new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, '')).toThrow(
        'Error creating PyxIdentityResolverAdapter. namespace is required.',
      );
    });

    it('should throw an error when Authorization header is missing', () => {
      expect(() => new PyxIdentityResolverAdapter(mockBaseURL, {} as Record<string, string>, mockNamespace)).toThrow(
        'Error creating PyxIdentityResolverAdapter. Authorization header is required.',
      );
    });

    it('should throw an error when headers is undefined', () => {
      expect(
        () => new PyxIdentityResolverAdapter(mockBaseURL, undefined as unknown as Record<string, string>, mockNamespace),
      ).toThrow('Error creating PyxIdentityResolverAdapter. Authorization header is required.');
    });
  });

  describe('publishLinks', () => {
    it('should successfully publish links and return registration details', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      const result = await adapter.publishLinks('abn', '51824753556', mockLinks);

      expect(result).toEqual({
        resolverUri: 'https://resolver.example.com/untp/abn/51824753556',
        identifierScheme: 'abn',
        identifier: '51824753556',
      });
    });

    it('should set authorization header', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
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
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com',
        expect.any(Object),
      );
    });

    it('should call the API with correct URL when linkRegisterPath is provided', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace, 'register');
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/register',
        expect.any(Object),
      );
    });

    it('should use configured namespace in payload', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.namespace).toBe('untp');
    });

    it('should use custom namespace when provided', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, 'custom-namespace');
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.namespace).toBe('custom-namespace');
    });

    it('should construct correct payload structure', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({
        namespace: 'untp',
        identificationKey: '51824753556',
        identificationKeyType: 'abn',
        itemDescription: 'Digital Product Passport',
        qualifierPath: '/',
        active: true,
      });
      expect(body.responses).toBeDefined();
      expect(Array.isArray(body.responses)).toBe(true);
    });

    it('should use default context when link has no context specified', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      const singleLink: Link[] = [mockLinks[0]];
      await adapter.publishLinks('abn', '51824753556', singleLink);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.responses.length).toBe(1);
      expect(body.responses[0].context).toBe('au');
    });

    it('should use link context when specified', async () => {
      const linkWithContext: Link[] = [
        {
          href: 'https://storage.example.com/dpp-123.json',
          rel: 'untp:dpp',
          type: 'application/json',
          title: 'Digital Product Passport',
          context: 'gb',
        },
      ];

      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      await adapter.publishLinks('abn', '51824753556', linkWithContext);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.responses.length).toBe(1);
      expect(body.responses[0].context).toBe('gb');
    });

    it('should correctly convert link properties to response format', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      const singleLink: Link[] = [mockLinks[0]];
      await adapter.publishLinks('abn', '51824753556', singleLink);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const firstResponse = body.responses[0];
      // Default flags are all false by default to avoid overriding system-wide defaults
      expect(firstResponse).toMatchObject({
        linkType: 'untp:dpp',
        targetUrl: 'https://storage.example.com/dpp-123.json',
        mimeType: 'application/json',
        title: 'Digital Product Passport',
        ianaLanguage: 'en',
        active: true,
        defaultLinkType: false,
        defaultIanaLanguage: false,
        defaultContext: false,
        defaultMimeType: false,
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

      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      await adapter.publishLinks('abn', '51824753556', linkWithoutPrefix);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].linkType).toBe('untp:dpp');
    });

    it('should preserve rel when already prefixed with colon', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
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

      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      await adapter.publishLinks('abn', '51824753556', linkWithoutLang);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].ianaLanguage).toBe('en');
    });

    it('should use first hreflang when provided', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      // mockLinks[1] has hreflang: ['de']
      await adapter.publishLinks('abn', '51824753556', [mockLinks[1]]);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].ianaLanguage).toBe('de');
    });

    it('should set default flags to false when link.default is not set', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      // mockLinks[1] does not have default: true
      await adapter.publishLinks('abn', '51824753556', [mockLinks[1]]);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].defaultLinkType).toBe(false);
      expect(body.responses[0].defaultIanaLanguage).toBe(false);
      expect(body.responses[0].defaultMimeType).toBe(false);
    });

    it('should use adapter defaultFlags config when link.default is true', async () => {
      const linkWithDefault: Link[] = [
        {
          href: 'https://example.com/resource',
          rel: 'untp:dpp',
          type: 'application/json',
          title: 'Test Link',
          context: 'au',
          default: true,
        },
      ];

      // Configure adapter to only set defaultLinkType and defaultIanaLanguage
      const adapter = new PyxIdentityResolverAdapter(
        mockBaseURL,
        mockHeaders,
        mockNamespace,
        undefined, // linkRegisterPath
        undefined, // context
        undefined, // itemDescription
        {
          defaultLinkType: true,
          defaultMimeType: false,
          defaultIanaLanguage: true,
          defaultContext: false,
        },
      );
      await adapter.publishLinks('abn', '51824753556', linkWithDefault);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].defaultLinkType).toBe(true);
      expect(body.responses[0].defaultMimeType).toBe(false);
      expect(body.responses[0].defaultIanaLanguage).toBe(true);
      expect(body.responses[0].defaultContext).toBe(false);
    });

    it('should send POST request with correct headers', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
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

    it('should use custom itemDescription from constructor when provided', async () => {
      const adapter = new PyxIdentityResolverAdapter(
        mockBaseURL,
        mockHeaders,
        mockNamespace,
        undefined, // linkRegisterPath
        undefined, // context
        'Custom Item Description', // itemDescription
      );
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.itemDescription).toBe('Custom Item Description');
    });

    it('should use first link title as itemDescription when not provided', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.itemDescription).toBe('Digital Product Passport');
    });

    it('should use custom qualifierPath when provided', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      await adapter.publishLinks('abn', '51824753556', mockLinks, '/10/lot123');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.qualifierPath).toBe('/10/lot123');
    });

    it('should use "/" as qualifierPath when not provided', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.qualifierPath).toBe('/');
    });

    it('should use custom context when link has no context', async () => {
      const adapter = new PyxIdentityResolverAdapter(
        mockBaseURL,
        mockHeaders,
        mockNamespace,
        undefined, // linkRegisterPath
        'nz', // context
      );
      await adapter.publishLinks('abn', '51824753556', [mockLinks[0]]);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].context).toBe('nz');
    });

    it('should use fwqs from config', async () => {
      const adapter = new PyxIdentityResolverAdapter(
        mockBaseURL,
        mockHeaders,
        mockNamespace,
        undefined, // linkRegisterPath
        undefined, // context
        undefined, // itemDescription
        { fwqs: true },
      );
      await adapter.publishLinks('abn', '51824753556', [mockLinks[0]]);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].fwqs).toBe(true);
    });

    describe('validation errors', () => {
      it('should throw an error when identifierScheme is empty', async () => {
        const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);

        await expect(adapter.publishLinks('', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to publish links: identifierScheme is required',
        );
      });

      it('should throw an error when identifier is empty', async () => {
        const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);

        await expect(adapter.publishLinks('abn', '', mockLinks)).rejects.toThrow(
          'Failed to publish links: identifier is required',
        );
      });

      it('should throw an error when links array is empty', async () => {
        const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);

        await expect(adapter.publishLinks('abn', '51824753556', [])).rejects.toThrow(
          'Failed to publish links: at least one link is required',
        );
      });

      it('should throw an error when links is null', async () => {
        const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);

        await expect(
          adapter.publishLinks('abn', '51824753556', null as unknown as Link[]),
        ).rejects.toThrow('Failed to publish links: at least one link is required');
      });

      it('should throw an error when links is undefined', async () => {
        const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);

        await expect(
          adapter.publishLinks('abn', '51824753556', undefined as unknown as Link[]),
        ).rejects.toThrow('Failed to publish links: at least one link is required');
      });
    });

    describe('API error handling', () => {
      it('should throw an error with message when fetch fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);

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

        const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);

        await expect(adapter.publishLinks('abn', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to register links with identity resolver: HTTP 500: Internal Server Error',
        );
      });

      it('should handle non-Error exceptions', async () => {
        mockFetch.mockRejectedValueOnce('String error');

        const adapter = new PyxIdentityResolverAdapter(mockBaseURL, mockHeaders, mockNamespace);

        await expect(adapter.publishLinks('abn', '51824753556', mockLinks)).rejects.toThrow(
          'Failed to register links with identity resolver: Unknown error',
        );
      });
    });
  });

});
