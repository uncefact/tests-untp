import { buildPayload, buildUrl } from '../helpers';

describe('buildUrl', () => {
  it('should build a URL with additional parameters', () => {
    const result = buildUrl('https://example.com', { param1: 'value1', param2: 'value2' });
    expect(result).toBe('https://example.com/?param1=value1&param2=value2');
  });

  it('should throw an error for empty baseUrl', () => {
    expect(() => buildUrl('', {})).toThrow('baseUrl must be a non-empty string.');
  });

  it('should throw an error for baseUrl without protocol', () => {
    expect(() => buildUrl('example.com', { param: 'value' })).toThrow(
      'baseUrl must be a valid URL, including the protocol (e.g., http:// or https://).',
    );
  });

  it('should throw an error for invalid baseUrl', () => {
    expect(() => buildUrl('not a url', {})).toThrow(
      'baseUrl must be a valid URL, including the protocol (e.g., http:// or https://).',
    );
  });

  it('should throw an error if additionalParams is not a plain object', () => {
    expect(() => buildUrl('https://example.com', [])).toThrow('additionalParams must be a plain object.');
  });

  it('should handle various value types in additionalParams, including objects and arrays', () => {
    const result = buildUrl('https://example.com', {
      string: 'value',
      number: 123,
      boolean: true,
      null: null,
      undefined: undefined,
      object: { key1: 'value1', key2: 2 },
      array: [1, 'two', { three: 3 }],
    });
    expect(result).toBe(
      'https://example.com/?string=value&number=123&boolean=true&null=null&undefined=undefined&object=%7B%22key1%22%3A%22value1%22%2C%22key2%22%3A2%7D&array=%5B1%2C%22two%22%2C%7B%22three%22%3A3%7D%5D',
    );
  });
});

describe('buildPayload', () => {
  it('should merge two objects correctly', () => {
    const result = buildPayload({ a: 1, b: 2 }, { c: 3, d: 4 });
    expect(result).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });

  it('should override additional payload with base payload', () => {
    const result = buildPayload({ a: 1, b: 2 }, { b: 3, c: 4 });
    expect(result).toEqual({ a: 1, b: 2, c: 4 });
  });

  it('should throw an error if basePayload is not a plain object', () => {
    expect(() => buildPayload([] as any, {})).toThrow('basePayload must be a plain object and cannot be null.');
  });

  it('should throw an error if additionalPayload is not a plain object', () => {
    expect(() => buildPayload({}, [] as any)).toThrow('additionalPayload must be a plain object and cannot be null.');
  });

  it('should throw an error if basePayload is null', () => {
    expect(() => buildPayload(null as any, {})).toThrow('basePayload must be a plain object and cannot be null.');
  });

  it('should throw an error if additionalPayload is null', () => {
    expect(() => buildPayload({}, null as any)).toThrow('additionalPayload must be a plain object and cannot be null.');
  });
});
