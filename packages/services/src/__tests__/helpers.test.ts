import {
  fillArray,
  randomIntegerString,
  generateUUID,
  incrementQuality,
  createNestedObject,
} from '../utils/helpers';

describe('first', () => {
  it('should return an array with the same length as the first argument', () => {
    const first = [1, 2, 3];
    const second = [{ a: 1 }];
    const result = fillArray(first, second);
    expect(result.length).toBe(first.length);
  });

  it('should return an array with the same length as the first argument', () => {
    const first = [1, 2, 3];
    const second = [{ a: 1 }];
    const result = fillArray(first, second);
    expect(result.length).toBe(first.length);
  });

  it('should return a random integer with 5 digits', () => {
    const result = randomIntegerString(5);
    expect(result.length).toBe(5);
  });

  it('should generate uuid', () => {
    const result = generateUUID();
    expect(result).toBeDefined();
  });

  it('should multiply the quantity property by the given number', () => {
    const obj = { quantity: 2 };
    const result = incrementQuality(obj, 3);
    expect(result.quantity).toBe(6);
  });

  it('should not modify the object if there is no quantity property', () => {
    const obj = { otherProp: 2 };
    const result = incrementQuality(obj, 3);
    expect(result).toEqual({ otherProp: 2 });
  });

  it('should not modify the object if the number of items is 1', () => {
    const obj = { quantity: 2 };
    const result = incrementQuality(obj, 1);
    expect(result.quantity).toBe(2);
  });
});

describe('createNestedObject', () => {
  it('Should return an empty object when keys array is empty', () => {
    const keys: string[] = [];
    const data = 'data';

    const result = createNestedObject(keys, data);

    expect(result).toEqual({});
  });

  it('Should return an object with one property when keys array has one element', () => {
    const keys = ['field1'];
    const data = 'data';

    const result = createNestedObject(keys, data);

    expect(result).toEqual({ field1: 'data' });
  });

  it('Should return an object with nested properties when keys array has multiple elements', () => {
    const keys = ['a', 'b', 'c'];
    const data = 'data';

    const result = createNestedObject(keys, data);

    expect(result).toEqual({ a: { b: { c: 'data' } } });
  });

  it('Should assign the data to the deepest nested property', () => {
    const keys = ['a', 'b', 'c'];
    const data = { data: 'data' };

    const result = createNestedObject(keys, data);

    expect(result).toEqual({ a: { b: { c: data } } });
  });

  it('Should handle keys of different types (string, number, etc.)', () => {
    const keys = ['a', '3'];
    const data = { data: 'data' };

    const result = createNestedObject(keys, data);

    expect(result).toEqual({ a: { 3: data } });
  });

  it('Should return an empty object when keys is not an array', () => {
    const keys = ['field1'];
    const data = undefined;

    const result = createNestedObject(keys, data);

    expect(result).toEqual({});
  });

  it('Should return an object with one property have undefined value when data is undefined', () => {
    const keys = ['field1'];
    const data = undefined;

    const result = createNestedObject(keys, data);

    expect(result).toEqual({ field1: undefined });
  });

});