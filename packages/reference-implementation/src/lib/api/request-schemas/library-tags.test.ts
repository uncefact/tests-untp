import { z } from 'zod';
import { libraryTagListSchema } from './library-tags';

const LIMIT_SETTINGS = ['API_MAX_TAGS_PER_RECORD', 'API_MAX_TAG_LENGTH'] as const;
const originals = Object.fromEntries(LIMIT_SETTINGS.map((name) => [name, process.env[name]]));

beforeEach(() => {
  for (const name of LIMIT_SETTINGS) delete process.env[name];
});

afterAll(() => {
  for (const name of LIMIT_SETTINGS) {
    if (originals[name] === undefined) delete process.env[name];
    else process.env[name] = originals[name];
  }
});

/** n distinct grammar-valid tags of exactly `length` characters. */
function tagsOf(n: number, length: number): string[] {
  return Array.from({ length: n }, (_, i) => `${i}`.padStart(length, 'a'));
}

/** Path and message of every issue, as the routes render them. */
function issuesOf(schema: z.ZodTypeAny, value: unknown): string[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('libraryTagListSchema', () => {
  it('accepts a list and keeps the submitted order, without sorting or de-duplicating', () => {
    expect(libraryTagListSchema.parse(['zeta', 'audit-2026-q3', 'alpha'])).toEqual(['zeta', 'audit-2026-q3', 'alpha']);
  });

  it('accepts an empty list', () => {
    expect(libraryTagListSchema.parse([])).toEqual([]);
  });

  it('refuses a tag that breaks the grammar at its index', () => {
    expect(issuesOf(z.object({ tags: libraryTagListSchema }), { tags: ['audit', 'Audit'] })).toEqual([
      'tags.1: must be lowercase letters and digits, with single hyphens between them',
    ]);
  });

  it('refuses a repeated tag at the repeat, pointing back at the first occurrence', () => {
    expect(issuesOf(z.object({ tags: libraryTagListSchema }), { tags: ['a', 'b', 'a'] })).toEqual([
      'tags.2: must not repeat a tag; duplicates tags.0',
    ]);
  });

  it('points every later repeat at the first occurrence', () => {
    expect(issuesOf(z.object({ tags: libraryTagListSchema }), { tags: ['a', 'b', 'b', 'c', 'b'] })).toEqual([
      'tags.2: must not repeat a tag; duplicates tags.1',
      'tags.4: must not repeat a tag; duplicates tags.1',
    ]);
  });

  it('builds the back-reference from where the list sits, so a nested list names its full path', () => {
    const nested = z.object({ items: z.array(z.object({ tags: libraryTagListSchema })) });

    expect(issuesOf(nested, { items: [{ tags: [] }, { tags: ['x', 'y', 'z', 'y'] }] })).toEqual([
      'items.1.tags.3: must not repeat a tag; duplicates items.1.tags.1',
    ]);
  });

  describe('under the default limits', () => {
    it('accepts 10 tags of 64 characters', () => {
      const tags = tagsOf(10, 64);

      expect(libraryTagListSchema.parse(tags)).toEqual(tags);
    });

    it('refuses 11 tags, naming the limit on the list', () => {
      expect(issuesOf(z.object({ tags: libraryTagListSchema }), { tags: tagsOf(11, 1) })).toEqual([
        'tags: must contain no more than 10 tags',
      ]);
    });

    it('refuses a 65-character tag at its index, naming the limit', () => {
      const tags = ['audit', 'a'.repeat(65)];

      expect(issuesOf(z.object({ tags: libraryTagListSchema }), { tags })).toEqual([
        'tags.1: must be no longer than 64 characters',
      ]);
    });
  });

  describe('under limits the deployment sets', () => {
    it('accepts 12 tags of 80 characters when both limits are raised', () => {
      process.env.API_MAX_TAGS_PER_RECORD = '12';
      process.env.API_MAX_TAG_LENGTH = '80';
      const tags = tagsOf(12, 80);

      expect(libraryTagListSchema.parse(tags)).toEqual(tags);
    });

    it('refuses 13 tags and an 81-character tag under the raised limits', () => {
      process.env.API_MAX_TAGS_PER_RECORD = '12';
      process.env.API_MAX_TAG_LENGTH = '80';

      expect(issuesOf(libraryTagListSchema, tagsOf(13, 1))).toEqual([': must contain no more than 12 tags']);
      expect(issuesOf(libraryTagListSchema, tagsOf(1, 81))).toEqual(['0: must be no longer than 80 characters']);
    });

    it('refuses 3 tags when the count limit is lowered to 2', () => {
      process.env.API_MAX_TAGS_PER_RECORD = '2';

      expect(libraryTagListSchema.safeParse(['a', 'b']).success).toBe(true);
      expect(issuesOf(libraryTagListSchema, ['a', 'b', 'c'])).toEqual([': must contain no more than 2 tags']);
    });

    it('refuses a tag longer than a lowered length limit', () => {
      process.env.API_MAX_TAG_LENGTH = '4';

      expect(libraryTagListSchema.safeParse(['abcd']).success).toBe(true);
      expect(issuesOf(libraryTagListSchema, ['abcde'])).toEqual(['0: must be no longer than 4 characters']);
    });
  });

  it('refuses a missing list and a value that is not an array with their own messages', () => {
    const body = z.object({ tags: libraryTagListSchema });

    expect(issuesOf(body, {})).toEqual(['tags: is required']);
    expect(issuesOf(body, { tags: 'audit' })).toEqual(['tags: must be an array']);
    expect(issuesOf(body, { tags: null })).toEqual(['tags: must be an array']);
    expect(issuesOf(body, { tags: [7] })).toEqual(['tags.0: must be a string']);
  });

  it('never echoes a submitted value in any message', () => {
    process.env.API_MAX_TAGS_PER_RECORD = '2';
    process.env.API_MAX_TAG_LENGTH = '10';
    const secret = 'secretvalue';
    const messages = issuesOf(libraryTagListSchema, [secret, 'Secret', `${secret}-long`, secret]);

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(message.toLowerCase()).not.toContain('secret');
  });
});
