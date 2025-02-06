import jsonld from 'jsonld';
import { validateRequiredFields, checkSyntaxError, checkInvalidContext, checkInvalidProperty, validateContext } from '@/lib/contextValidation';

jest.mock('jsonld', () => ({
  expand: jest.fn(),
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
          term: 'id'
        }
      };
      const result = checkSyntaxError(error);
      expect(result).toEqual({
        valid: false,
        term: 'id',
        errorMessage: 'Invalid JSON-LD syntax: redefine-protected-term; "id" is a protected term.'
      });
    });
  
    it('should return valid: false with unknown term when jsonld.SyntaxError lacks details', () => {
      const error = {
        name: 'jsonld.SyntaxError'
      };
      const result = checkSyntaxError(error);
      expect(result).toEqual({
        valid: false,
        term: 'unknown',
        errorMessage: 'Failed to validate JSON-LD syntax.'
      });
    });
  
    it('should return valid: true for non-jsonld.SyntaxError errors', () => {
      const error = { name: 'TypeError' };
      const result = checkSyntaxError(error);
      expect(result).toEqual({ valid: true });
    });
  
    it('should return valid: true when error is undefined or null', () => {
      expect(checkSyntaxError(undefined as unknown as { name: string, [key: string]: any })).toEqual({ valid: true });
      expect(checkSyntaxError(null as unknown as { name: string, [key: string]: any })).toEqual({ valid: true });
    });
  });

  describe('checkInvalidContext', () => {
    it('should return valid: false with invalidContextUrl and errorMessage when error is jsonld.InvalidUrl with url', () => {
      const error = { name: 'jsonld.InvalidUrl', url: 'https://invalid-url.com/context' };
      const result = checkInvalidContext(error);
      expect(result).toEqual({
        valid: false,
        invalidContextUrl: 'https://invalid-url.com/context',
        errorMessage: 'Invalid URL: "https://invalid-url.com/context". Failed to resolve context url.'
      });
    });
  
    it('should return valid: false with invalidContextUrl and errorMessage when error is jsonld.InvalidUrl with details.url', () => {
      const error = { name: 'jsonld.InvalidUrl', details: { url: 'https://another-invalid-url.com/context' } };
      const result = checkInvalidContext(error);
      expect(result).toEqual({
        valid: false,
        invalidContextUrl: 'https://another-invalid-url.com/context',
        errorMessage: 'Invalid URL: "https://another-invalid-url.com/context". Failed to resolve context url.'
      });
    });
  
    it('should return valid: false with unknown context url when no url is provided', () => {
      const error = { name: 'jsonld.InvalidUrl' };
      const result = checkInvalidContext(error);
      expect(result).toEqual({
        valid: false,
        invalidContextUrl: 'unknown',
        errorMessage: 'Failed to resolve context url.'
      });
    });
  
    it('should return valid: true when error is not jsonld.InvalidUrl', () => {
      const error = { name: 'TypeError' };
      const result = checkInvalidContext(error);
      expect(result).toEqual({ valid: true });
    });
  
    it('should return valid: true when error is undefined or null', () => {
      expect(checkInvalidContext(undefined as unknown as  { name: string, [key: string]: any })).toEqual({ valid: true });
      expect(checkInvalidContext(null as unknown as  { name: string, [key: string]: any })).toEqual({ valid: true });
    });
  });

  describe('checkInvalidProperty', () => {
    it('should return valid: false with invalidValue and errorMessage for jsonld.ValidationError with event details', () => {
      const error = {
        name: 'jsonld.ValidationError',
        details: {
          event: {
            code: 'invalid-property',
            details: { property: 'name' }
          }
        }
      };
      const result = checkInvalidProperty(error);
      expect(result).toEqual({
        valid: false,
        invalidValue: 'name',
        errorMessage: 'Invalid Property: "name" in the credential.'
      });
    });
  
    it('should return valid: false with unknown invalidValue when property is not provided', () => {
      const error = { name: 'jsonld.ValidationError' };
      const result = checkInvalidProperty(error);
      expect(result).toEqual({
        valid: false,
        invalidValue: 'unknown',
        errorMessage: 'Failed to validate properties in the credential.'
      });
    });
  
    it('should return valid: true for non-jsonld.ValidationError errors', () => {
      const error = { name: 'TypeError' };
      const result = checkInvalidProperty(error);
      expect(result).toEqual({ valid: true });
    });
  
    it('should return valid: true when error is undefined or null', () => {
      expect(checkInvalidProperty(undefined as unknown as  { name: string, [key: string]: any })).toEqual({ valid: true });
      expect(checkInvalidProperty(null as unknown as  { name: string, [key: string]: any })).toEqual({ valid: true });
    });
  });

  describe('validateContext', () => {
    it('should return valid when the credential is correct', async () => {
      const credential = { '@context': 'https://www.w3.org/2018/credentials/v1' };

      const result = await validateContext(credential);

      expect(result).toEqual({
        valid: true,
        data: jsonld.expand(credential)
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
          params: { missingProperty: '@context' }
        }
      });
    });

    it('should return invalid due to syntax error', async () => {
      const credential = {
        '@context': [
          { name: 'https://www.w3.org/ns/credentials/v2' },
          { name: 'http://xmlns.com/foaf/0.1/name' }
        ],
      };
      (jsonld.expand as jest.Mock).mockImplementationOnce(() => {
        throw { name: 'jsonld.SyntaxError', details: { code: 'redefine protected term', term: 'name' } };
      });

      const result = await validateContext(credential);
      expect(result).toEqual({
        valid: false,
        error: {
          keyword: 'conflictingProperties',
          message: 'Invalid JSON-LD syntax: redefine protected term; "name" is a protected term.',
          instancePath: '@context',
          params: {
            conflictingProperty: 'name'
          }
        }
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
        }
      });
    });

    it('should return invalid due to invalid property', async () => {
      const invalidPropertyCredential = {
        '@context': ['https://www.w3.org/2018/credentials/v2'],
        invalid: 'invalid-value'
      };
      (jsonld.expand as jest.Mock).mockImplementationOnce(() => {
        throw { name: 'jsonld.ValidationError', details: { event: { details: { property: 'invalid' } } } };
      });

      const result = await validateContext(invalidPropertyCredential);

      expect(result).toEqual({
        valid: false,
        error: {
          keyword: 'const',
          message: 'Invalid Property: "invalid" in the credential.',
          instancePath: 'invalid',
        }
      });
    });

    it('should return the default error when an unknown error occurs', async () => {
      const invalidCredential = {
        '@context': ['https://www.w3.org/2018/credentials/v2'],
        invalid: 'invalid-value'
      };
      (jsonld.expand as jest.Mock).mockImplementationOnce(() => { throw { name: 'unknown' } });

      const result = await validateContext(invalidCredential);

      expect(result).toEqual({
        valid: false,
        error: {
          keyword: 'unknown',
          message: 'Failed to validate context in credential',
          instancePath: '',
        }
      });
    });
  });
});
