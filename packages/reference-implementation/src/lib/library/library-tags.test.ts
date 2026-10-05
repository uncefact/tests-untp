import { LIBRARY_TAG_FORMAT_MESSAGE, libraryTagSchema } from './library-tags';

describe('libraryTagSchema', () => {
  it.each(['audit', 'audit-2026-q3', 'a', '7', 'cab-portal', 'x1-y2-z3'])(
    'accepts %j and returns it unchanged',
    (tag) => {
      expect(libraryTagSchema.parse(tag)).toBe(tag);
    },
  );

  it.each([
    ['a leading hyphen', '-audit'],
    ['a trailing hyphen', 'audit-'],
    ['two hyphens in a row', 'audit--2026'],
    ['a hyphen on its own', '-'],
    ['uppercase', 'Audit'],
    ['an underscore', 'audit_2026'],
    ['a space', 'audit 2026'],
    ['surrounding whitespace, which is not trimmed', ' audit'],
    ['the empty string', ''],
    ['a non-ASCII letter', 'audït'],
    ['a NUL character', 'audit\u0000'],
  ])('refuses %s with the grammar message and does not echo the value', (_, tag) => {
    const result = libraryTagSchema.safeParse(tag);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].message).toBe(LIBRARY_TAG_FORMAT_MESSAGE);
    }
  });

  it('refuses a value that is not a string', () => {
    const result = libraryTagSchema.safeParse(7);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe('must be a string');
  });
});
