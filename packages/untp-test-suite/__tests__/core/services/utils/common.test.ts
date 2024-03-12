import * as fs from 'fs/promises';
import { validateCredentialConfigs, readFile } from '../../../../src/core/utils/common';
import { resolve } from 'path';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

jest.mock('path', () => {
  return {
    resolve: jest.fn(),
  };
});

describe('validateCredentialConfigs', () => {
  it('should throw an error when the credentialConfigs array is empty', () => {
    try {
      validateCredentialConfigs([]);
    } catch (error) {
      expect(error).toEqual(
        new Error('Credentials array cannot be empty. Please provide valid credentials to proceed.'),
      );
    }
  });

  it('should throw an error when the credential object is missing required fields', () => {
    try {
      validateCredentialConfigs([
        // @ts-ignore
        {
          type: 'objectEvent',
          version: 'v0.0.1',
        },
      ]);
    } catch (error) {
      expect(error).toEqual(
        new Error(
          `Each credential object must contain 'type', 'version', and 'dataPath' fields. Please ensure all required fields are provided.`,
        ),
      );
    }
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
    const result = await readFile('/untp-test-suite/src/config/credentials.json');
    expect(result).toEqual({ test: 'test' });
  });

  it('should throw an error when the file is not found', async () => {
    jest.spyOn(fs, 'readFile' as any).mockRejectedValue(new Error('File not found'));
    try {
      await readFile('/untp-test-suite/src/config/credentials.json');
    } catch (error) {
      expect(error).toEqual(new Error('File not found'));
    }
  });
});
