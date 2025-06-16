import { parseQRLink, isURLEncoded } from '../../tests/QrLinkVerification/helper';

describe('Helper Functions', () => {
  describe('parseQRLink', () => {
    it('should parse the QR code link correctly', () => {
      const qrcodeLink =
        'https://example.com/verify?q=%7B%22payload%22%3A%7B%22uri%22%3A%22https%3A%2F%2Fexample.com%2Fcredential%22%2C%22key%22%3A%22some-key%22%2C%22hash%22%3A%22some-hash%22%7D%7D';
      const result = parseQRLink(qrcodeLink);

      expect(result).toEqual({
        verify_app_address: 'https://example.com/verify',
        q: {
          payload: {
            uri: 'https://example.com/credential',
            key: 'some-key',
            hash: 'some-hash',
          },
        },
      });
    });

    it('should handle missing query parameter gracefully', () => {
      JSON.parse = jest.fn().mockImplementation((value) => {
        return {
          payload: {
            uri: undefined,
            key: undefined,
            hash: undefined,
          },
        };
      });

      const qrcodeLink = 'https://example.com/verify';
      const result = parseQRLink(qrcodeLink);

      expect(result).toEqual({
        verify_app_address: 'https://example.com/verify',
        q: {
          payload: {
            uri: undefined,
            key: undefined,
            hash: undefined,
          },
        },
      });
    });
  });

  describe('isURLEncoded', () => {
    it('should return true for URL encoded strings', () => {
      expect(isURLEncoded('%20')).toBe(true);
      expect(isURLEncoded('%7B')).toBe(true);
    });

    it('should return false for non-URL encoded strings', () => {
      expect(isURLEncoded(' ')).toBe(false);
      expect(isURLEncoded('{')).toBe(false);
    });
  });
});
