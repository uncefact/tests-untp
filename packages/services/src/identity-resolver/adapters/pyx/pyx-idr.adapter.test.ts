import {
  PyxIdentityResolverAdapter,
  PYX_IDR_ADAPTER_TYPE,
  IDR_SERVICE_TYPE,
  IdrLinkNotFoundError,
  pyxIdrRegistryEntry,
} from './pyx-idr.adapter';
import {
  IdrPublishError,
  IdrLinkFetchError,
  IdrLinkUpdateError,
  IdrLinkDeleteError,
  IdrResolverFetchError,
  IdrLinkTypesFetchError,
} from '../../errors';
import type { Link } from '../../types';
import type { PyxIdrConfig } from './pyx-idr.schema';
import type { LoggerService } from '../../../logging/types';

describe('PyxIdentityResolverAdapter', () => {
  const mockLogger: LoggerService = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const mockConfig: PyxIdrConfig = {
    baseUrl: 'https://resolver.example.com',
    apiKey: 'test-api-key',
    apiVersion: '2.0.2',
    ianaLanguage: 'en',
    context: 'au',
    defaultLinkType: 'untp:dpp',
    defaultMimeType: 'text/html',
    defaultIanaLanguage: 'en',
    defaultContext: 'au',
    fwqs: false,
  };

  const mockOptions = {
    namespace: 'ato',
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
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      expect(adapter).toBeInstanceOf(PyxIdentityResolverAdapter);
    });
  });

  describe('publishLinks', () => {
    it('should successfully publish links and return registration with link IDs', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      const result = await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, mockOptions);

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
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, mockOptions);

      expect(mockFetch).toHaveBeenCalledWith('https://resolver.example.com/api/2.0.2/resolver', expect.any(Object));
    });

    it('should include authorization and content-type headers', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, mockOptions);

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
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, {
        ...mockOptions,
        namespace: 'custom-ns',
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.namespace).toBe('custom-ns');
    });

    it('should construct correct payload structure', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, {
        ...mockOptions,
        itemDescription: 'Test item',
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({
        namespace: 'ato',
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
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.publishLinks('abn', '51824753556', mockLinks, '/10/lot123', mockOptions);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.qualifierPath).toBe('/10/lot123');
    });

    it('should use "/" as qualifierPath when not provided', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, mockOptions);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.qualifierPath).toBe('/');
    });

    it('should correctly map link properties to response format using config defaults', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.publishLinks('abn', '51824753556', [mockLinks[0]], undefined, mockOptions);

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
        defaultLinkType: true, // 'untp:dpp' === config.defaultLinkType
        defaultMimeType: false, // 'application/json' !== config.defaultMimeType ('text/html')
        defaultIanaLanguage: true, // config.ianaLanguage === config.defaultIanaLanguage
        defaultContext: true, // config.context === config.defaultContext
        fwqs: false,
      });
    });

    it('should allow options to override config defaults', async () => {
      const overrideOptions = {
        ...mockOptions,
        ianaLanguage: 'de',
        context: 'us',
        defaultLinkType: 'untp:dcc',
        defaultMimeType: 'application/json',
        defaultIanaLanguage: 'de',
        defaultContext: 'us',
        fwqs: true,
      };
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.publishLinks('abn', '51824753556', [mockLinks[1]], undefined, overrideOptions);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.responses[0]).toMatchObject({
        ianaLanguage: 'de',
        context: 'us',
        defaultLinkType: true, // 'untp:dcc' === overrideOptions.defaultLinkType
        defaultMimeType: true, // 'application/json' === overrideOptions.defaultMimeType
        defaultIanaLanguage: true, // 'de' === overrideOptions.defaultIanaLanguage
        defaultContext: true, // 'us' === overrideOptions.defaultContext
        fwqs: true,
      });
    });

    it('should handle response with "responses" key instead of "linkResponses"', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          responses: [{ linkId: 'resp-1' }, { linkId: 'resp-2' }],
        }),
        text: jest.fn().mockResolvedValue(''),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      const result = await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, mockOptions);

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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      const result = await adapter.publishLinks('abn', '51824753556', [mockLinks[0]], undefined, mockOptions);

      expect(result.links[0].idrLinkId).toBe('0');
    });

    it('should construct resolverUri from parts when API response omits it', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          linkResponses: [
            { id: 'link-1', linkType: 'untp:dpp' },
            { id: 'link-2', linkType: 'untp:dcc' },
          ],
        }),
        text: jest.fn().mockResolvedValue(''),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      const result = await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, mockOptions);

      expect(result.resolverUri).toBe('https://resolver.example.com/ato/abn/51824753556');
    });

    it('should return empty links array when API response has no linkResponses or responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          resolverUri: 'https://resolver.example.com/ato/abn/51824753556',
        }),
        text: jest.fn().mockResolvedValue(''),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      const result = await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, mockOptions);

      expect(result.links).toEqual([]);
    });

    it('should log the publish operation', async () => {
      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.publishLinks('abn', '51824753556', mockLinks, undefined, mockOptions);

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

        const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

        await expect(adapter.publishLinks('abn', '51824753556', mockLinks, undefined, mockOptions)).rejects.toThrow(
          IdrPublishError,
        );
      });

      it('should fall back to statusText when text() fails', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          text: jest.fn().mockRejectedValue(new Error('text parse error')),
        });

        const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

        await expect(adapter.publishLinks('abn', '51824753556', mockLinks, undefined, mockOptions)).rejects.toThrow(
          IdrPublishError,
        );
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.getLinkById('link-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/api/2.0.2/resolver/links/link-123',
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      const result = await adapter.getLinkById('link-123');

      expect(result.hreflang).toBeUndefined();
    });

    it('should throw IdrLinkNotFoundError on HTTP 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.getLinkById('link-999')).rejects.toThrow(IdrLinkNotFoundError);
    });

    it('should throw IdrLinkNotFoundError on HTTP 410', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        statusText: 'Gone',
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.getLinkById('link-999')).rejects.toThrow(IdrLinkNotFoundError);
    });

    it('should throw generic error on non-404/410 HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('Server error'),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.getLinkById('link-999')).rejects.toThrow(IdrLinkFetchError);
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
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
      expect(callArgs[0]).toBe('https://resolver.example.com/api/2.0.2/resolver/links/link-123');
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.updateLink('link-123', { title: 'New Title' });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toEqual({ linkTitle: 'New Title' });
      expect(body.targetUrl).toBeUndefined();
      expect(body.linkType).toBeUndefined();
    });

    it('should throw IdrLinkNotFoundError on HTTP 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.updateLink('link-123', { title: 'test' })).rejects.toThrow(IdrLinkNotFoundError);
    });

    it('should throw IdrLinkNotFoundError on HTTP 410', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        statusText: 'Gone',
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.updateLink('link-123', { title: 'test' })).rejects.toThrow(IdrLinkNotFoundError);
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('Invalid update'),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.updateLink('link-123', { title: 'test' })).rejects.toThrow(IdrLinkUpdateError);
    });
  });

  describe('deleteLink', () => {
    it('should send DELETE request to the versioned API path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      await adapter.deleteLink('link-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/api/2.0.2/resolver/links/link-123',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
        }),
      );
    });

    it('should throw IdrLinkNotFoundError on HTTP 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.deleteLink('link-999')).rejects.toThrow(IdrLinkNotFoundError);
    });

    it('should throw IdrLinkNotFoundError on HTTP 410', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        statusText: 'Gone',
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.deleteLink('link-999')).rejects.toThrow(IdrLinkNotFoundError);
    });

    it('should throw generic error on non-404/410 HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('Server error'),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.deleteLink('link-999')).rejects.toThrow(IdrLinkDeleteError);
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.getResolverDescription()).rejects.toThrow(IdrResolverFetchError);
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
      const result = await adapter.getLinkTypes();

      expect(result).toEqual(mockLinkTypes);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/api/2.0.2/voc?show=linktypes',
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);

      await expect(adapter.getLinkTypes()).rejects.toThrow(IdrLinkTypesFetchError);
    });
  });

  describe('registerSchemes', () => {
    it('should POST each scheme to the identifiers endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
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
        'https://resolver.example.com/api/2.0.2/identifiers',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"namespace":"untp"'),
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://resolver.example.com/api/2.0.2/identifiers',
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

      const adapter = new PyxIdentityResolverAdapter(mockConfig, mockLogger);
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
        ianaLanguage: 'en',
        context: 'au',
        defaultLinkType: 'untp:dpp',
        defaultMimeType: 'text/html',
        defaultIanaLanguage: 'en',
        defaultContext: 'au',
      };
      const result = pyxIdrRegistryEntry.configSchema.parse(validConfig);
      expect(result.baseUrl).toBe('https://resolver.example.com');
      expect(result.apiKey).toBe('test-key');
      expect(result.defaultLinkType).toBe('untp:dpp');
    });

    it('should reject invalid config', () => {
      expect(() => pyxIdrRegistryEntry.configSchema.parse({ baseUrl: 'not-a-url', apiKey: '' })).toThrow();
    });

    it('should default apiVersion and fwqs when not provided', () => {
      const config = {
        baseUrl: 'https://resolver.example.com',
        apiKey: 'test-key',
        ianaLanguage: 'en',
        context: 'au',
        defaultLinkType: 'untp:dpp',
        defaultMimeType: 'text/html',
        defaultIanaLanguage: 'en',
        defaultContext: 'au',
      };
      const result = pyxIdrRegistryEntry.configSchema.parse(config);
      expect(result.apiVersion).toBe('2.0.2');
      expect(result.fwqs).toBe(false);
    });

    it('should reject an unsupported apiVersion', () => {
      const config = {
        baseUrl: 'https://resolver.example.com',
        apiKey: 'test-key',
        apiVersion: '1.0.0',
        ianaLanguage: 'en',
        context: 'au',
        defaultLinkType: 'untp:dpp',
        defaultMimeType: 'text/html',
        defaultIanaLanguage: 'en',
        defaultContext: 'au',
      };
      expect(() => pyxIdrRegistryEntry.configSchema.parse(config)).toThrow();
    });

    it('should create an adapter instance via factory', () => {
      const config = {
        baseUrl: 'https://resolver.example.com',
        apiKey: 'test-key',
        ianaLanguage: 'en',
        context: 'au',
        defaultLinkType: 'untp:dpp',
        defaultMimeType: 'text/html',
        defaultIanaLanguage: 'en',
        defaultContext: 'au',
      };
      const parsed = pyxIdrRegistryEntry.configSchema.parse(config);
      const adapter = pyxIdrRegistryEntry.factory(parsed, mockLogger);
      expect(adapter).toBeInstanceOf(PyxIdentityResolverAdapter);
    });
  });
});
