import { formatValidationError } from '@/lib/formatValidationErrors';

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
    expect(formatValidationError(error)).toBe('Invalid type for user → personal → email: expected string');
  });

  // Test for complex nested path
  test('formats error with complex nested path', () => {
    const error = {
      keyword: 'const',
      instancePath: '/users/0/@details/settings/theme',
      params: { allowedValue: 'dark' },
    };
    expect(formatValidationError(error)).toBe(
      'Invalid value for users → 0 → details → settings → theme: must be one of [dark]',
    );
  });
});
