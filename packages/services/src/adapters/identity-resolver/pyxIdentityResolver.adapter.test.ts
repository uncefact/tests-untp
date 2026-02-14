import {
  PyxIdentityResolverAdapter,
  PYX_IDR_ADAPTER_TYPE,
  IDR_SERVICE_TYPE,
  pyxIdrRegistryEntry,
} from './pyxIdentityResolver.adapter';
import type { Link } from '../../interfaces/identityResolverService';
import type { PyxIdrConfig } from '../../identity-resolver/adapters/pyx/pyx-idr.schema';
import type { AdapterConstructorOptions, Logger } from '../../registry/adapter-options';

describe('PyxIdentityResolverAdapter', () => {
  const mockLogger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockConfig: PyxIdrConfig = {
    baseUrl: 'https://resolver.example.com',
    apiKey: 'test-api-key',
    defaultContext: 'au',
    defaultFlags: {
      defaultLinkType: false,
      defaultMimeType: false,
      defaultIanaLanguage: false,
      defaultContext: false,
      fwqs: false,
    },
  };

  const mockOptions: AdapterConstructorOptions = {
    name: 'PYX_IDR',
    version: '1.1.0',
    logger: mockLogger,
  };

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
      json: jest.fn().mockResolvedValue({
        resolverUri: 'https://resolver.example.com/au/abn/51824753556',
        linkResponses: [
          { id: 'link-1', linkType: 'untp:dpp' },
          { id: 'link-2', linkType: 'untp:dcc' },
        ],
      }),
      text: jest.fn().mockResolvedValue(''),
    });
    global.fetch = mockFetch;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constants', () => {
    it('should export PYX_IDR_ADAPTER_TYPE as "PYX_IDR"', () => {
      expect(PYX_IDR_ADAPTER_TYPE).toBe('PYX_IDR');
    });

    it('should export IDR_SERVICE_TYPE as "IDR"', () => {
      expect(IDR_SERVICE_TYPE).toBe('IDR');
    });
  });

  describe('constructor', () => {
    it('should create an instance with valid configuration', () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      expect(adapter).toBeInstanceOf(PyxIdentityResolverAdapter);
    });

    it('should use default context when not provided in config', () => {
      // Simulate a config where defaultContext was parsed from an input without the field
      const { defaultContext: _, ...configWithoutContext } = mockConfig;
      const adapter = new PyxIdentityResolverAdapter(configWithoutContext as unknown as PyxIdrConfig, mockOptions);
      expect(adapter).toBeInstanceOf(PyxIdentityResolverAdapter);
    });

    it('should use default flags when not provided in config', () => {
      const configWithoutFlags = { ...mockConfig, defaultFlags: undefined };
      const adapter = new PyxIdentityResolverAdapter(configWithoutFlags as PyxIdrConfig, mockOptions);
      expect(adapter).toBeInstanceOf(PyxIdentityResolverAdapter);
    });
  });

  describe('publishLinks', () => {
    it('should successfully publish links and return registration with link IDs', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      const result = await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, {
        namespace: 'au',
      });

      expect(result).toEqual({
        resolverUri: 'https://resolver.example.com/au/abn/51824753556',
        identifierScheme: 'abn',
        identifier: '51824753556',
        links: [
          { idrLinkId: 'link-1', link: mockLinks[0] },
          { idrLinkId: 'link-2', link: mockLinks[1] },
        ],
      });
    });

    it('should call the versioned API path', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, { namespace: 'au' });

      expect(mockFetch).toHaveBeenCalledWith('https://resolver.example.com/api/1.1.0/resolver', expect.any(Object));
    });

    it('should include authorization and content-type headers', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, { namespace: 'au' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should use namespace from options in the payload', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, { namespace: 'custom-ns' });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.namespace).toBe('custom-ns');
    });

    it('should fall back to defaultContext when namespace not provided in options', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.publishLinks('abn', '51824753556', mockLinks);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.namespace).toBe('au');
    });

    it('should construct correct payload structure', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, {
        namespace: 'untp',
        itemDescription: 'Test item',
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({
        namespace: 'untp',
        identificationKey: '51824753556',
        identificationKeyType: 'abn',
        itemDescription: 'Test item',
        qualifierPath: '/',
        active: true,
      });
      expect(body.responses).toBeDefined();
      expect(Array.isArray(body.responses)).toBe(true);
    });

    it('should use custom qualifierPath when provided', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.publishLinks('abn', '51824753556', mockLinks, '/10/lot123', { namespace: 'au' });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.qualifierPath).toBe('/10/lot123');
    });

    it('should use "/" as qualifierPath when not provided', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, { namespace: 'au' });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.qualifierPath).toBe('/');
    });

    it('should correctly map link properties to response format', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.publishLinks('abn', '51824753556', [mockLinks[0]], undefined, { namespace: 'au' });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const firstResponse = body.responses[0];
      expect(firstResponse).toMatchObject({
        linkType: 'untp:dpp',
        targetUrl: 'https://storage.example.com/dpp-123.json',
        mimeType: 'application/json',
        linkTitle: 'Digital Product Passport',
        ianaLanguage: 'en',
        context: 'au',
        defaultLinkType: true, // link.default is true
        defaultMimeType: false,
        defaultIanaLanguage: false,
        defaultContext: false,
        fwqs: false,
      });
    });

    it('should use default flags config values when link.default is not set', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.publishLinks('abn', '51824753556', [mockLinks[1]], undefined, { namespace: 'au' });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0].defaultLinkType).toBe(false);
      expect(body.responses[0].defaultMimeType).toBe(false);
      expect(body.responses[0].defaultIanaLanguage).toBe(false);
    });

    it('should use custom default flags from config', async () => {
      const configWithFlags: PyxIdrConfig = {
        ...mockConfig,
        defaultFlags: {
          defaultLinkType: true,
          defaultMimeType: true,
          defaultIanaLanguage: false,
          defaultContext: false,
          fwqs: true,
        },
      };
      const adapter = new PyxIdentityResolverAdapter(configWithFlags, mockOptions);
      await adapter.publishLinks('abn', '51824753556', [mockLinks[1]], undefined, { namespace: 'au' });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      // link.default is undefined, so defaultLinkType falls back to config value
      expect(body.responses[0].defaultMimeType).toBe(true);
      expect(body.responses[0].fwqs).toBe(true);
    });

    it('should handle response with "responses" key instead of "linkResponses"', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          responses: [{ linkId: 'resp-1' }, { linkId: 'resp-2' }],
        }),
        text: jest.fn().mockResolvedValue(''),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      const result = await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, { namespace: 'au' });

      expect(result.links).toEqual([
        { idrLinkId: 'resp-1', link: mockLinks[0] },
        { idrLinkId: 'resp-2', link: mockLinks[1] },
      ]);
    });

    it('should use index as fallback when response has no id or linkId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          linkResponses: [{ linkType: 'untp:dpp' }],
        }),
        text: jest.fn().mockResolvedValue(''),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      const result = await adapter.publishLinks('abn', '51824753556', [mockLinks[0]], undefined, { namespace: 'au' });

      expect(result.links[0].idrLinkId).toBe('0');
    });

    it('should log the publish operation', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, { namespace: 'au' });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Publishing 2 link(s) for abn/51824753556'));
    });

    describe('error handling', () => {
      it('should throw an error when response is not ok', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: jest.fn().mockResolvedValue('Server exploded'),
        });

        const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);

        await expect(
          adapter.publishLinks('abn', '51824753556', mockLinks, undefined, { namespace: 'au' }),
        ).rejects.toThrow('Failed to publish links: HTTP 500: Server exploded');
      });

      it('should fall back to statusText when text() fails', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          text: jest.fn().mockRejectedValue(new Error('text parse error')),
        });

        const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);

        await expect(
          adapter.publishLinks('abn', '51824753556', mockLinks, undefined, { namespace: 'au' }),
        ).rejects.toThrow('Failed to publish links: HTTP 502: Bad Gateway');
      });
    });
  });

  describe('getLinkById', () => {
    it('should fetch a link by ID and return mapped Link object', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          targetUrl: 'https://example.com/dpp.json',
          linkType: 'untp:dpp',
          mimeType: 'application/json',
          linkTitle: 'My DPP',
          ianaLanguage: 'en',
        }),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      const result = await adapter.getLinkById('link-123');

      expect(result).toEqual({
        href: 'https://example.com/dpp.json',
        rel: 'untp:dpp',
        type: 'application/json',
        title: 'My DPP',
        hreflang: ['en'],
      });
    });

    it('should call the versioned API path with link ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          targetUrl: 'https://example.com/dpp.json',
          linkType: 'untp:dpp',
          mimeType: 'application/json',
        }),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.getLinkById('link-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/api/1.1.0/resolver/links/link-123',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }) }),
      );
    });

    it('should handle missing linkTitle gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          targetUrl: 'https://example.com/dpp.json',
          linkType: 'untp:dpp',
          mimeType: 'application/json',
        }),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      const result = await adapter.getLinkById('link-123');

      expect(result.title).toBe('');
    });

    it('should handle missing ianaLanguage gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          targetUrl: 'https://example.com/dpp.json',
          linkType: 'untp:dpp',
          mimeType: 'application/json',
        }),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      const result = await adapter.getLinkById('link-123');

      expect(result.hreflang).toBeUndefined();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('Link not found'),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);

      await expect(adapter.getLinkById('link-999')).rejects.toThrow('Failed to get link: HTTP 404: Link not found');
    });
  });

  describe('updateLink', () => {
    it('should send PUT request with mapped fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          targetUrl: 'https://example.com/updated.json',
          linkType: 'untp:dpp',
          mimeType: 'application/ld+json',
          linkTitle: 'Updated Title',
          ianaLanguage: 'en',
        }),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      const result = await adapter.updateLink('link-123', {
        href: 'https://example.com/updated.json',
        type: 'application/ld+json',
        title: 'Updated Title',
      });

      expect(result).toEqual({
        href: 'https://example.com/updated.json',
        rel: 'untp:dpp',
        type: 'application/ld+json',
        title: 'Updated Title',
        hreflang: ['en'],
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://resolver.example.com/api/1.1.0/resolver/links/link-123');
      expect(callArgs[1].method).toBe('PUT');

      const body = JSON.parse(callArgs[1].body);
      expect(body).toEqual({
        targetUrl: 'https://example.com/updated.json',
        mimeType: 'application/ld+json',
        linkTitle: 'Updated Title',
      });
    });

    it('should only include defined fields in the payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          targetUrl: 'https://example.com/resource.json',
          linkType: 'untp:dpp',
          mimeType: 'application/json',
          linkTitle: 'New Title',
        }),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.updateLink('link-123', { title: 'New Title' });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toEqual({ linkTitle: 'New Title' });
      expect(body.targetUrl).toBeUndefined();
      expect(body.linkType).toBeUndefined();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('Invalid update'),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);

      await expect(adapter.updateLink('link-123', { title: 'test' })).rejects.toThrow(
        'Failed to update link: HTTP 400: Invalid update',
      );
    });
  });

  describe('deleteLink', () => {
    it('should send DELETE request to the versioned API path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.deleteLink('link-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/api/1.1.0/resolver/links/link-123',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
        }),
      );
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('Link not found'),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);

      await expect(adapter.deleteLink('link-999')).rejects.toThrow('Failed to delete link: HTTP 404: Link not found');
    });
  });

  describe('getResolverDescription', () => {
    it('should fetch resolver description from .well-known/resolver', async () => {
      const mockDescription = {
        name: 'Pyx IDR',
        supportedLinkTypes: [{ namespace: 'untp', type: 'dpp', title: 'Digital Product Passport' }],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockDescription),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      const result = await adapter.getResolverDescription();

      expect(result).toEqual(mockDescription);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/.well-known/resolver',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }) }),
      );
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: jest.fn().mockResolvedValue('Resolver down'),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);

      await expect(adapter.getResolverDescription()).rejects.toThrow(
        'Failed to get resolver description: HTTP 503: Resolver down',
      );
    });
  });

  describe('getLinkTypes', () => {
    it('should fetch link types from versioned voc endpoint', async () => {
      const mockLinkTypes = [
        { namespace: 'untp', type: 'dpp', title: 'Digital Product Passport' },
        { namespace: 'untp', type: 'dcc', title: 'Digital Conformity Credential' },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockLinkTypes),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      const result = await adapter.getLinkTypes();

      expect(result).toEqual(mockLinkTypes);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/api/1.1.0/voc?show=linktypes',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }) }),
      );
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('Error'),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);

      await expect(adapter.getLinkTypes()).rejects.toThrow('Failed to get link types: HTTP 500: Error');
    });
  });

  describe('registerSchemes', () => {
    it('should POST each scheme to the identifiers endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      const schemes = [
        {
          namespace: 'untp',
          applicationIdentifiers: [
            {
              title: 'Australian Business Number',
              label: 'ABN',
              shortcode: 'abn',
              ai: '9991',
              type: 'I' as const,
              regex: '^\\d{11}$',
            },
          ],
        },
        {
          namespace: 'gs1',
          applicationIdentifiers: [
            {
              title: 'Global Trade Item Number',
              label: 'GTIN',
              shortcode: 'gtin',
              ai: '01',
              type: 'I' as const,
              regex: '^\\d{14}$',
            },
          ],
        },
      ];

      await adapter.registerSchemes(schemes);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/api/1.1.0/identifiers',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"namespace":"untp"'),
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/api/1.1.0/identifiers',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"namespace":"gs1"'),
        }),
      );
    });

    it('should log a warning when a scheme registration fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: jest.fn().mockResolvedValue('Already exists'),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockOptions);
      await adapter.registerSchemes([
        {
          namespace: 'untp',
          applicationIdentifiers: [
            {
              title: 'ABN',
              label: 'ABN',
              shortcode: 'abn',
              ai: '9991',
              type: 'I' as const,
              regex: '^\\d{11}$',
            },
          ],
        },
      ]);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to register scheme untp'));
    });
  });

  describe('pyxIdrRegistryEntry', () => {
    it('should have a valid configSchema', () => {
      expect(pyxIdrRegistryEntry.configSchema).toBeDefined();

      const validConfig = {
        baseUrl: 'https://resolver.example.com',
        apiKey: 'test-key',
      };
      const result = pyxIdrRegistryEntry.configSchema.parse(validConfig);
      expect(result.baseUrl).toBe('https://resolver.example.com');
      expect(result.apiKey).toBe('test-key');
      expect(result.defaultContext).toBe('au'); // default
    });

    it('should reject invalid config', () => {
      expect(() => pyxIdrRegistryEntry.configSchema.parse({ baseUrl: 'not-a-url', apiKey: '' })).toThrow();
    });

    it('should create an adapter instance via factory', () => {
      const config = {
        baseUrl: 'https://resolver.example.com',
        apiKey: 'test-key',
        defaultContext: 'au',
      };
      const parsed = pyxIdrRegistryEntry.configSchema.parse(config);
      const adapter = pyxIdrRegistryEntry.factory(parsed, mockOptions);
      expect(adapter).toBeInstanceOf(PyxIdentityResolverAdapter);
    });
  });
});
