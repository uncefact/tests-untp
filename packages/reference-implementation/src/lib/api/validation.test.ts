const mockValidatePublicUrl = jest.fn();
jest.mock('@uncefact/untp-ri-services/server', () => ({
  validatePublicUrl: (...args: unknown[]) => mockValidatePublicUrl(...args),
}));

import { z } from 'zod';
import {
  ValidationError,
  isNonEmptyString,
  validateEnum,
  parsePositiveInt,
  parseNonNegativeInt,
  parseBooleanString,
  assertPublicUrl,
  assertHttpUrl,
  parseRequestBody,
  parseQueryParams,
  definedFields,
} from './validation';
import { paginationQuerySchema } from './request-schemas/shared';

describe('isNonEmptyString', () => {
  it('returns true for a non-empty string', () => {
    expect(isNonEmptyString('hello')).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isNonEmptyString(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNonEmptyString(null)).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isNonEmptyString(123)).toBe(false);
  });
});

describe('validateEnum', () => {
  const permitted = ['A', 'B', 'C'] as const;

  it('returns the value if it is permitted', () => {
    expect(validateEnum('A', permitted, 'field')).toBe('A');
  });

  it('returns undefined when value is undefined', () => {
    expect(validateEnum(undefined, permitted, 'field')).toBeUndefined();
  });

  it('throws ValidationError for invalid value', () => {
    expect(() => validateEnum('X', permitted, 'field')).toThrow(ValidationError);
    expect(() => validateEnum('X', permitted, 'field')).toThrow('field must be one of: A, B, C');
  });
});

describe('parsePositiveInt', () => {
  it('parses a valid positive integer', () => {
    expect(parsePositiveInt('10', 'limit')).toBe(10);
  });

  it('returns undefined for null', () => {
    expect(parsePositiveInt(null, 'limit')).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parsePositiveInt(undefined, 'limit')).toBeUndefined();
  });

  it('throws for zero', () => {
    expect(() => parsePositiveInt('0', 'limit')).toThrow(ValidationError);
    expect(() => parsePositiveInt('0', 'limit')).toThrow('limit must be a positive integer');
  });

  it('throws for negative values', () => {
    expect(() => parsePositiveInt('-1', 'limit')).toThrow(ValidationError);
  });

  it('throws for non-numeric strings', () => {
    expect(() => parsePositiveInt('abc', 'limit')).toThrow(ValidationError);
  });
});

describe('parseNonNegativeInt', () => {
  it('parses a valid non-negative integer', () => {
    expect(parseNonNegativeInt('5', 'offset')).toBe(5);
  });

  it('allows zero', () => {
    expect(parseNonNegativeInt('0', 'offset')).toBe(0);
  });

  it('returns undefined for null', () => {
    expect(parseNonNegativeInt(null, 'offset')).toBeUndefined();
  });

  it('throws for negative values', () => {
    expect(() => parseNonNegativeInt('-1', 'offset')).toThrow(ValidationError);
    expect(() => parseNonNegativeInt('-1', 'offset')).toThrow('offset must be a non-negative integer');
  });

  it('throws for non-numeric strings', () => {
    expect(() => parseNonNegativeInt('abc', 'offset')).toThrow(ValidationError);
  });
});

describe('parseBooleanString', () => {
  it('returns undefined for null', () => {
    expect(parseBooleanString(null, 'active')).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parseBooleanString(undefined, 'active')).toBeUndefined();
  });

  it('returns true for "true"', () => {
    expect(parseBooleanString('true', 'active')).toBe(true);
  });

  it('returns false for "false"', () => {
    expect(parseBooleanString('false', 'active')).toBe(false);
  });

  it('throws for "TRUE" (case-sensitive)', () => {
    expect(() => parseBooleanString('TRUE', 'active')).toThrow(ValidationError);
    expect(() => parseBooleanString('TRUE', 'active')).toThrow('active must be "true" or "false"');
  });

  it('throws for "1"', () => {
    expect(() => parseBooleanString('1', 'active')).toThrow(ValidationError);
  });

  it('throws for "yes"', () => {
    expect(() => parseBooleanString('yes', 'active')).toThrow(ValidationError);
  });

  it('throws for empty string', () => {
    expect(() => parseBooleanString('', 'active')).toThrow(ValidationError);
  });
});

describe('assertHttpUrl', () => {
  it('returns the parsed URL for an http URL', () => {
    const url = assertHttpUrl('http://example.com/verify', 'humanVerificationUrl');
    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe('http:');
  });

  it('returns the parsed URL for an https URL', () => {
    const url = assertHttpUrl('https://example.com/verify', 'humanVerificationUrl');
    expect(url.protocol).toBe('https:');
  });

  it('throws ValidationError for a malformed URL', () => {
    expect(() => assertHttpUrl('not a url', 'humanVerificationUrl')).toThrow(ValidationError);
    expect(() => assertHttpUrl('not a url', 'humanVerificationUrl')).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('throws ValidationError for a relative URL', () => {
    expect(() => assertHttpUrl('/verify', 'humanVerificationUrl')).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('throws ValidationError for a non-http(s) scheme', () => {
    expect(() => assertHttpUrl('ftp://example.com/verify', 'humanVerificationUrl')).toThrow(ValidationError);
    expect(() => assertHttpUrl('ftp://example.com/verify', 'humanVerificationUrl')).toThrow(/must be an http\(s\) URL/);
    expect(() => assertHttpUrl('file:///etc/passwd', 'humanVerificationUrl')).toThrow(/must be an http\(s\) URL/);
  });

  it('accepts an uppercase scheme (normalised by the URL parser)', () => {
    const url = assertHttpUrl('HTTPS://example.com/verify', 'humanVerificationUrl');
    expect(url.protocol).toBe('https:');
  });

  it('throws ValidationError for a URL carrying userinfo', () => {
    expect(() => assertHttpUrl('https://user:pass@example.com/verify', 'humanVerificationUrl')).toThrow(
      ValidationError,
    );
    expect(() => assertHttpUrl('https://user:pass@example.com/verify', 'humanVerificationUrl')).toThrow(
      /must not contain a username or password/,
    );
    // A username with no password is rejected too.
    expect(() => assertHttpUrl('https://user@example.com/verify', 'humanVerificationUrl')).toThrow(
      /must not contain a username or password/,
    );
  });
});

describe('assertPublicUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws ValidationError for an invalid URL string', async () => {
    await expect(assertPublicUrl('not-a-url', 'schemaUrl')).rejects.toThrow(ValidationError);
    await expect(assertPublicUrl('not-a-url', 'schemaUrl')).rejects.toThrow(/must be a valid URL/);
  });

  it('throws ValidationError when validatePublicUrl rejects (private address)', async () => {
    mockValidatePublicUrl.mockRejectedValue(new Error('uri must not point to a private or reserved network address'));

    await expect(assertPublicUrl('http://127.0.0.1/test', 'schemaUrl')).rejects.toThrow(ValidationError);
    await expect(assertPublicUrl('http://127.0.0.1/test', 'schemaUrl')).rejects.toThrow(
      /must not point to a private or reserved network address/,
    );
  });

  it('throws ValidationError when hostname cannot be resolved', async () => {
    mockValidatePublicUrl.mockRejectedValue(new Error('uri hostname could not be resolved'));

    await expect(assertPublicUrl('https://nonexistent.invalid/test', 'schemaUrl')).rejects.toThrow(ValidationError);
    await expect(assertPublicUrl('https://nonexistent.invalid/test', 'schemaUrl')).rejects.toThrow(
      /hostname could not be resolved/,
    );
  });

  it('wraps unexpected errors from validatePublicUrl in ValidationError', async () => {
    mockValidatePublicUrl.mockRejectedValue(new TypeError('Unexpected internal error'));

    await expect(assertPublicUrl('https://example.com/test', 'schemaUrl')).rejects.toThrow(ValidationError);
    await expect(assertPublicUrl('https://example.com/test', 'schemaUrl')).rejects.toThrow(
      /schemaUrl could not be validated: Unexpected internal error/,
    );
  });

  it('resolves without throwing for a valid public URL', async () => {
    mockValidatePublicUrl.mockResolvedValue(undefined);

    await expect(assertPublicUrl('https://example.com/schema.json', 'schemaUrl')).resolves.toBeUndefined();
  });
});

describe('parseRequestBody', () => {
  const schema = z.object({ name: z.string().min(1), age: z.number().int().optional() });

  const fakeRequest = (body: unknown): { json: () => Promise<unknown> } => ({
    json: () => Promise.resolve(body),
  });

  const fakeMalformedRequest = (): { json: () => Promise<unknown> } => ({
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
  });

  it('resolves with the typed data for a valid body', async () => {
    await expect(parseRequestBody(fakeRequest({ name: 'Widget', age: 3 }), schema)).resolves.toEqual({
      name: 'Widget',
      age: 3,
    });
  });

  it('strips unknown keys', async () => {
    await expect(parseRequestBody(fakeRequest({ name: 'Widget', extra: 'x' }), schema)).resolves.toEqual({
      name: 'Widget',
    });
  });

  it('throws ValidationError for malformed JSON', async () => {
    await expect(parseRequestBody(fakeMalformedRequest(), schema)).rejects.toThrow(ValidationError);
    await expect(parseRequestBody(fakeMalformedRequest(), schema)).rejects.toThrow('Invalid JSON body');
  });

  it('throws ValidationError for a literal null body', async () => {
    await expect(parseRequestBody(fakeRequest(null), schema)).rejects.toThrow(ValidationError);
    await expect(parseRequestBody(fakeRequest(null), schema)).rejects.toThrow('body: Expected object, received null');
  });

  it('throws ValidationError for a literal null body even against a schema that would otherwise accept it', async () => {
    // z.unknown() accepts any value, including null, so the null->400 behaviour
    // relies on the explicit check in parseRequestBody, not on the schema's own
    // type check.
    const permissiveSchema = z.unknown();
    await expect(parseRequestBody(fakeRequest(null), permissiveSchema)).rejects.toThrow(ValidationError);
    await expect(parseRequestBody(fakeRequest(null), permissiveSchema)).rejects.toThrow(
      'body: Expected object, received null',
    );
  });

  it('throws ValidationError naming a missing required field', async () => {
    await expect(parseRequestBody(fakeRequest({}), schema)).rejects.toThrow('name: Required');
  });

  it('throws ValidationError naming a wrong-typed field', async () => {
    await expect(parseRequestBody(fakeRequest({ name: 'Widget', age: 'old' }), schema)).rejects.toThrow(
      'age: Expected number, received string',
    );
  });
});

describe('parseQueryParams', () => {
  const schema = z.object({
    status: z.enum(['active', 'inactive']).optional(),
    limit: z.coerce.number().int().positive().optional(),
  });

  it('accepts a URLSearchParams and returns the typed, coerced data', () => {
    const params = new URLSearchParams({ status: 'active', limit: '10' });
    expect(parseQueryParams(params, schema)).toEqual({ status: 'active', limit: 10 });
  });

  it('accepts a URL and reads its search params', () => {
    const url = new URL('https://example.com/api/v1/things?status=inactive');
    expect(parseQueryParams(url, schema)).toEqual({ status: 'inactive' });
  });

  it('returns an empty object when no query parameters are present', () => {
    expect(parseQueryParams(new URLSearchParams(), schema)).toEqual({});
  });

  it('throws ValidationError naming the first offending parameter', () => {
    const params = new URLSearchParams({ status: 'bogus' });
    expect(() => parseQueryParams(params, schema)).toThrow(ValidationError);
    expect(() => parseQueryParams(params, schema)).toThrow(/^status: /);
  });

  it('throws ValidationError for a non-integer value', () => {
    const params = new URLSearchParams({ limit: 'abc' });
    expect(() => parseQueryParams(params, schema)).toThrow(ValidationError);
    expect(() => parseQueryParams(params, schema)).toThrow(/^limit: /);
  });

  it('strips a query key the schema does not declare', () => {
    const params = new URLSearchParams({ status: 'active', extra: 'ignored' });
    expect(parseQueryParams(params, schema)).toEqual({ status: 'active' });
  });

  describe('repeated query keys', () => {
    it('throws ValidationError naming the repeated key when it repeats first', () => {
      const params = new URLSearchParams([
        ['status', 'active'],
        ['status', 'inactive'],
      ]);
      expect(() => parseQueryParams(params, schema)).toThrow(ValidationError);
      expect(() => parseQueryParams(params, schema)).toThrow('status: repeated query parameter');
    });

    it('throws ValidationError naming the repeated key when a different key repeats instead', () => {
      const params = new URLSearchParams([
        ['status', 'active'],
        ['limit', '10'],
        ['limit', '20'],
      ]);
      expect(() => parseQueryParams(params, schema)).toThrow(ValidationError);
      expect(() => parseQueryParams(params, schema)).toThrow('limit: repeated query parameter');
    });

    it('does not throw when every key appears once', () => {
      const params = new URLSearchParams([
        ['status', 'active'],
        ['limit', '10'],
      ]);
      expect(() => parseQueryParams(params, schema)).not.toThrow();
    });
  });

  it('renders the full composed pagination error end to end', () => {
    const params = new URLSearchParams({ limit: '0' });
    expect(() => parseQueryParams(params, paginationQuerySchema)).toThrow(ValidationError);
    expect(() => parseQueryParams(params, paginationQuerySchema)).toThrow('limit: must be a positive integer');
  });
});

describe('definedFields', () => {
  it('drops keys whose value is undefined', () => {
    expect(definedFields({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });

  it('keeps falsy-but-defined values', () => {
    expect(definedFields({ a: 0, b: '', c: false, d: null })).toEqual({ a: 0, b: '', c: false, d: null });
  });

  it('returns an empty object when every value is undefined', () => {
    expect(definedFields({ a: undefined, b: undefined })).toEqual({});
  });

  it('returns an equivalent object when no value is undefined', () => {
    expect(definedFields({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' });
  });
});
