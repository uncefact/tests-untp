import { constructorEntryData } from '../features';

describe('constructorEntryData', () => {
  it('should merge the data from the constructor entry', () => {
    const result = constructorEntryData({ data: { a: { c: 1 } } }, { data: { b: 2 } });
    expect(result).toEqual({
      data: { a: { c: 1 }, b: 2 },
    });
  });

  it('should throw an error if no data is provided', () => {
    expect(() => constructorEntryData()).toThrow('No data provided');
  });

  it('should throw an error if the data is nil', () => {
    expect(() => constructorEntryData(null)).toThrow('No data provided');
  });

  it('should return an empty object if the data is null', () => {
    const result = constructorEntryData({ data: null });
    expect(result).toEqual({});
  });

  it('should ignore null data and return the remaining valid data', () => {
    const result = constructorEntryData({ data: { a: 1 } }, { data: null });
    expect(result).toEqual({ data: { a: 1 } });
  });
});
