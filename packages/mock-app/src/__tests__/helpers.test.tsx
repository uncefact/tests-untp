import { convertPathToString } from '../utils';

describe('convertPathToString', () => {
  it('should convert a path to a string', () => {
    const path = '/sell-product/issue-dpp';
    const expected = 'Sell Product';
    const result = convertPathToString(path);
    expect(result).toEqual(expected);
  });

  it('should handle paths without a leading slash', () => {
    const path = 'sell-product/issue-dpp';
    const expected = 'Sell Product';
    const result = convertPathToString(path);
    expect(result).toEqual(expected);
  });

  it('should handle paths with only one segment', () => {
    const path = '/sell-product';
    const expected = 'Sell Product';
    const result = convertPathToString(path);
    expect(result).toEqual(expected);
  });

  it('should handle empty paths', () => {
    const path = '';
    const expected = '';
    const result = convertPathToString(path);
    expect(result).toEqual(expected);
  });
});
