import { findFirstMatchingKeyValue } from '../../features/findFirstMatchingKeyValue.service';

describe('findFirstMatchingKeyValue', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Test data with nested objects
  const testData = {
    level1: {
      level2: {
        key1: 'value1',
        key2: 'value2',
      },
      level3: {
        key3: 'value3',
      },
    },
    level4: {
      level5: {
        key6: {
          key7: 'value7',
        },
      },
    },
  };

  it('should return the value of a matching key at the first level', () => {
    const result = findFirstMatchingKeyValue(testData, { targetKey: 'level4' });
    expect(result).toEqual(testData.level4);
  });

  it('should return the value of a deeply nested matching key', () => {
    const result = findFirstMatchingKeyValue(testData, { targetKey: 'key7' });
    expect(result).toBe('value7');
  });

  it('should return undefined for a non-existing key', () => {
    const result = findFirstMatchingKeyValue(testData, { targetKey: 'nonExistentKey' });
    expect(result).toBeUndefined();
  });

  it('should return undefined if the input data is null', () => {
    const result = findFirstMatchingKeyValue(null as any, { targetKey: 'key1' });
    expect(result).toBeUndefined();
  });

  it('should return undefined if the input data is undefined', () => {
    const result = findFirstMatchingKeyValue(undefined as any, { targetKey: 'key1' });
    expect(result).toBeUndefined();
  });

  it('should return undefined if the parameters object is null', () => {
    const result = findFirstMatchingKeyValue(testData, null as any);
    expect(result).toBeUndefined();
  });

  it('should return undefined if the parameters object is undefined', () => {
    const result = findFirstMatchingKeyValue(testData, undefined as any);
    expect(result).toBeUndefined();
  });

  it('should return undefined if targetKey is missing in parameters', () => {
    const result = findFirstMatchingKeyValue(testData, {} as any);
    expect(result).toBeUndefined();
  });

  it('should handle empty input data object', () => {
    const result = findFirstMatchingKeyValue({}, { targetKey: 'key1' });
    expect(result).toBeUndefined();
  });

  it('should handle data with mixed types (not just objects)', () => {
    const mixedData = {
      level1: 'stringValue',
      level2: 123,
      level3: {
        key1: 'value1',
      },
      level4: null,
    };

    expect(findFirstMatchingKeyValue(mixedData, { targetKey: 'level1' })).toBe('stringValue');
    expect(findFirstMatchingKeyValue(mixedData, { targetKey: 'level2' })).toBe(123);
    expect(findFirstMatchingKeyValue(mixedData, { targetKey: 'key1' })).toBe('value1');
    expect(findFirstMatchingKeyValue(mixedData, { targetKey: 'level4' })).toBeNull();
  });
});
