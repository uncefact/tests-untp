import { getCredentialByPath, checkStoredCredentialsConfig } from '../components/ConformityCredential/utils';

describe('checkStoredCredentials', () => {
  it('should return the stored credentials if they are valid', () => {
    const storedCredentials = {
      url: 'https://example.com',
      params: {
        resultPath: '',
      }
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
      }
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

describe('getCredentialByPath', () => {
  it('should return the credential by empty path', () => {
    const apiResp = {
      data: {
        credential: 'example',
      },
    };
    const path = '';

    const result = getCredentialByPath(apiResp, path);

    expect(result).toEqual(apiResp);
  });

  it('should return the credential by path with nested path', () => {
    const apiResp = {
      data: {
        credential: 'example',
      },
    };
    const path = '/data/credential';

    const result = getCredentialByPath(apiResp, path);

    expect(result).toEqual('example');
  });

  it('should throw an error if the path is invalid', () => {
    const apiResp = {
      data: {
        credential: 'example',
      },
    };
    const path = '/data/invalid/credential';

    const result = getCredentialByPath(apiResp, path);
    expect(result).toEqual(undefined);
  });

  it('should throw an error if the path is nil', () => {
    const apiResp = {
      data: {
        credential: 'example',
      },
    };
    const path = undefined;

    //@ts-ignore
    expect(() => getCredentialByPath(apiResp, path)).toThrow('Invalid credential path');
  });
});
