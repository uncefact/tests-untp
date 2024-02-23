import { Gs1Provider, gs1ServiceEnum } from '../providers/gs1Provider';
import { publicAPI } from '../utils/httpService';

jest.mock('../types/types', () => ({
  SupportedProviderTypesEnum: {
    gs1: 'gs1',
  },
}));

describe('Gs1Provider', () => {
  const providerType = 'gs1';
  const providerUrl = 'https://example.com/gs1';

  let gs1Provider: Gs1Provider;

  beforeEach(() => {
    // Set up a new instance of Gs1Provider with the specified provider type and URL
    gs1Provider = new Gs1Provider(providerType, providerUrl);
  });

  describe('getDlrUrl', () => {
    it('should return null if code is not set', async () => {
      // Call the getDlrUrl method without setting the code
      const dlrUrl = await gs1Provider.getDlrUrl();

      // Ensure that the returned DLR URL is null
      expect(dlrUrl).toBeNull();
    });

    it('should return null if no products are fetched', async () => {
        // Set a code and mock the post method to return an empty array
      gs1Provider.setCode('12345678901234');
      jest.spyOn(publicAPI, 'post').mockResolvedValueOnce([]);

      // Call the getDlrUrl method
      const dlrUrl = await gs1Provider.getDlrUrl();

      // Ensure that the returned DLR URL is null
      expect(dlrUrl).toBeNull();
    });

    it('should return null if gs1ServiceHost is not found', async () => {
      // Set a code and mock the post method to return products with no gs1ServiceHost
      gs1Provider.setCode('12345678901234');
      const mockProducts = [{
        linkset: {
          [gs1ServiceEnum.serviceInfo]: []
        },
      }];
      jest.spyOn(publicAPI, 'post').mockResolvedValueOnce(mockProducts);

      // Call the getDlrUrl method
      const dlrUrl = await gs1Provider.getDlrUrl();

      // Ensure that the returned DLR URL is null
      expect(dlrUrl).toBeNull();
    });

    it('should return null if fetch fails', async () => {
      // Set a code and mock the fetch method to reject with an error
      gs1Provider.setCode('12345678901234');
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Failed to fetch'));

      // Call the getDlrUrl method
      const dlrUrl = await gs1Provider.getDlrUrl();

      // Ensure that the returned DLR URL is null
      expect(dlrUrl).toBeNull();
    });

    it('should return DLR URL if gs1ServiceHost is found', async () => {
      // Set a code, mock the post method to return products with gs1ServiceHost, and specify the mock GS1 host
      const mockGs1Host = 'https://gs1ServiceHost.com';
      const mockProducts = [{
        linkset: {
            [gs1ServiceEnum.serviceInfo]: [{ href: mockGs1Host }]
        },
      }];
      const mockCode = '12345678901234';
      gs1Provider.setCode(mockCode);
      jest.spyOn(publicAPI, 'post').mockResolvedValueOnce(mockProducts);

      // Call the getDlrUrl method
      const dlrUrl = await gs1Provider.getDlrUrl();

      // Ensure that the returned DLR URL matches the expected format
      expect(dlrUrl).toBe(`${mockGs1Host}/gtin/${mockCode}?linkType=all`);
    });
  });

  describe('setCode', () => {
    it('should set the code correctly', () => {
      // Create a new instance of Gs1Provider
      const gs1Provider = new Gs1Provider(providerType, providerUrl);
      // Define a code
      const code = '12345678901234';
      // Set the code
      gs1Provider.setCode(code);

      // Assert that the code is set correctly
      expect(gs1Provider['code']).toBe(code);
    });

    it('should overwrite the existing code', () => {
      // Create a new instance of Gs1Provider
      const gs1Provider = new Gs1Provider(providerType, providerUrl);
      // Define initial and new codes
      const initialCode = '12345678901234';
      const newCode = '98765432109876';
      // Set initial code
      gs1Provider.setCode(initialCode);
      // Set new code
      gs1Provider.setCode(newCode);

      // Assert that the code is overwritten correctly
      expect(gs1Provider['code']).toBe(newCode);
    });

    it('should allow setting an empty string as code', () => {
      // Create a new instance of Gs1Provider
      const gs1Provider = new Gs1Provider(providerType, providerUrl);
      // Set empty string as code
      gs1Provider.setCode('');

      // Assert that the code is set to an empty string
      expect(gs1Provider['code']).toBe('');
    });

    // Test case: should allow setting undefined as code
    it('should allow setting undefined as code', () => {
      // Create a new instance of Gs1Provider
      const gs1Provider = new Gs1Provider(providerType, providerUrl);

      // Assert that the code is initially undefined
      expect(gs1Provider['code']).toBeUndefined();
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

  describe('isProviderSupported', () => {
    it('should return true for supported provider types', () => {
      // Assert that the provider is supported
      expect(gs1Provider.isProviderSupported()).toBeTruthy();
    });

    it('should return false for unsupported provider types', () => {
      // Create a new Gs1Provider instance with an unsupported provider type
      const unsupportedProvider = new Gs1Provider('unsupported', 'https://example.com/unsupported');
      
      // Assert that the unsupported provider is not supported
      expect(unsupportedProvider.isProviderSupported()).toBeFalsy();
    });
  });
});
