import {
  checkStoredCredentialsConfig,
  constructVerifyURL,
  detectValueFromStorage,
} from '../components/ConformityCredential/utils';

describe('checkStoredCredentials', () => {
  it('should return the stored credentials if they are valid', () => {
    const storedCredentials = {
      url: 'https://example.com',
      params: {
        resultPath: '',
      },
    };

    const result = checkStoredCredentialsConfig(storedCredentials);

    expect(result).toEqual({ ok: true, value: storedCredentials });
  });

  it('should throw an error if the stored credentials are invalid', () => {
    //@ts-ignore
    const result = checkStoredCredentialsConfig({});
    expect(result).toEqual({ ok: false, value: 'Invalid upload credential config' });
  });

  it('should throw an error if the stored credentials url is invalid', () => {
    const storedCredentials = {
      url: '',
      params: {
        resultPath: '',
      },
    };

    const result = checkStoredCredentialsConfig(storedCredentials);

    expect(result).toEqual({ ok: false, value: 'Invalid upload credential config url' });
  });

  it('should throw an error if the stored credentials are nil', () => {
    //@ts-ignore
    const result = checkStoredCredentialsConfig(undefined);
    expect(result).toEqual({ ok: false, value: 'Invalid upload credential config' });
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

describe('detectValueFromStorage', () => {
  it('should throw an error if the value is empty', () => {
    expect(() => detectValueFromStorage(null)).toThrow('Invalid data');
    expect(() => detectValueFromStorage('')).toThrow('Invalid data');
    expect(() => detectValueFromStorage(undefined)).toThrow('Invalid data');
  });

  it('should return the verify URL when value is a string', () => {
    const value = 'http://example.com/credential';
    const expectedURL =
      'http://localhost:3000/verify?q=%7B%22payload%22%3A%7B%22uri%22%3A%22http%3A%2F%2Fexample.com%2Fcredential%22%7D%7D';
    const result = detectValueFromStorage(value);

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
    const result = detectValueFromStorage(value);

    expect(result).toBe(expectedURL);
  });

  it('should throw an error if the value is not a string or object', () => {
    expect(() => detectValueFromStorage(123)).toThrow('Invalid data');
    expect(() => detectValueFromStorage({ notUri: 'http://example.com/credential' })).toThrow('Unsupported value type');
  });
});
