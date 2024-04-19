import { GS1Provider, GS1ServiceEnum } from '../identityProviders/GS1Provider';
import { publicAPI } from '../utils/httpService';

jest.mock('../types/types', () => ({
  SupportedProviderTypesEnum: {
    gs1: 'gs1',
  },
}));

describe('Gs1Provider', () => {
  const gtinAI = 'gtin';
  const mockCode = '0109359502000010';
  const providerUrl = 'https://example.com';

  let gs1Provider: GS1Provider;

  beforeEach(() => {
    // Set up a new instance of GS1Provider with the specified provider type and URL
    gs1Provider = new GS1Provider();
  });

  describe('getDlrUrl', () => {
    it('should return null if code is not set', async () => {
      const dlrUrl = await gs1Provider.getDlrUrl('', providerUrl);

      expect(dlrUrl).toBeNull();
    });

    it('should return null if no products are fetched', async () => {
      jest.spyOn(publicAPI, 'post').mockResolvedValueOnce([]);

      const dlrUrl = await gs1Provider.getDlrUrl(mockCode, providerUrl);

      expect(dlrUrl).toBeNull();
    });

    it('should return null if gs1ServiceHost is not found', async () => {
      const mockProducts = [{
        linkset: {
          [GS1ServiceEnum.serviceInfo]: []
        },
      }];
      jest.spyOn(publicAPI, 'post').mockResolvedValueOnce(mockProducts);

      // Call the getDlrUrl method
      const dlrUrl = await gs1Provider.getDlrUrl(mockCode, providerUrl);

      // Ensure that the returned DLR URL is null
      expect(dlrUrl).toBeNull();
    });

    it('should return null if fetch fails', async () => {
      jest.spyOn(publicAPI, 'post').mockRejectedValueOnce(new Error('Failed to fetch'));

      await expect(gs1Provider.getDlrUrl(mockCode, providerUrl)).rejects.toThrow('Failed to run get DLR Url. Failed to fetch');
    });

    it('should return DLR URL if gs1ServiceHost is found', async () => {
      // Set a code, mock the post method to return products with gs1ServiceHost, and specify the mock GS1 host
      const mockGs1Host = 'https://gs1servicehost.com';
      const mockProducts = [{
        [gtinAI]: mockCode,
        linkset: {
            [GS1ServiceEnum.serviceInfo]: [{ href: mockGs1Host }]
        },
      }];
      jest.spyOn(publicAPI, 'post').mockResolvedValueOnce(mockProducts);

      // Call the getDlrUrl method
      const dlrUrl = await gs1Provider.getDlrUrl(mockCode, providerUrl);

      // Ensure that the returned DLR URL matches the expected format
      expect(dlrUrl).toBe(`${mockGs1Host}/gtin/${mockCode.slice(2)}?linkType=all`);
    });

    it('should return DLR URL if the element string is combined multi AIs', async () => {
      const lotAI = '10';
      const lotValue = '3000189';
      const mockGs1Host = 'https://gs1servicehost.com';
      const elementStrings = `${mockCode}${lotAI}${lotValue}`;
      const mockProducts = [{
        [gtinAI]: elementStrings,
        linkset: {
            [GS1ServiceEnum.serviceInfo]: [{ href: mockGs1Host }]
        },
      }];
      jest.spyOn(publicAPI, 'post').mockResolvedValueOnce(mockProducts);

      const dlrUrl = await gs1Provider.getDlrUrl(elementStrings, providerUrl);

      expect(dlrUrl).toBe(`${mockGs1Host}/gtin/${mockCode.slice(2)}/lot/${lotValue}?linkType=all`);
    });
  });

  describe('getCode', () => {
    it('should extract GTIN code from DATA_MATRIX format', () => {
      // Call getCode method with sample decoded text and format name
      const extractedCode = gs1Provider.getCode('456789012341233423342', 'DATA_MATRIX');

      // Assert the extracted code matches the expected value
      expect(extractedCode).toBe('67890123412334');
    });

    it('should pad GTIN code with leading zero if length is less than 14', () => {
      // Call getCode method with sample decoded text and empty format name
      const extractedCode = gs1Provider.getCode('12345678901', '');

      // Assert the extracted code matches the expected value
      expect(extractedCode).toBe('012345678901');
    });

    it('should return GTIN code as is if length is 14 or more', () => {
      // Call getCode method with sample decoded text and empty format name
      const extractedCode = gs1Provider.getCode('12345678901234', '');

      // Assert the extracted code matches the expected value
      expect(extractedCode).toBe('12345678901234');
    });
  });

  describe('getLinkResolverIdentifier', () => {
    it('should extract identifier and qualifier path from an gtin AI', () => {
      const { identifier, qualifierPath } = gs1Provider.getLinkResolverIdentifier([
        { ai: '01', value: '09359502000010' }
      ]);

      expect(identifier).toBe('09359502000010');
      expect(qualifierPath).toBe('');
    });

    it('should extract identifier and qualifier path from a combined multi AIs', () => {
      const { identifier, qualifierPath } = gs1Provider.getLinkResolverIdentifier([
        { ai: '01', value: '09359502000010' },
        { ai: '10', value: 'ABC123' }
      ]);

      expect(identifier).toBe('09359502000010');
      expect(qualifierPath).toBe('/10/ABC123');
    });

    it('should extract empty both identifier and qualifier from a an empty AI', () => {
      const { identifier, qualifierPath } = gs1Provider.getLinkResolverIdentifier([]);

      expect(identifier).toBe('');
      expect(qualifierPath).toBe('');
    });

    it('should throw an invalid DLR AIs error if input 01 and 8006 are primary keys present at the same time.', () => {
      expect(() => gs1Provider.getLinkResolverIdentifier([
        { ai: '01', value: '09359502000010' },
        { ai: '8006', value: 'ABC123' }
      ])).toThrow('Invalid DLR AIs. Both 01 and 8006 are primary keys and cannot be present at the same time.');
    });
  });

});
