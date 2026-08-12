import { readCacheMaxEntries, validateCacheMaxEntriesOnBoot } from './cache-max-entries.config';

describe('readCacheMaxEntries', () => {
  it('returns the default when CACHE_MAX_ENTRIES is unset or blank', () => {
    expect(readCacheMaxEntries({})).toBe(1000);
    expect(readCacheMaxEntries({ CACHE_MAX_ENTRIES: '   ' })).toBe(1000);
  });

  it('parses a positive integer', () => {
    expect(readCacheMaxEntries({ CACHE_MAX_ENTRIES: '250' })).toBe(250);
  });

  it.each(['0', '-5', '1.5', 'many', 'Infinity'])('throws on %s, naming the variable', (raw) => {
    expect(() => readCacheMaxEntries({ CACHE_MAX_ENTRIES: raw })).toThrow(/CACHE_MAX_ENTRIES/);
  });
});

describe('validateCacheMaxEntriesOnBoot', () => {
  it('passes when CACHE_MAX_ENTRIES is unset', () => {
    expect(() => validateCacheMaxEntriesOnBoot({})).not.toThrow();
  });

  it('throws at boot when CACHE_MAX_ENTRIES is invalid', () => {
    expect(() => validateCacheMaxEntriesOnBoot({ CACHE_MAX_ENTRIES: 'many' })).toThrow(/CACHE_MAX_ENTRIES/);
  });
});
