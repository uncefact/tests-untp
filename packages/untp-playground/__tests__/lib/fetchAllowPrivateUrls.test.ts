import { readFetchAllowPrivateUrls } from '@/lib/fetchAllowPrivateUrls';

describe('readFetchAllowPrivateUrls', () => {
  it.each([
    { label: 'unset', value: undefined, expected: false },
    { label: 'exact lowercase true', value: 'true', expected: true },
    { label: 'explicit false', value: 'false', expected: false },
    { label: 'empty string', value: '', expected: false },
    { label: 'whitespace only', value: '   ', expected: false },
    { label: 'padded true', value: ' true ', expected: false },
    { label: 'uppercase TRUE', value: 'TRUE', expected: false },
  ])('returns $expected for $label', ({ value, expected }) => {
    expect(readFetchAllowPrivateUrls({ FETCH_ALLOW_PRIVATE_URLS: value })).toBe(expected);
  });
});
