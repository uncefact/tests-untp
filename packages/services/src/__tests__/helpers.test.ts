import { fillArray, randomIntegerString, generateUUID, incrementQuality } from '../utils/helpers';

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

  it('should increment the quantity of items', () => {
    const obj = [{ quantity: 1 }, { quantity: 2 }];
    const result = incrementQuality(obj, 2);
    expect(result[0].quantity).toBe(2);
    expect(result[1].quantity).toBe(4);
  });

  it('should return an object that does not change when it does not have a quantity', () => {
    const obj = [{ uom: 'kg' }];
    const result = incrementQuality(obj, 2);
    expect(result[0].uom).toBe('kg');
    expect(result[0].quantity).toBeUndefined();
  });
});
