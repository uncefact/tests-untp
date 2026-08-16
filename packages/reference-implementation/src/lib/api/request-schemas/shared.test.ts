import { z } from 'zod';
import {
  idSchema,
  int32Schema,
  locationSchema,
  nonBlankString,
  requireAtLeastOneField,
  nonEmptyArraySchema,
  bcp47TagSchema,
  paginationQuerySchema,
  booleanQuerySchema,
  urlSchema,
} from './shared';

describe('idSchema', () => {
  it('accepts a non-empty string', () => {
    expect(idSchema.safeParse('id-123')).toEqual({ success: true, data: 'id-123' });
  });

  it('rejects an empty string', () => {
    expect(idSchema.safeParse('').success).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(idSchema.safeParse(123).success).toBe(false);
  });
});

describe('nonBlankString', () => {
  it('accepts a value with real content, keeping any padding verbatim', () => {
    expect(nonBlankString.safeParse('GS1')).toEqual({ success: true, data: 'GS1' });
    expect(nonBlankString.safeParse('  GS1  ')).toEqual({ success: true, data: '  GS1  ' });
  });

  it('rejects an empty string', () => {
    expect(nonBlankString.safeParse('').success).toBe(false);
  });

  it('rejects whitespace-only values with the dedicated message', () => {
    for (const value of [' ', '   ', '\t', ' \t\n ']) {
      const result = nonBlankString.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('must not be only whitespace');
      }
    }
  });

  it('rejects a non-string value', () => {
    expect(nonBlankString.safeParse(123).success).toBe(false);
  });
});

describe('int32Schema', () => {
  it('accepts zero', () => {
    expect(int32Schema.safeParse(0)).toEqual({ success: true, data: 0 });
  });

  it('accepts a negative value', () => {
    expect(int32Schema.safeParse(-5)).toEqual({ success: true, data: -5 });
  });

  it('accepts the int32 boundaries', () => {
    expect(int32Schema.safeParse(-2147483648).success).toBe(true);
    expect(int32Schema.safeParse(2147483647).success).toBe(true);
  });

  it('rejects a value above the int32 maximum', () => {
    expect(int32Schema.safeParse(2147483648).success).toBe(false);
  });

  it('rejects a value below the int32 minimum', () => {
    expect(int32Schema.safeParse(-2147483649).success).toBe(false);
  });

  it('rejects a non-integer number', () => {
    expect(int32Schema.safeParse(1.5).success).toBe(false);
  });

  it('rejects a non-numeric value', () => {
    expect(int32Schema.safeParse('5').success).toBe(false);
  });
});

describe('locationSchema', () => {
  it('accepts an arbitrary object', () => {
    expect(locationSchema.safeParse({ lat: 1, lon: 2 })).toEqual({ success: true, data: { lat: 1, lon: 2 } });
  });

  it('accepts an empty object', () => {
    expect(locationSchema.safeParse({})).toEqual({ success: true, data: {} });
  });

  it('rejects a non-object value', () => {
    expect(locationSchema.safeParse('somewhere').success).toBe(false);
  });

  it('rejects an array', () => {
    expect(locationSchema.safeParse(['somewhere']).success).toBe(false);
  });
});

describe('requireAtLeastOneField', () => {
  const updateSchema = requireAtLeastOneField(
    z.object({ name: z.string().optional(), age: z.number().optional() }),
    'At least one field must be provided',
  );

  it('accepts a body with one defined field', () => {
    expect(updateSchema.safeParse({ name: 'Widget' })).toEqual({ success: true, data: { name: 'Widget' } });
  });

  it('accepts a body with every field defined', () => {
    expect(updateSchema.safeParse({ name: 'Widget', age: 3 })).toEqual({
      success: true,
      data: { name: 'Widget', age: 3 },
    });
  });

  it('rejects an empty body with the given message', () => {
    const result = updateSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('At least one field must be provided');
    }
  });

  it('rejects a body whose only keys are explicitly undefined', () => {
    const result = updateSchema.safeParse({ name: undefined, age: undefined });
    expect(result.success).toBe(false);
  });

  it('rejects a body whose only key is unrecognised, exactly like an empty body', () => {
    // A typo'd field name (e.g. `neme` instead of `name`) must not satisfy the
    // precondition: it is not one of the schema's own keys, so the wrapped
    // schema would otherwise strip it to `{}` and silently no-op.
    const result = updateSchema.safeParse({ neme: 'Widget' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('At least one field must be provided');
    }
  });

  it('leaves a non-object body for the wrapped schema to report its own type error', () => {
    const result = updateSchema.safeParse('not-an-object');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Expected object, received string');
    }
  });

  describe('with a defaulted field', () => {
    const updateSchemaWithDefault = requireAtLeastOneField(
      z.object({ name: z.string().optional(), age: z.number().default(10) }),
      'At least one field must be provided',
    );

    it('rejects an empty body even though a field carries a default', () => {
      const result = updateSchemaWithDefault.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('At least one field must be provided');
      }
    });

    it('rejects a body whose only key is explicitly undefined, despite the default', () => {
      const result = updateSchemaWithDefault.safeParse({ age: undefined });
      expect(result.success).toBe(false);
    });

    it('accepts a body with a real field and fills the default for the rest', () => {
      expect(updateSchemaWithDefault.safeParse({ name: 'Widget' })).toEqual({
        success: true,
        data: { name: 'Widget', age: 10 },
      });
    });
  });
});

describe('nonEmptyArraySchema', () => {
  const itemsSchema = nonEmptyArraySchema(z.string().min(1));

  it('accepts a non-empty array of valid items', () => {
    expect(itemsSchema.safeParse(['a', 'b'])).toEqual({ success: true, data: ['a', 'b'] });
  });

  it('rejects an empty array', () => {
    const result = itemsSchema.safeParse([]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Request body must not be empty');
    }
  });

  it('rejects a non-array value', () => {
    const result = itemsSchema.safeParse('not-an-array');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Request body must be an array');
    }
  });

  it('rejects an array containing an invalid item', () => {
    expect(itemsSchema.safeParse(['a', '']).success).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('accepts both limit and offset', () => {
    expect(paginationQuerySchema.safeParse({ limit: '20', offset: '40' })).toEqual({
      success: true,
      data: { limit: 20, offset: 40 },
    });
  });

  it('accepts neither parameter, leaving both undefined', () => {
    expect(paginationQuerySchema.safeParse({})).toEqual({ success: true, data: {} });
  });

  it('accepts an offset of zero', () => {
    expect(paginationQuerySchema.safeParse({ offset: '0' })).toEqual({ success: true, data: { offset: 0 } });
  });

  it('accepts a limit at the maximum', () => {
    expect(paginationQuerySchema.safeParse({ limit: '100' })).toEqual({ success: true, data: { limit: 100 } });
  });

  it('rejects a limit above the maximum, naming the bound', () => {
    const result = paginationQuerySchema.safeParse({ limit: '101' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        path: ['limit'],
        message: 'must not exceed the maximum of 100',
      });
    }
  });

  describe('strict decimal integer matrix', () => {
    const acceptedLimits: Array<[string, number]> = [
      ['5', 5],
      ['+5', 5],
      [' 5 ', 5],
    ];

    it.each(acceptedLimits)('accepts limit %j as the numeric value %d', (raw, expected) => {
      expect(paginationQuerySchema.safeParse({ limit: raw })).toEqual({ success: true, data: { limit: expected } });
    });

    // 9007199254740993 is 2^53 + 1, the first integer Number cannot represent exactly.
    const rejectedLimits = [
      '1abc',
      '5.5',
      '5.0',
      '1e3',
      '0x10',
      '0b101',
      '0o17',
      '',
      '   ',
      '0',
      '-1',
      '9007199254740993',
      '99999999999999999999',
    ];

    it.each(rejectedLimits)('rejects limit %j', (raw) => {
      const result = paginationQuerySchema.safeParse({ limit: raw });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]).toMatchObject({ path: ['limit'], message: 'must be a positive integer' });
      }
    });

    const rejectedOffsets = [
      '1abc',
      '5.5',
      '5.0',
      '1e3',
      '0x10',
      '0b101',
      '0o17',
      '',
      '   ',
      '-1',
      '9007199254740993',
      '99999999999999999999',
    ];

    it.each(rejectedOffsets)('rejects offset %j', (raw) => {
      const result = paginationQuerySchema.safeParse({ offset: raw });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]).toMatchObject({ path: ['offset'], message: 'must be a non-negative integer' });
      }
    });

    it('rejects an all-digit value large enough to overflow Number to Infinity', () => {
      const overflowing = '9'.repeat(400);
      expect(Number(overflowing)).toBe(Infinity);
      expect(paginationQuerySchema.safeParse({ limit: overflowing }).success).toBe(false);
      expect(paginationQuerySchema.safeParse({ offset: overflowing }).success).toBe(false);
    });

    it('accepts a signed and whitespace-padded offset, at its numeric value', () => {
      expect(paginationQuerySchema.safeParse({ offset: ' +0 ' })).toEqual({ success: true, data: { offset: 0 } });
    });
  });

  it('composes with a resource-specific filter via merge, pagination last', () => {
    const resourceQuerySchema = z.object({ status: z.enum(['active', 'inactive']) }).merge(paginationQuerySchema);
    expect(resourceQuerySchema.safeParse({ limit: '10', status: 'active' })).toEqual({
      success: true,
      data: { limit: 10, status: 'active' },
    });
  });

  it('reports the resource-filter issue first when both the filter and pagination are invalid', () => {
    const resourceQuerySchema = z.object({ status: z.enum(['active', 'inactive']) }).merge(paginationQuerySchema);
    const result = resourceQuerySchema.safeParse({ status: 'bogus', limit: 'abc' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['status']);
    }
  });
});

describe('booleanQuerySchema', () => {
  const schema = z.object({ active: booleanQuerySchema });

  it('leaves the field undefined when absent', () => {
    expect(schema.safeParse({})).toEqual({ success: true, data: {} });
  });

  it('parses "true" as true', () => {
    expect(schema.safeParse({ active: 'true' })).toEqual({ success: true, data: { active: true } });
  });

  it('parses "false" as false', () => {
    expect(schema.safeParse({ active: 'false' })).toEqual({ success: true, data: { active: false } });
  });

  it.each(['TRUE', '1', 'yes', ''])('rejects %j', (raw) => {
    const result = schema.safeParse({ active: raw });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({ path: ['active'], message: 'must be "true" or "false"' });
    }
  });
});

describe('bcp47TagSchema', () => {
  // The accept set spans the grammar's three alternatives: ordinary langtags,
  // private-use-only tags, and grandfathered tags, since Intl-based
  // validators wrongly reject the latter two (the reason this schema exists).
  it.each(['en', 'en-AU', 'en-GB', 'zh-Hant-TW', 'de-DE-1996', 'x-default', 'x-private', 'en-GB-oed', 'i-default'])(
    'accepts the well-formed tag %s',
    (tag) => {
      expect(bcp47TagSchema.safeParse(tag).success).toBe(true);
    },
  );

  it('accepts tags case-insensitively as the RFC specifies', () => {
    expect(bcp47TagSchema.safeParse('EN-au').success).toBe(true);
    expect(bcp47TagSchema.safeParse('X-DEFAULT').success).toBe(true);
  });

  it.each(['', ' ', 'en_US', 'not a tag', 'a', 'en-', '-en', '123', 'en--US', 'x-', 'toolongsubtag1'])(
    'rejects the malformed value %j with the named message, never a throw',
    (value) => {
      const result = bcp47TagSchema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('BCP 47');
      }
    },
  );
});

describe('bcp47TagSchema uniqueness rules', () => {
  it('accepts a grammar-valid tag of any length (RFC 5646 defines no upper bound)', () => {
    // Fifteen distinct well-formed 8-character variant subtags, so the
    // length alone is what a cap would reject.
    const tag = 'en' + Array.from({ length: 15 }, (_, i) => `-varian${i.toString().padStart(2, '0')}`).join('');
    expect(tag.length).toBeGreaterThan(100);
    expect(bcp47TagSchema.safeParse(tag).success).toBe(true);
  });

  it.each([
    ['a repeated variant', 'de-DE-1901-1901'],
    ['a repeated extension singleton', 'en-a-bbb-a-ccc'],
    ['a repeated singleton in either case', 'en-A-bbb-a-ccc'],
  ])('rejects %s', (_label, tag) => {
    expect(bcp47TagSchema.safeParse(tag).success).toBe(false);
  });

  it.each([
    ['distinct variants', 'sl-rozaj-biske'],
    ['distinct singletons', 'en-a-bbb-b-ccc'],
    ['a private-use suffix after an extension', 'en-a-bbb-x-private'],
    // Private use carries no variants or extensions, so repetition inside it
    // is well-formed and uniqueness must not be applied there.
    ['a private-use-only tag with repeated subtags', 'x-a-a'],
    ['a private-use-only tag with repeated longer subtags', 'x-aaaaa-aaaaa'],
    ['a private-use-only tag with repeated digit-initial subtags', 'x-1901-1901'],
    ['a private-use-only tag repeating a word', 'x-default-default'],
    ['a repeated subtag inside a private-use suffix', 'en-a-bbb-x-a-ccc'],
  ])('still accepts %s', (_label, tag) => {
    expect(bcp47TagSchema.safeParse(tag).success).toBe(true);
  });
});

describe('urlSchema', () => {
  it('accepts an ordinary http(s) URL and returns it unchanged', () => {
    const result = urlSchema.safeParse('https://gs1.org/standards');

    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe('https://gs1.org/standards');
  });

  it.each([
    ['a value that is not a URL', 'not-a-url'],
    ['a bare path', '/standards'],
    ['an empty string', ''],
  ])('rejects %s with the valid-URL message', (_label, value) => {
    const result = urlSchema.safeParse(value);

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toBe('must be a valid URL');
  });

  it.each([
    ['leading whitespace', ' https://gs1.org'],
    ['trailing whitespace', 'https://gs1.org '],
  ])('rejects %s rather than trimming it, since the value is stored as sent', (_label, value) => {
    const result = urlSchema.safeParse(value);

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toBe('must not have leading or trailing whitespace');
  });

  // The schema is a format check only. Each of these is left for the route
  // handler's assertHttpUrl and assertPublicUrl, so the contract the two
  // consumers rely on is that the schema does NOT reject them.
  it.each([
    ['a non-http scheme', 'javascript:alert(1)'],
    ['embedded userinfo', 'https://user:pass@gs1.org'],
    ['a private address', 'http://127.0.0.1/registry'],
    ['a percent sign RFC 3986 forbids, which WHATWG parsing accepts', 'https://example.com/%'],
  ])('accepts %s, leaving it to the handler-level checks', (_label, value) => {
    expect(urlSchema.safeParse(value).success).toBe(true);
  });
});
