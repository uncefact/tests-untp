import { validateJsonLd, JsonLdValidationError } from './validate-jsonld';

jest.mock('jsonld', () => ({
  toRDF: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toRDF } = require('jsonld') as { toRDF: jest.Mock };

describe('validateJsonLd', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not throw when JSON-LD expansion succeeds', async () => {
    toRDF.mockResolvedValue([]);

    await expect(validateJsonLd({ '@context': 'https://example.com' })).resolves.toBeUndefined();

    expect(toRDF).toHaveBeenCalledWith({ '@context': 'https://example.com' }, { safe: true });
  });

  it('throws JsonLdValidationError when expansion fails', async () => {
    toRDF.mockRejectedValue(new Error('Invalid JSON-LD'));

    await expect(validateJsonLd({})).rejects.toThrow(JsonLdValidationError);
  });

  it('includes original error message in JsonLdValidationError', async () => {
    toRDF.mockRejectedValue(new Error('Missing @context'));

    try {
      await validateJsonLd({});
      fail('Expected error');
    } catch (error) {
      expect(error).toBeInstanceOf(JsonLdValidationError);
      const validationError = error as JsonLdValidationError;
      expect(validationError.message).toContain('Missing @context');
      expect(validationError.message).toContain('JSON-LD validation failed');
      expect(validationError.name).toBe('JsonLdValidationError');
    }
  });

  it('throws JsonLdValidationError when document is not an object', async () => {
    await expect(validateJsonLd('not-an-object')).rejects.toThrow(JsonLdValidationError);
    await expect(validateJsonLd('not-an-object')).rejects.toThrow('JSON-LD document must be an object');
    await expect(validateJsonLd(null)).rejects.toThrow('JSON-LD document must be an object');
    expect(toRDF).not.toHaveBeenCalled();
  });

  it('handles non-Error thrown values', async () => {
    toRDF.mockRejectedValue('string error');

    try {
      await validateJsonLd({});
      fail('Expected error');
    } catch (error) {
      expect(error).toBeInstanceOf(JsonLdValidationError);
      const validationError = error as JsonLdValidationError;
      expect(validationError.message).toContain('string error');
      expect(validationError.message).toContain('JSON-LD validation failed');
    }
  });
});
