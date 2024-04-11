import { GS1Provider } from '../identityProviders/GS1Provider';

jest.mock('../types/types', () => ({
  SupportedProviderTypesEnum: {
    gs1: 'gs1',
  },
}));

describe('Gs1Provider', () => {
  const providerUrl = 'https://example.com';

  let gs1Provider: GS1Provider;

  beforeEach(() => {
    // Set up a new instance of GS1Provider with the specified provider type and URL
    gs1Provider = new GS1Provider();
  });

  describe('getDlrUrl', () => {
    it('should return null if code is not set', async () => {
      const dlrUrl = gs1Provider.getDlrUrl('', providerUrl);

      expect(dlrUrl).toBeNull();
    });

    it('should return null if invalid  element string', async () => {
      const invalidElementString = '12345678901234';
      const dlrUrl = gs1Provider.getDlrUrl(invalidElementString, providerUrl);

      expect(dlrUrl).toBeNull();
    });

    it('should return DLR URL if the element string is valid', async () => {
      const gtinAI = '01';
      const elementString = '01234567890128';
      const gtinElementString = `${gtinAI}${elementString}`;

      const dlrUrl = gs1Provider.getDlrUrl(gtinElementString, providerUrl);

      expect(dlrUrl).toBe(`${providerUrl}/gtin/${elementString}`);
    });

    it('should return DLR URL if the element string is combined multi AIs', async () => {
      const gtinAI = '01';
      const lotAI = '10';
      const elementString = '01234567890128';
      const lotValue = '1234';
      const gtinElementString = `${gtinAI}${elementString}${lotAI}${lotValue}`;

      const dlrUrl = gs1Provider.getDlrUrl(gtinElementString, providerUrl);

      expect(dlrUrl).toBe(`${providerUrl}/gtin/${elementString}/lot/${lotValue}`);
    });
  });

  describe('getCode', () => {
    it('should extract GTIN code from DATA_MATRIX format', () => {
      // Call getCode method with sample decoded text and format name
      const extractedCode = gs1Provider.getCode('456789012341233423342', 'DATA_MATRIX');

      // Assert the extracted code matches the expected value
      expect(extractedCode).toBe('456789012341233423342');
    });

    it('should pad GTIN code with leading zero if length is less than 8', () => {
      // Call getCode method with sample decoded text and empty format name
      const extractedCode = gs1Provider.getCode('123401', 'EAN_8');

      // Assert the extracted code matches the expected value
      expect(extractedCode).toBe('010123401');
    });

    it('should return GTIN code as is if length is 14 or more', () => {
      // Call getCode method with sample decoded text and empty format name
      const extractedCode = gs1Provider.getCode('12345678901234', 'EAN_13');

      // Assert the extracted code matches the expected value
      expect(extractedCode).toBe('01012345678901234');
    });
  });

});
