import path from 'path';
import {
  fillArray,
  randomIntegerString,
  generateUUID,
  incrementQuality,
  concatService,
  constructIdentifierString,
  extractDomain,
  validateAndConstructVerifyURL,
  constructVerifyURL,
  isValidUrl,
  convertObjectToArray1Item,
} from '../utils/helpers';

describe('helpers', () => {
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

describe('extractDomain', () => {
  it('should return the domain of a url', () => {
    const url = 'https://example.com/test';
    const result = extractDomain(url);
    expect(result).toBe('https://example.com');
  });

  it('should return an empty string if the url is invalid', () => {
    const url = 'invalid';
    expect(() => {
      extractDomain(url);
    }).toThrow('Invalid URL');
  });
});

describe('concatService', () => {
  it('should concatenate the values of the arguments passed to it', () => {
    const data = {
      productIdentifier: [
        {
          scheme: 'https://id.gs1.org/gtin',
          identifierValue: '05012345678900',
          binding: {
            type: 'document',
            assuranceLevel: '3rdParty',
            reference: 'https://id.gs1.org/gtin/05012345678900/binding',
          },
        },
      ],
      batchIdentifier: [
        {
          scheme: 'https://Cherriesfarm.example.org/batch',
          identifierValue: '2024001',
          binding: {
            type: 'document',
            assuranceLevel: '3rdParty',
            reference: 'https://Cherriesfarm.example.org/batch/2024-001/binding',
          },
        },
      ],
      itemIdentifier: [
        {
          scheme: 'https://Cherriesfarm.example.org/item',
          identifierValue: 'TRF240001',
          binding: {
            type: 'document',
            assuranceLevel: '3rdParty',
            reference: 'https://Cherriesfarm.example.org/item/TRF-24-0001/binding',
          },
        },
      ],
    };
    const args: any = [
      { type: 'text', value: '(01)' },
      { type: 'path', value: '/productIdentifier/0/identifierValue' },
      { type: 'text', value: '(10)' },
      { type: 'path', value: '/batchIdentifier/0/identifierValue' },
      { type: 'text', value: '(21)' },
      { type: 'path', value: '/itemIdentifier/0/identifierValue' },
    ];
    const result = concatService(data, ...args);
    expect(result).toBe('(01)05012345678900(10)2024001(21)TRF240001');
  });

  it('should return an empty string if the path does not exist', () => {
    const data = {
      test: 'test',
    };
    const args: any = [{ type: 'path', value: '/something' }];
    const result = concatService(data, ...args);
    expect(result).toBe('');
  });

  it('should throw an error if the path is invalid', () => {
    const data = {
      test: 'test',
    };
    const args: any = [{ type: 'path', value: 'invalid' }];

    expect(() => concatService(data, ...args)).toThrow('Error concatenating values');
  });

  it('should throw an error if the data is not an object', () => {
    const data = 'test';
    const args: any = [{ type: 'path', value: '/test' }];

    expect(() => concatService(data, ...args)).toThrow('Invalid data object');
  });
});

describe('constructIdentifierString', () => {
  it('should return the identifier string, when identifierKeyPath is an object', () => {
    const data = {
      productIdentifier: [
        {
          scheme: 'https://id.gs1.org/gtin',
          identifierValue: '05012345678900',
          binding: {
            type: 'document',
            assuranceLevel: '3rdParty',
            reference: 'https://id.gs1.org/gtin/05012345678900/binding',
          },
        },
      ],
      batchIdentifier: [
        {
          scheme: 'https://Cherriesfarm.example.org/batch',
          identifierValue: '2024001',
          binding: {
            type: 'document',
            assuranceLevel: '3rdParty',
            reference: 'https://Cherriesfarm.example.org/batch/2024-001/binding',
          },
        },
      ],
      itemIdentifier: [
        {
          scheme: 'https://Cherriesfarm.example.org/item',
          identifierValue: 'TRF240001',
          binding: {
            type: 'document',
            assuranceLevel: '3rdParty',
            reference: 'https://Cherriesfarm.example.org/item/TRF-24-0001/binding',
          },
        },
      ],
    };
    const identifierKeyPath: any = {
      function: 'concatService',
      args: [
        { type: 'text', value: '(01)' },
        { type: 'path', value: '/productIdentifier/0/identifierValue' },
        { type: 'text', value: '(10)' },
        { type: 'path', value: '/batchIdentifier/0/identifierValue' },
        { type: 'text', value: '(21)' },
        { type: 'path', value: '/itemIdentifier/0/identifierValue' },
      ],
    };
    const result = constructIdentifierString(data, identifierKeyPath);
    expect(result).toBe('(01)05012345678900(10)2024001(21)TRF240001');
  });

  it('should return the identifier string, when identifierKeyPath is a path string', () => {
    const data = {
      productIdentifier: [
        {
          scheme: 'https://id.gs1.org/gtin',
          identifierValue: '05012345678900',
          binding: {
            type: 'document',
            assuranceLevel: '3rdParty',
            reference: 'https://id.gs1.org/gtin/05012345678900/binding',
          },
        },
      ],
      batchIdentifier: [
        {
          scheme: 'https://Cherriesfarm.example.org/batch',
          identifierValue: '2024001',
          binding: {
            type: 'document',
            assuranceLevel: '3rdParty',
            reference: 'https://Cherriesfarm.example.org/batch/2024-001/binding',
          },
        },
      ],
      itemIdentifier: [
        {
          scheme: 'https://Cherriesfarm.example.org/item',
          identifierValue: 'TRF240001',
          binding: {
            type: 'document',
            assuranceLevel: '3rdParty',
            reference: 'https://Cherriesfarm.example.org/item/TRF-24-0001/binding',
          },
        },
      ],
    };
    const identifierKeyPath = '/productIdentifier/0/identifierValue';
    const result = constructIdentifierString(data, identifierKeyPath);
    expect(result).toBe('05012345678900');
  });

  it('should return an empty string if the path does not exist', () => {
    const data = {
      test: 'test',
    };
    const identifierKeyPath = '/something';
    const result = constructIdentifierString(data, identifierKeyPath);
    expect(result).toBe('');
  });

  it('should return the identifier string, when the identifier data is an URL', () => {
    const data = {
      productIdentifier: [
        {
          scheme: 'https://id.gs1.org/gtin',
          identifierValue: 'https://example.com/01/05012345678900',
          binding: {
            type: 'document',
            assuranceLevel: '3rdParty',
            reference: 'https://id.gs1.org/gtin/05012345678900/binding',
          },
        },
      ],
    };
    const identifierKeyPath = '/productIdentifier/0/identifierValue';
    const result = constructIdentifierString(data, identifierKeyPath);
    expect(result).toBe('(01)05012345678900');
  });

  it('should throw an error if the path is invalid', () => {
    const data = {
      test: 'test',
    };
    const identifierKeyPath = 'invalid';

    expect(() => constructIdentifierString(data, identifierKeyPath)).toThrow('Error constructing identifier string');
  });

  it('should throw an error if the data is not an object', () => {
    const data = 'test';
    const identifierKeyPath = '/test';

    expect(() => constructIdentifierString(data, identifierKeyPath)).toThrow('Invalid data object');
  });
});

describe('constructVerifyURL', () => {
  beforeEach(() => {
    // Mock window location for consistent tests
    delete (window as any).location;
    (window as any).location = new URL('http://localhost:3000');
  });

  it('should construct the correct verify URL with only URI', () => {
    const uri = 'http://example.com/credential';
    const expectedURL =
      'http://localhost:3000/verify?q=%7B%22payload%22%3A%7B%22uri%22%3A%22http%3A%2F%2Fexample.com%2Fcredential%22%7D%7D';
    const result = constructVerifyURL({ uri });

    expect(result).toBe(expectedURL);
  });

  it('should construct the correct verify URL with URI and hash', () => {
    const uri = 'http://example.com/credential';
    const hash = 'someHash';
    const result = constructVerifyURL({ uri, hash });
    
    const expectedURL = 'http://localhost:3000/verify?q=%7B%22payload%22%3A%7B%22uri%22%3A%22http%3A%2F%2Fexample.com%2Fcredential%22%2C%22hash%22%3A%22someHash%22%7D%7D';
    expect(result).toBe(expectedURL);
  });

  it('should construct the correct verify URL with URI, key, and hash', () => {
    const uri = 'http://example.com/credential';
    const key = 'someKey';
    const hash = 'someHash';
    const expectedURL =
      'http://localhost:3000/verify?q=%7B%22payload%22%3A%7B%22uri%22%3A%22http%3A%2F%2Fexample.com%2Fcredential%22%2C%22key%22%3A%22someKey%22%2C%22hash%22%3A%22someHash%22%7D%7D';
    const result = constructVerifyURL({ uri, key, hash });

    expect(result).toBe(expectedURL);
  });

  it('should throw an error if URI is not provided', () => {
    expect(() => constructVerifyURL({ uri: '' })).toThrow('URI is required');
  });
});

describe('validateAndConstructVerifyURL', () => {
  it('should throw an error if the value is empty', () => {
    expect(() => validateAndConstructVerifyURL(null)).toThrow('Invalid data');
    expect(() => validateAndConstructVerifyURL('')).toThrow('Invalid data');
    expect(() => validateAndConstructVerifyURL(undefined)).toThrow('Invalid data');
  });

  it('should return the verify URL when value is a string', () => {
    const value = 'http://example.com/credential';
    const expectedURL =
      'http://localhost:3000/verify?q=%7B%22payload%22%3A%7B%22uri%22%3A%22http%3A%2F%2Fexample.com%2Fcredential%22%7D%7D';
    const result = validateAndConstructVerifyURL(value);

    expect(result).toBe(expectedURL);
  });

  it('should return the verify URL when value is an object with URI, key, and hash', () => {
    const value = {
      uri: 'http://example.com/credential',
      key: 'someKey',
      hash: 'someHash',
    };
    const expectedURL =
      'http://localhost:3000/verify?q=%7B%22payload%22%3A%7B%22uri%22%3A%22http%3A%2F%2Fexample.com%2Fcredential%22%2C%22key%22%3A%22someKey%22%2C%22hash%22%3A%22someHash%22%7D%7D';
    const result = validateAndConstructVerifyURL(value);

    expect(result).toBe(expectedURL);
  });

  it('should throw an error if the value is not a string or object', () => {
    expect(() => validateAndConstructVerifyURL(123)).toThrow('Invalid data');
    expect(() => validateAndConstructVerifyURL({ notUri: 'http://example.com/credential' })).toThrow(
      'Unsupported value type',
    );
  });
});

describe('isValidUrl', () => {
  it('should return true if the url is valid', () => {
    const url = 'https://example.com';
    const result = isValidUrl(url);
    expect(result).toBe(true);
  });

  it('should return false if the url is invalid', () => {
    const url = 'invalid';
    const result = isValidUrl(url);
    expect(result).toBe(false);
  });
});

describe('convertObjectToArray1Item', () => {
  it('should return an array with one item', () => {
    const data = {
      data: { test: 'test' },
    };
    const params = {
      path: '/data',
    };
    const result = convertObjectToArray1Item(data, params);
    expect(result).toEqual({ data: [{ test: 'test' }] });
  });

  it('should return an array with one item when the path is empty', () => {
    const data = {
      data: { test: 'test' },
    };
    const params = {} as any;
    const result = convertObjectToArray1Item(data, params);
    expect(result).toEqual([
      {
        data: { test: 'test' },
      },
    ]);
  });

  it('should throw an error if the path is invalid', () => {
    const data = {
      data: { test: 'test' },
    };
    const params = {
      path: 'invalid',
    };
    expect(() => convertObjectToArray1Item(data, params)).toThrow('Error converting object to array, invalid path');
  });
});
