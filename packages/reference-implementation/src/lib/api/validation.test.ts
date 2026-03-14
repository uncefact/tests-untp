const mockValidatePublicUrl = jest.fn();
jest.mock('@uncefact/untp-ri-services/server', () => ({
  validatePublicUrl: (...args: unknown[]) => mockValidatePublicUrl(...args),
}));

import {
  ValidationError,
  isNonEmptyString,
  validateEnum,
  parsePositiveInt,
  parseNonNegativeInt,
  parseBooleanString,
  assertPublicUrl,
} from './validation';

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

  it('re-throws unexpected errors from validatePublicUrl', async () => {
    mockValidatePublicUrl.mockRejectedValue(new TypeError('Unexpected internal error'));

    await expect(assertPublicUrl('https://example.com/test', 'schemaUrl')).rejects.toThrow(TypeError);
    await expect(assertPublicUrl('https://example.com/test', 'schemaUrl')).rejects.toThrow('Unexpected internal error');
  });

  it('resolves without throwing for a valid public URL', async () => {
    mockValidatePublicUrl.mockResolvedValue(undefined);

    await expect(assertPublicUrl('https://example.com/schema.json', 'schemaUrl')).resolves.toBeUndefined();
  });
});
