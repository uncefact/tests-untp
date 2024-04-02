import * as fs from 'fs/promises';
import { validateCredentialConfigs, readJsonFile } from '../../../src/core/utils/common';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

jest.mock('path', () => {
  return {
    resolve: jest.fn(),
  };
});

describe('validateCredentialConfigs', () => {
  const credentialConfigsPath = 'path/to/credentials';

  it('should throw an error when the array of credential configurations is empty', () => {
    expect(() => {
      validateCredentialConfigs([], credentialConfigsPath);
    }).toThrow('Credentials array cannot be empty. Please provide valid credentials to proceed.');
  });

  it('should return an array of errors when the credential configurations are invalid', () => {
    const credentialConfigs = [
      {
        type: '',
        version: '',
        dataPath: 'path/to/data',
      },
      {
        type: 'objectEvent',
        version: 'v1.0',
        dataPath: 'path/to/data',
      },
    ];

    const result = validateCredentialConfigs(credentialConfigs, credentialConfigsPath);

    expect(result).toEqual([
      {
        type: '',
        version: '',
        dataPath: 'path/to/data',
        errors: [
          {
            message: 'should have required property',
            keyword: 'required',
            dataPath: 'path/to/credentials',
            instancePath: 'type',
          },
          {
            message: 'should have required property',
            keyword: 'required',
            dataPath: 'path/to/credentials',
            instancePath: 'version',
          },
        ],
      },
      {
        type: 'objectEvent',
        version: 'v1.0',
        dataPath: 'path/to/data',
        errors: [],
      },
    ]);
  });
});

describe('readFile', () => {
  it('should read the file', async () => {
    jest.spyOn(fs, 'readFile' as any).mockResolvedValue('{"test": "test"}');
    JSON.parse = jest.fn().mockImplementation(() => {
      return {
        test: 'test',
      };
    });
    const result = await readJsonFile('/untp-test-suite/src/config/credentials.json');
    expect(result).toEqual({ test: 'test' });
  });

  it('should throw an error when the file is not found', async () => {
    jest.spyOn(fs, 'readFile' as any).mockRejectedValue(new Error('File not found'));
    try {
      await readJsonFile('/untp-test-suite/src/config/credentials.json');
    } catch (error) {
      expect(error).toEqual(new Error('File not found'));
    }
  });
});
