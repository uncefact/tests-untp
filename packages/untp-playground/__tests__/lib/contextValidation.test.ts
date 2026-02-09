import jsonld from 'jsonld';
import {
  validateRequiredFields,
  checkSyntaxError,
  checkInvalidContext,
  checkInvalidProperties,
  validateContext,
  getDroppedProperties,
} from '@/lib/contextValidation';

jest.mock('jsonld', () => ({
  expand: jest.fn(),
  compact: jest.fn(),
}));

describe('contextValidation', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('validateRequiredFields', () => {
    it('should return valid: true when the credential is a valid JSON object with @context', () => {
      const credential = { '@context': 'https://www.w3.org/2018/credentials/v1' };
      const result = validateRequiredFields(credential);
      expect(result).toEqual({ valid: true, errorMessage: '' });
    });

    it('should return valid: false when the input is not an object (null)', () => {
      const credential = null;
      const result = validateRequiredFields(credential as unknown as Record<string, any>);
      expect(result).toEqual({ valid: false, errorMessage: 'Invalid JSON-LD document: must be a JSON object' });
    });

    it('should return valid: false when the input is not an object (primitive type)', () => {
      const credential = 'string';
      const result = validateRequiredFields(credential as unknown as Record<string, any>);
      expect(result).toEqual({ valid: false, errorMessage: 'Invalid JSON-LD document: must be a JSON object' });
    });

    it('should return valid: false when the credential does not contain @context property', () => {
      const credential = { id: '1234' };
      const result = validateRequiredFields(credential);
      expect(result).toEqual({ valid: false, errorMessage: 'Missing required "@context" property in credential.' });
    });
  });

  describe('checkSyntaxError', () => {
    it('should return valid: false with term and errorMessage for jsonld.SyntaxError with details', () => {
      const error = {
        name: 'jsonld.SyntaxError',
        details: {
          code: 'redefine-protected-term',
          term: 'id',
        },
      };
      const result = checkSyntaxError(error);
      expect(result).toEqual({
        keyword: 'conflictingProperties',
        valid: false,
        term: 'id',
        errorMessage: 'Invalid JSON-LD syntax: redefine-protected-term. "id" is a protected term.',
      });
    });

    it('should return valid: false with unknown term when jsonld.SyntaxError lacks details', () => {
      const error = {
        name: 'jsonld.SyntaxError',
        message: 'Failed to validate JSON-LD syntax.',
      };
      const result = checkSyntaxError(error);
      expect(result).toEqual({
        keyword: 'const',
        valid: false,
        term: 'unknown',
        errorMessage: 'Failed to validate JSON-LD syntax.',
      });
    });

    it('should return valid: true for non-jsonld.SyntaxError errors', () => {
      const error = { name: 'TypeError' };
      const result = checkSyntaxError(error);
      expect(result).toEqual({ valid: true });
    });

    it('should return valid: true when error is undefined or null', () => {
      expect(checkSyntaxError(undefined as unknown as { name: string; [key: string]: any })).toEqual({ valid: true });
      expect(checkSyntaxError(null as unknown as { name: string; [key: string]: any })).toEqual({ valid: true });
    });
  });

  describe('checkInvalidContext', () => {
    it('should return valid: false with invalidContextUrl and errorMessage when error is jsonld.InvalidUrl with url', () => {
      const error = { name: 'jsonld.InvalidUrl', url: 'https://invalid-url.com/context' };
      const result = checkInvalidContext(error);
      expect(result).toEqual({
        valid: false,
        invalidContextUrl: 'https://invalid-url.com/context',
        errorMessage: 'Invalid URL: "https://invalid-url.com/context". Failed to resolve context url.',
      });
    });

    it('should return valid: false with invalidContextUrl and errorMessage when error is jsonld.InvalidUrl with details.url', () => {
      const error = { name: 'jsonld.InvalidUrl', details: { url: 'https://another-invalid-url.com/context' } };
      const result = checkInvalidContext(error);
      expect(result).toEqual({
        valid: false,
        invalidContextUrl: 'https://another-invalid-url.com/context',
        errorMessage: 'Invalid URL: "https://another-invalid-url.com/context". Failed to resolve context url.',
      });
    });

    it('should return valid: false with unknown context url when no url is provided', () => {
      const error = { name: 'jsonld.InvalidUrl' };
      const result = checkInvalidContext(error);
      expect(result).toEqual({
        valid: false,
        invalidContextUrl: 'unknown',
        errorMessage: 'Failed to resolve context url.',
      });
    });

    it('should return valid: true when error is not jsonld.InvalidUrl', () => {
      const error = { name: 'TypeError' };
      const result = checkInvalidContext(error);
      expect(result).toEqual({ valid: true });
    });

    it('should return valid: true when error is undefined or null', () => {
      expect(checkInvalidContext(undefined as unknown as { name: string; [key: string]: any })).toEqual({
        valid: true,
      });
      expect(checkInvalidContext(null as unknown as { name: string; [key: string]: any })).toEqual({ valid: true });
    });
  });

  describe('checkInvalidProperties', () => {
    it('should return valid: false with dropped properties and errorMessage for jsonld.ValidationError', async () => {
      const credential = { '@context': 'https://schema.org', name: 'Test', age: 25 };
      const compacted = { '@context': 'https://schema.org', name: 'Test' };

      (jsonld.expand as jest.Mock).mockResolvedValue(credential);
      (jsonld.compact as jest.Mock).mockResolvedValue(compacted);

      const error = { name: 'jsonld.ValidationError' };
      const result = await checkInvalidProperties(error, credential);

      expect(result).toEqual({
        valid: false,
        invalidValues: 'age',
        errorMessage: 'Properties "age" are defined in the credential but missing from the context.',
      });
    });

    it('should handle multiple dropped properties', async () => {
      const credential = { '@context': 'https://schema.org', name: 'Test', age: 25, gender: 'male' };
      const compacted = { '@context': 'https://schema.org', name: 'Test' };

      (jsonld.expand as jest.Mock).mockResolvedValue(credential);
      (jsonld.compact as jest.Mock).mockResolvedValue(compacted);

      const error = { name: 'jsonld.ValidationError' };
      const result = await checkInvalidProperties(error, credential);

      expect(result).toEqual({
        valid: false,
        invalidValues: 'age, gender',
        errorMessage: 'Properties "age, gender" are defined in the credential but missing from the context.',
      });
    });

    it('should return valid: false with unknown invalidValues when no properties are dropped', async () => {
      const credential = { '@context': 'https://schema.org', name: 'Test' };
      const compacted = { '@context': 'https://schema.org', name: 'Test' };

      (jsonld.expand as jest.Mock).mockResolvedValue(credential);
      (jsonld.compact as jest.Mock).mockResolvedValue(compacted);

      const error = { name: 'jsonld.ValidationError' };
      const result = await checkInvalidProperties(error, credential);

      expect(result).toEqual({
        valid: false,
        invalidValues: 'unknown',
        errorMessage: 'Failed to validate properties in the credential.',
      });
    });

    it('should return valid: true for non-jsonld.ValidationError errors', async () => {
      const credential = { '@context': 'https://schema.org', name: 'Test' };
      const error = { name: 'TypeError' };

      const result = await checkInvalidProperties(error, credential);
      expect(result).toEqual({ valid: true });
    });

    it('should return valid: true when error is undefined or null', async () => {
      const credential = { '@context': 'https://schema.org', name: 'Test' };

      expect(await checkInvalidProperties(undefined as any, credential)).toEqual({ valid: true });
      expect(await checkInvalidProperties(null as any, credential)).toEqual({ valid: true });
    });
  });

  // Tests for getDroppedProperties
  describe('getDroppedProperties', () => {
    it('should return dropped properties correctly', () => {
      const original = { name: 'Alice', age: 30, address: { city: 'Wonderland', zip: '12345' } };
      const compacted = { name: 'Alice', address: { city: 'Wonderland' } };

      const result = getDroppedProperties(original, compacted);
      expect(result).toEqual(['age', 'address/zip']);
    });

    it('should return an empty array when no properties are dropped', () => {
      const original = { name: 'Alice', age: 30 };
      const compacted = { name: 'Alice', age: 30 };

      const result = getDroppedProperties(original, compacted);
      expect(result).toEqual([]);
    });

    it('should exclude specified fields like @context', () => {
      const original = { '@context': 'https://schema.org', name: 'Alice', age: 30 };
      const compacted = { name: 'Alice' };

      const result = getDroppedProperties(original, compacted);
      expect(result).toEqual(['age']);
    });
  });

  describe('validateContext', () => {
    it('should return valid when the credential is correct', async () => {
      const credential = {
        '@context': [
          {
            name: 'https://schema.org/name',
            phone: 'https://schema.org/telephone',
            address: 'https://schema.org/address',
          },
        ],
        name: 'Test',
      };

      const result = await validateContext(credential);

      expect(result).toEqual({
        valid: true,
        data: {
          '@context': 'https://schema.org',
          name: 'Test',
        },
      });
    });

    it('should return invalid when missing @context', async () => {
      const credential = { id: '1234' };

      const result = await validateContext(credential);

      expect(result).toEqual({
        valid: false,
        error: {
          keyword: 'required',
          message: 'Missing required "@context" property in credential.',
          instancePath: '',
          params: { missingProperty: '@context' },
        },
      });
    });

    it('should return invalid due to syntax error', async () => {
      const credential = {
        '@context': [{ name: 'https://www.w3.org/ns/credentials/v2' }, { name: 'http://xmlns.com/foaf/0.1/name' }],
      };
      (jsonld.expand as jest.Mock).mockImplementationOnce(() => {
        throw { name: 'jsonld.SyntaxError', details: { code: 'redefine protected term', term: 'name' } };
      });

      const result = await validateContext(credential);
      expect(result).toEqual({
        valid: false,
        error: {
          keyword: 'conflictingProperties',
          message: 'Invalid JSON-LD syntax: redefine protected term. "name" is a protected term.',
          instancePath: '@context',
          params: {
            conflictingProperty: 'name',
          },
        },
      });
    });

    it('should return invalid due to invalid context URL', async () => {
      const credential = { '@context': 'invalid-context' };
      (jsonld.expand as jest.Mock).mockImplementationOnce(() => {
        throw { name: 'jsonld.InvalidUrl', details: { url: 'invalid-context' } };
      });

      const result = await validateContext(credential);

      expect(result).toEqual({
        valid: false,
        error: {
          keyword: 'const',
          message: 'Invalid URL: "invalid-context". Failed to resolve context url.',
          instancePath: '@context',
        },
      });
    });

    it('should return invalid due to invalid property', async () => {
      const invalidPropertyCredential = {
        '@context': ['https://www.w3.org/2018/credentials/v2'],
        invalid1: 'invalid-value-1',
        invalid2: 'invalid-value-2',
      };
      (jsonld.expand as jest.Mock).mockImplementationOnce(() => {
        throw { name: 'jsonld.ValidationError', details: { event: { details: { property: 'invalid' } } } };
      });

      const result = await validateContext(invalidPropertyCredential);

      expect(result).toEqual({
        valid: false,
        error: {
          keyword: 'const',
          message: 'Properties "invalid1, invalid2" are defined in the credential but missing from the context.',
          instancePath: 'invalid1, invalid2',
        },
      });
    });

    it('should return the default error when an unknown error occurs', async () => {
      const invalidCredential = {
        '@context': ['https://www.w3.org/2018/credentials/v2'],
        invalid: 'invalid-value',
      };
      (jsonld.expand as jest.Mock).mockImplementationOnce(() => {
        throw { name: 'unknown' };
      });

      const result = await validateContext(invalidCredential);

      expect(result).toEqual({
        valid: false,
        error: {
          keyword: 'unknown',
          message: 'Failed to validate context in credential',
          instancePath: '',
        },
      });
    });
  });
});
