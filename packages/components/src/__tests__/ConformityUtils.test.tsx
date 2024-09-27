import { checkStoredCredentialsConfig } from '../components/ConformityCredential/utils';

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
