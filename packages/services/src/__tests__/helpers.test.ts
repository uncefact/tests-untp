import {
  fillArray,
  randomIntegerString,
  generateUUID,
  incrementQuality,
  hasNonEmptyObjectProperty,
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

describe('hasNonEmptyObjectProperty', () => {
  it('should return true if the object has a non-empty object property', () => {
    const obj = {
      prop: {
        key: 'value',
      },
    };
    expect(hasNonEmptyObjectProperty(obj, 'prop')).toBe(true);
  });

  it('should return false if the object does not have the property', () => {
    const obj = {
      otherProp: {
        key: 'value',
      },
    };
    expect(hasNonEmptyObjectProperty(obj, 'prop')).toBe(false);
  });

  it('should return false if the property is not an object', () => {
    const obj = {
      prop: 'not an object',
    };
    expect(hasNonEmptyObjectProperty(obj, 'prop')).toBe(false);
  });

  it('should return false if the object property is empty', () => {
    const obj = {
      prop: {},
    };
    expect(hasNonEmptyObjectProperty(obj, 'prop')).toBe(false);
  });
});
