import { formatValidationError, pointerSegments } from '@/lib/formatValidationErrors';

describe('formatValidationError', () => {
  // Required field tests
  test('formats root level required field error', () => {
    const error = {
      keyword: 'required',
      instancePath: '',
      params: { missingProperty: 'name' },
    };
    expect(formatValidationError(error)).toBe('Missing required field: name');
  });

  test('formats nested required field error', () => {
    const error = {
      keyword: 'required',
      instancePath: '/user/profile',
      params: { missingProperty: 'email' },
    };
    expect(formatValidationError(error)).toBe('Missing required field: user → profile → email');
  });

  // Const value tests
  test('formats const error with single value', () => {
    const error = {
      keyword: 'const',
      instancePath: '/type',
      params: { allowedValue: 'user' },
    };
    expect(formatValidationError(error)).toBe('Invalid value for type: must be one of [user]');
  });

  test('formats const error with multiple values', () => {
    const error = {
      keyword: 'const',
      instancePath: '/status',
      params: { allowedValue: ['active', 'inactive'] },
    };
    expect(formatValidationError(error)).toBe('Invalid value for status: must be one of [active or inactive]');
  });

  // Enum tests
  test('formats enum error', () => {
    const error = {
      keyword: 'enum',
      instancePath: '/role',
      params: { allowedValues: ['admin', 'user', 'guest'] },
    };
    expect(formatValidationError(error)).toBe('Invalid value for role: must be one of [admin, user, guest]');
  });

  // Type tests
  test('formats type error', () => {
    const error = {
      keyword: 'type',
      instancePath: '/age',
      params: { type: 'number' },
    };
    expect(formatValidationError(error)).toBe('Invalid type for age: expected number');
  });

  // Format tests
  test('formats format error', () => {
    const error = {
      keyword: 'format',
      instancePath: '/email',
      params: { format: 'email' },
    };
    expect(formatValidationError(error)).toBe('Invalid format for email: must be a valid email');
  });

  // Pattern tests
  test('formats pattern error', () => {
    const error = {
      keyword: 'pattern',
      instancePath: '/username',
      params: { pattern: '^[a-zA-Z0-9]+$' },
    };
    expect(formatValidationError(error)).toBe('Invalid format for username: must match pattern ^[a-zA-Z0-9]+$');
  });

  // Additional properties tests
  test('formats additional properties error', () => {
    const error = {
      keyword: 'additionalProperties',
      instancePath: '',
      params: { additionalProperty: 'unknownField' },
    };
    expect(formatValidationError(error)).toBe('Unknown field: unknownField');
  });

  // Default case test
  test('handles unknown validation error with message', () => {
    const error = {
      keyword: 'unknown',
      instancePath: '',
      message: 'Custom error message',
      params: {},
    };
    expect(formatValidationError(error)).toBe('Custom error message');
  });

  test('handles unknown validation error without message', () => {
    const error = {
      keyword: 'unknown',
      instancePath: '',
      params: {},
    };
    expect(formatValidationError(error)).toBe('Unknown validation error');
  });

  test('formats const error with empty path', () => {
    const error = {
      keyword: 'const',
      instancePath: '',
      params: { allowedValue: 'root' },
    };
    expect(formatValidationError(error)).toBe('Invalid value for field: must be one of [root]');
  });

  // Test for empty path with enum validation
  test('formats enum error with empty path', () => {
    const error = {
      keyword: 'enum',
      instancePath: '',
      params: { allowedValues: ['root1', 'root2'] },
    };
    expect(formatValidationError(error)).toBe('Invalid value for field: must be one of [root1, root2]');
  });

  // Test for path with @ character
  test('formats error with @ in path', () => {
    const error = {
      keyword: 'type',
      instancePath: '/user/@personal/email',
      params: { type: 'string' },
    };
    // Member names are shown as they are: `@personal` is the property's name.
    expect(formatValidationError(error)).toBe('Invalid type for user → @personal → email: expected string');
  });

  // Test for complex nested path
  test('formats error with complex nested path', () => {
    const error = {
      keyword: 'const',
      instancePath: '/users/0/@details/settings/theme',
      params: { allowedValue: 'dark' },
    };
    expect(formatValidationError(error)).toBe(
      'Invalid value for users → 0 → @details → settings → theme: must be one of [dark]',
    );
  });

  // JSON Pointer handling (#988): a link set names relations by URL, so keys contain `/`.
  test('names the location of an additional property below the root', () => {
    const error = {
      keyword: 'additionalProperties',
      instancePath: '/linkset/0/dpp/0',
      params: { additionalProperty: 'colour' },
    };
    expect(formatValidationError(error)).toBe('Unknown field at linkset → 0 → dpp → 0: colour');
  });

  test('decodes an escaped URL relation key in the path', () => {
    const error = {
      keyword: 'required',
      instancePath: '/linkset/0/https:~1~1test.uncefact.org~1voc~1untp~1dpp/0',
      params: { missingProperty: 'title' },
    };
    expect(formatValidationError(error)).toBe(
      'Missing required field: linkset → 0 → https://test.uncefact.org/voc/untp/dpp → 0 → title',
    );
  });

  test('keeps an empty pointer token rather than collapsing the location', () => {
    expect(pointerSegments('/a//b')).toEqual(['a', '', 'b']);
    expect(pointerSegments('')).toEqual([]);
    expect(pointerSegments('/x~0y')).toEqual(['x~y']);
  });

  test('appends the location to the default message', () => {
    const error = {
      keyword: 'minItems',
      instancePath: '/linkset',
      message: 'must NOT have fewer than 1 items',
      params: {},
    };
    expect(formatValidationError(error)).toBe('must NOT have fewer than 1 items at linkset');
  });

  test('renders an empty member name explicitly and decodes ~0 after ~1', () => {
    expect(formatValidationError({ keyword: 'type', instancePath: '/', params: { type: 'array' } })).toBe(
      'Invalid type for "": expected array',
    );
    expect(formatValidationError({ keyword: 'type', instancePath: '/~01', params: { type: 'array' } })).toBe(
      'Invalid type for ~1: expected array',
    );
    expect(formatValidationError({ keyword: 'type', instancePath: '/@context', params: { type: 'array' } })).toBe(
      'Invalid type for @context: expected array',
    );
  });

  test('names an empty offending member explicitly', () => {
    expect(
      formatValidationError({ keyword: 'additionalProperties', instancePath: '', params: { additionalProperty: '' } }),
    ).toBe('Unknown field: ""');
    expect(formatValidationError({ keyword: 'required', instancePath: '', params: { missingProperty: '' } })).toBe(
      'Missing required field: ""',
    );
  });
});
