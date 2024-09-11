import {
  fillArray,
  randomIntegerString,
  generateUUID,
  incrementQuality,
  concatService,
  constructIdentifierString,
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
});
